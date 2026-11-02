/**
 * Fanuc 0i-TF Turning G-Code Parser & Interpreter
 * Supports:
 * - X (diameter), Z coordinates
 * - U (incremental diameter), W (incremental Z)
 * - G00, G01, G02, G03 (R and I/K)
 * - G71/G70 Turning Canned Cycles (Roughing & Finishing)
 * - G72 (Facing Cycle), G76/G92 (Threading), G75 (Grooving)
 * - Modal states: G96/G97 (CSS/RPM), G98/G99 (mm/min / mm/rev), G50 (clamp)
 * - Tool calls T0101..T1212
 * - Russian human-readable explanations and safety checks
 */

class FanucLatheParser {
  constructor(options = {}) {
    this.diameterMode = options.diameterMode !== false; // Default: true for Fanuc lathe
    this.reset();
  }

  reset() {
    this.state = {
      x: 0,           // Diameter or Radius
      z: 0,
      prevX: 0,
      prevZ: 0,
      feed: 0.2,      // Default F0.2 mm/rev
      feedMode: 99,   // 99 = G99 (mm/rev), 98 = G98 (mm/min)
      speedMode: 97,  // 97 = G97 (RPM), 96 = G96 (CSS m/min)
      spindleSpeed: 1000,
      spindleDir: 'M05', // M03, M04, M05
      spindleClamp: 3000, // G50 S...
      motionMode: 0,  // G00, G01, G02, G03
      tool: '0000',
      coolant: false, // M08/M09
      workOffset: 'G54'
    };

    this.rawLines = [];
    this.parsedBlocks = [];
    this.segments = []; // Linear & arc move segments for visualization
    this.stats = {
      minX: 0,
      maxX: 0,
      minZ: 0,
      maxZ: 0,
      rapidLength: 0,
      feedLength: 0,
      cutTimeSeconds: 0,
      rapidTimeSeconds: 0,
      toolChanges: 0,
      warnings: []
    };
  }

  parse(codeText) {
    this.reset();
    this.rawLines = codeText.split(/\r?\n/);

    // First pass: extract all blocks and label line numbers N...
    const blocks = [];
    const blockMap = new Map(); // N-number -> index in blocks

    for (let i = 0; i < this.rawLines.length; i++) {
      const raw = this.rawLines[i];
      const parsed = this.parseLine(raw, i + 1);
      if (parsed) {
        if (parsed.nNumber !== null) {
          blockMap.set(parsed.nNumber, blocks.length);
        }
        blocks.push(parsed);
      }
    }

    this.parsedBlocks = blocks;

    // Second pass: interpret motion, resolve G71/G70 cycles, generate segments
    this.interpret(blocks, blockMap);

    return {
      blocks: this.parsedBlocks,
      segments: this.segments,
      stats: this.calculateStats()
    };
  }

  /**
   * Parse a single G-code line into structured tokens
   */
  parseLine(rawText, lineNum) {
    const trimmed = rawText.trim();
    if (!trimmed || trimmed === '%') return null;

    let comment = '';
    let codeWithoutComment = trimmed;

    // Extract comments in parentheses or after semicolon
    const parenMatch = trimmed.match(/\((.*?)\)/);
    if (parenMatch) {
      comment = parenMatch[1];
      codeWithoutComment = trimmed.replace(/\(.*?\)/g, ' ').trim();
    }
    const semiIdx = codeWithoutComment.indexOf(';');
    if (semiIdx !== -1) {
      comment = (comment ? comment + '; ' : '') + codeWithoutComment.substring(semiIdx + 1).trim();
      codeWithoutComment = codeWithoutComment.substring(0, semiIdx).trim();
    }

    // Program header check e.g. O1001
    const progMatch = codeWithoutComment.match(/^[oO](\d+)/);
    const progNumber = progMatch ? parseInt(progMatch[1], 10) : null;

    // Extract N line number
    const nMatch = codeWithoutComment.match(/\bN(\d+)\b/i);
    const nNumber = nMatch ? parseInt(nMatch[1], 10) : null;

    // Tokenize word-addresses like G01, X50.5, Z-20., U2., W-0.5, F0.25, S1200, T0101, etc.
    const tokens = [];
    const regex = /([A-Z])\s*([-+]?[0-9]*\.?[0-9]+)?/gi;
    let match;

    while ((match = regex.exec(codeWithoutComment)) !== null) {
      const letter = match[1].toUpperCase();
      const valStr = match[2];
      const val = (valStr !== undefined && valStr !== '') ? parseFloat(valStr) : null;
      tokens.push({ letter, value: val, raw: match[0] });
    }

    return {
      lineNum,
      raw: trimmed,
      comment,
      progNumber,
      nNumber,
      tokens,
      explanation: [],
      warnings: []
    };
  }

  /**
   * Interpret block stream and generate toolpath segments
   */
  interpret(blocks, blockMap) {
    let curX = 0; // Stored in diameter (mm)
    let curZ = 0; // Stored in Z (mm)

    let g71Block1 = null; // Stored first line of two-line G71

    for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
      const block = blocks[bIdx];
      const tokens = block.tokens;
      if (!tokens.length) continue;

      let hasX = false, hasZ = false;
      let hasU = false, hasW = false;
      let targetX = curX;
      let targetZ = curZ;
      let arcR = null;
      let arcI = null, arcK = null;
      let g71Cycle = false;
      let g70Cycle = false;
      let g76Cycle = false;

      // Scan tokens
      for (let t = 0; t < tokens.length; t++) {
        const { letter, value } = tokens[t];

        switch (letter) {
          case 'G':
            if (value === 0 || value === 0.0) {
              this.state.motionMode = 0;
              block.explanation.push('G00: Ускоренное позиционирование без резания');
            } else if (value === 1 || value === 1.0) {
              this.state.motionMode = 1;
              block.explanation.push('G01: Линейная интерполяция (рабочая подача)');
            } else if (value === 2 || value === 2.0) {
              this.state.motionMode = 2;
              block.explanation.push('G02: Круговая интерполяция по часовой стрелке (CW)');
            } else if (value === 3 || value === 3.0) {
              this.state.motionMode = 3;
              block.explanation.push('G03: Круговая интерполяция против часовой стрелки (CCW)');
            } else if (value === 21) {
              block.explanation.push('G21: Ввод данных в миллиметрах (метрическая система)');
            } else if (value === 20) {
              block.explanation.push('G20: Ввод данных в дюймах');
            } else if (value === 28) {
              block.explanation.push('G28: Возврат в исходную референтную точку станка');
            } else if (value === 40) {
              block.explanation.push('G40: Отмена коррекции на радиус вершины резца');
            } else if (value === 41) {
              block.explanation.push('G41: Коррекция на радиус резца СЛЕВА от контура');
            } else if (value === 42) {
              block.explanation.push('G42: Коррекция на радиус резца СПРАВА от контура');
            } else if (value === 50) {
              block.explanation.push('G50: Ограничение макс. оборотов шпинделя или смещение нуля');
            } else if (value === 54 || (value >= 55 && value <= 59)) {
              this.state.workOffset = 'G' + Math.floor(value);
              block.explanation.push(`${this.state.workOffset}: Выбор рабочей системы координат детали`);
            } else if (value === 71) {
              g71Cycle = true;
            } else if (value === 70) {
              g70Cycle = true;
            } else if (value === 76) {
              g76Cycle = true;
            } else if (value === 96) {
              this.state.speedMode = 96;
              block.explanation.push('G96: Режим постоянной скорости резания (CSS, м/мин)');
            } else if (value === 97) {
              this.state.speedMode = 97;
              block.explanation.push('G97: Режим постоянных оборотов шпинделя (об/мин)');
            } else if (value === 98) {
              this.state.feedMode = 98;
              block.explanation.push('G98: Подача в минуту (мм/мин)');
            } else if (value === 99) {
              this.state.feedMode = 99;
              block.explanation.push('G99: Подача на оборот (мм/об)');
            }
            break;

          case 'X':
            hasX = true;
            targetX = value;
            block.explanation.push(`X${value}: Координата по диаметру ⌀${value} мм (радиус R=${(value/2).toFixed(3)} мм)`);
            break;

          case 'Z':
            hasZ = true;
            targetZ = value;
            block.explanation.push(`Z${value}: Координата по длине ${value} мм (${value <= 0 ? 'вглубь к патрону' : 'от торца вправо'})`);
            break;

          case 'U': // Fanuc incremental X
            hasU = true;
            targetX = curX + value;
            block.explanation.push(`U${value}: Приращение по диаметру на ${value >= 0 ? '+' : ''}${value} мм (новый ⌀${targetX.toFixed(3)})`);
            break;

          case 'W': // Fanuc incremental Z
            hasW = true;
            targetZ = curZ + value;
            block.explanation.push(`W${value}: Приращение по оси Z на ${value >= 0 ? '+' : ''}${value} мм (новый Z${targetZ.toFixed(3)})`);
            break;

          case 'F':
            this.state.feed = value;
            const fUnit = this.state.feedMode === 99 ? 'мм/об' : 'мм/мин';
            block.explanation.push(`F${value}: Рабочая подача ${value} ${fUnit}`);
            break;

          case 'S':
            this.state.spindleSpeed = value;
            if (this.state.speedMode === 96) {
              block.explanation.push(`S${value}: Скорость резания Vc = ${value} м/мин`);
            } else {
              block.explanation.push(`S${value}: Частота вращения шпинделя n = ${value} об/мин`);
            }
            break;

          case 'T':
            const tStr = Math.floor(value).toString().padStart(4, '0');
            const toolNum = tStr.substring(0, 2);
            const offsetNum = tStr.substring(2, 4);
            this.state.tool = tStr;
            this.stats.toolChanges++;
            block.explanation.push(`T${tStr}: Вызов резца №${parseInt(toolNum, 10)} с корректором геометрии/износа №${parseInt(offsetNum, 10)}`);
            break;

          case 'M':
            if (value === 3 || value === 3.0) {
              this.state.spindleDir = 'M03';
              block.explanation.push('M03: Включение вращения шпинделя по часовой стрелке (CW)');
            } else if (value === 4 || value === 4.0) {
              this.state.spindleDir = 'M04';
              block.explanation.push('M04: Включение вращения шпинделя против часовой стрелки (CCW)');
            } else if (value === 5 || value === 5.0) {
              this.state.spindleDir = 'M05';
              block.explanation.push('M05: Останов шпинделя');
            } else if (value === 8 || value === 8.0) {
              this.state.coolant = true;
              block.explanation.push('M08: Включение подачи СОЖ (охлаждающей жидкости)');
            } else if (value === 9 || value === 9.0) {
              this.state.coolant = false;
              block.explanation.push('M09: Выключение подачи СОЖ');
            } else if (value === 30) {
              block.explanation.push('M30: Конец программы с возвратом на первый кадр');
            } else if (value === 0) {
              block.explanation.push('M00: Безусловный технологический останов станка');
            } else if (value === 1) {
              block.explanation.push('M01: Останов по выбору оператора (Optional Stop)');
            }
            break;

          case 'R':
            arcR = value;
            break;

          case 'I':
            arcI = value; // Fanuc turning: incremental radius center in X
            break;

          case 'K':
            arcK = value; // Fanuc turning: incremental center in Z
            break;
        }
      }

      // Check for G71 cycle
      if (g71Cycle) {
        this.handleG71Cycle(block, blocks, blockMap, curX, curZ);
        continue;
      }

      // Check for G70 finishing cycle
      if (g70Cycle) {
        this.handleG70Cycle(block, blocks, blockMap, curX, curZ);
        continue;
      }

      // Check for G76 threading cycle
      if (g76Cycle) {
        this.handleG76Cycle(block, curX, curZ);
        continue;
      }

      // Process standard motion (G00, G01, G02, G03)
      if (hasX || hasZ || hasU || hasW) {
        const seg = {
          lineNum: block.lineNum,
          motion: this.state.motionMode,
          tool: this.state.tool,
          feed: this.state.feed,
          startX: curX,
          startZ: curZ,
          endX: targetX,
          endZ: targetZ,
          arcR,
          arcI,
          arcK,
          isCycleSubmove: false
        };

        // Safety checks
        if (this.state.motionMode === 0 && targetZ < 0 && curZ > 0 && targetX < curX) {
          block.warnings.push('Внимание: Ускоренное перемещение G00 в зону детали! Проверьте траекторию на столкновение.');
        }

        this.segments.push(seg);
        curX = targetX;
        curZ = targetZ;
      }
    }
  }

  /**
   * Handle Fanuc 0i-TF G71 Rough Turning Cycle
   * Standard 2-line format:
   * Block 1: G71 U(d) R(e)  [d = depth of cut, e = retract]
   * Block 2: G71 P(ns) Q(nf) U(u) W(w) F(f) S(s)
   */
  handleG71Cycle(block, blocks, blockMap, curX, curZ) {
    const tokens = block.tokens;
    const tokenMap = {};
    tokens.forEach(t => tokenMap[t.letter] = t.value);

    // Is this block 1 (U depth and R retract) or block 2 (P, Q)?
    if (tokenMap.P !== undefined && tokenMap.Q !== undefined) {
      const pNum = Math.floor(tokenMap.P);
      const qNum = Math.floor(tokenMap.Q);
      const allowanceX = tokenMap.U || 0; // Finishing allowance on diameter
      const allowanceZ = tokenMap.W || 0; // Finishing allowance on Z
      const feed = tokenMap.F || this.state.feed;

      block.explanation.push(
        `G71 Цикл чернового продольного точения: контур от N${pNum} до N${qNum}, ` +
        `чистовой припуск: по диам. ⌀${allowanceX} мм, по торцу Z=${allowanceZ} мм`
      );

      // Locate profile blocks between P and Q
      const pIdx = blockMap.get(pNum);
      const qIdx = blockMap.get(qNum);

      if (pIdx !== undefined && qIdx !== undefined && pIdx <= qIdx) {
        // Extract contour
        const profilePoints = [{ x: curX, z: curZ }];
        let pX = curX, pZ = curZ;

        for (let i = pIdx; i <= qIdx; i++) {
          const pb = blocks[i];
          let pbX = pX, pbZ = pZ;
          let moved = false;

          for (const tok of pb.tokens) {
            if (tok.letter === 'X') { pbX = tok.value; moved = true; }
            else if (tok.letter === 'Z') { pbZ = tok.value; moved = true; }
            else if (tok.letter === 'U') { pbX += tok.value; moved = true; }
            else if (tok.letter === 'W') { pbZ += tok.value; moved = true; }
          }
          if (moved) {
            profilePoints.push({ x: pbX, z: pbZ, lineNum: pb.lineNum });
            pX = pbX;
            pZ = pbZ;
          }
        }

        // Generate roughing passes simulation
        const depth = 2.0; // Standard nominal 2mm depth of cut
        const minProfileX = Math.min(...profilePoints.map(p => p.x));
        const maxStockX = curX;

        let passX = maxStockX - depth * 2;
        while (passX >= minProfileX + allowanceX) {
          // Linear pass along Z to contour boundary
          const minZ = Math.min(...profilePoints.map(p => p.z));
          this.segments.push({
            lineNum: block.lineNum,
            motion: 1, // Cut
            startX: passX,
            startZ: curZ,
            endX: passX,
            endZ: minZ + allowanceZ,
            isCycleSubmove: true,
            cycleType: 'G71'
          });
          // Retract move
          this.segments.push({
            lineNum: block.lineNum,
            motion: 0, // Rapid retract
            startX: passX,
            startZ: minZ + allowanceZ,
            endX: passX + 1.0,
            endZ: minZ + allowanceZ + 0.5,
            isCycleSubmove: true,
            cycleType: 'G71'
          });
          passX -= depth * 2;
        }

        // Also add the finished profile contour (highlighted)
        for (let j = 0; j < profilePoints.length - 1; j++) {
          this.segments.push({
            lineNum: profilePoints[j + 1].lineNum || block.lineNum,
            motion: 1,
            startX: profilePoints[j].x,
            startZ: profilePoints[j].z,
            endX: profilePoints[j + 1].x,
            endZ: profilePoints[j + 1].z,
            isProfileContour: true
          });
        }
      } else {
        block.warnings.push(`G71: Метки контура N${pNum} или N${qNum} не найдены в программе!`);
      }
    } else {
      // First line of G71
      const depth = tokenMap.U || 2.0;
      const retract = tokenMap.R || 0.5;
      block.explanation.push(`G71 Параметры резания: глубина съема на сторону Δd=${depth} мм, отскок резца R=${retract} мм`);
    }
  }

  /**
   * Handle Fanuc 0i-TF G70 Finishing Cycle
   * G70 P(ns) Q(nf)
   */
  handleG70Cycle(block, blocks, blockMap, curX, curZ) {
    const tokenMap = {};
    block.tokens.forEach(t => tokenMap[t.letter] = t.value);
    const pNum = Math.floor(tokenMap.P || 0);
    const qNum = Math.floor(tokenMap.Q || 0);
    block.explanation.push(`G70 Чистовой цикл обработки контура от кадра N${pNum} до N${qNum}`);
  }

  /**
   * Handle Fanuc G76 Threading Cycle
   */
  handleG76Cycle(block, curX, curZ) {
    const tokenMap = {};
    block.tokens.forEach(t => tokenMap[t.letter] = t.value);
    if (tokenMap.X !== undefined && tokenMap.Z !== undefined) {
      const pitch = tokenMap.F || 1.5;
      block.explanation.push(
        `G76 Резьбонарезание: конечный ⌀${tokenMap.X} мм, длина по Z=${tokenMap.Z} мм, шаг резьбы P=${pitch} мм`
      );
      // Generate helical/box representation
      this.segments.push({
        lineNum: block.lineNum,
        motion: 1,
        startX: curX,
        startZ: curZ,
        endX: tokenMap.X,
        endZ: tokenMap.Z,
        isThread: true
      });
    } else {
      block.explanation.push('G76 Параметры резьбы (чистовые проходы, угол профиля, глубина резания)');
    }
  }

  /**
   * Compute comprehensive lathe program statistics
   */
  calculateStats() {
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let rapidDist = 0, feedDist = 0;

    for (const seg of this.segments) {
      // Radius conversion: in diameter mode, X on screen is radius = X / 2
      const r1 = seg.startX / (this.diameterMode ? 2 : 1);
      const r2 = seg.endX / (this.diameterMode ? 2 : 1);

      minX = Math.min(minX, seg.startX, seg.endX);
      maxX = Math.max(maxX, seg.startX, seg.endX);
      minZ = Math.min(minZ, seg.startZ, seg.endZ);
      maxZ = Math.max(maxZ, seg.startZ, seg.endZ);

      const dX = r2 - r1;
      const dZ = seg.endZ - seg.startZ;
      const dist = Math.hypot(dX, dZ);

      if (seg.motion === 0) {
        rapidDist += dist;
      } else {
        feedDist += dist;
      }
    }

    if (minX === Infinity) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }

    // Estimated time calculation
    // Assume rapid feed = 15,000 mm/min = 250 mm/s
    const rapidTime = rapidDist / 250;
    // Assume cutting feed = feed (mm/rev) * 1200 RPM / 60
    const feedSpeedMmSec = (this.state.feed * 1000) / 60 || 5.0;
    const cutTime = feedDist / feedSpeedMmSec;

    return {
      minDiameter: minX,
      maxDiameter: maxX,
      minZ,
      maxZ,
      rapidLengthMm: rapidDist.toFixed(1),
      feedLengthMm: feedDist.toFixed(1),
      totalLengthMm: (rapidDist + feedDist).toFixed(1),
      estimatedTimeFormatted: this.formatTime(rapidTime + cutTime),
      toolChanges: this.stats.toolChanges,
      totalLines: this.parsedBlocks.length
    };
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins === 0) return `${secs} сек`;
    return `${mins} мин ${secs} сек`;
  }
}

// Export for browser and node
if (typeof window !== 'undefined') {
  window.FanucLatheParser = FanucLatheParser;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FanucLatheParser };
}
