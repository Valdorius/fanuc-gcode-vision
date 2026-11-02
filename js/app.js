/**
 * Fanuc 0i-TF Turning Vision & Interpreter - Main Application Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // Instances
  const parser = new FanucLatheParser({ diameterMode: true });
  const ocr = new FanucOCR();
  const latheCanvas = document.getElementById('latheCanvas');
  const visualizer = new LatheVisualizer(latheCanvas);

  // UI Elements
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  const fileInput = document.getElementById('fileInput');
  const cameraInput = document.getElementById('cameraInput');
  const btnSamplePhoto = document.getElementById('btnSamplePhoto');
  const btnRunOcr = document.getElementById('btnRunOcr');
  const ocrProgressContainer = document.getElementById('ocrProgressContainer');
  const ocrProgressBar = document.getElementById('ocrProgressBar');
  const ocrProgressText = document.getElementById('ocrProgressText');
  const imgPreviewOriginal = document.getElementById('imgPreviewOriginal');
  const imgPreviewProcessed = document.getElementById('imgPreviewProcessed');
  const ocrCorrectionLog = document.getElementById('ocrCorrectionLog');
  const btnApplyOcr = document.getElementById('btnApplyOcr');

  const gcodeEditor = document.getElementById('gcodeEditor');
  const btnParseEditor = document.getElementById('btnParseEditor');
  const selectPreset = document.getElementById('selectPreset');

  // Visualizer Controls
  const btnFit = document.getElementById('btnFit');
  const btnPlay = document.getElementById('btnPlay');
  const btnStepBack = document.getElementById('btnStepBack');
  const btnStepForward = document.getElementById('btnStepForward');
  const timelineSlider = document.getElementById('timelineSlider');
  const stepCounter = document.getElementById('stepCounter');
  const toggleRevolution = document.getElementById('toggleRevolution');
  const toggleRapids = document.getElementById('toggleRapids');
  const toggleDiameter = document.getElementById('toggleDiameter');

  // Stats & Inspector
  const statMaxD = document.getElementById('statMaxD');
  const statMaxZ = document.getElementById('statMaxZ');
  const statCutTime = document.getElementById('statCutTime');
  const statCutDist = document.getElementById('statCutDist');
  const warningsList = document.getElementById('warningsList');
  const warningsContainer = document.getElementById('warningsContainer');
  const blocksTableBody = document.getElementById('blocksTableBody');

  let currentImageSource = null;
  let preprocessedCanvas = null;
  let isPlaying = false;
  let playInterval = null;
  let lastParsedData = null;

  // 1. Tab Switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.tab);
      if (target) {
        target.classList.add('active');
        if (btn.dataset.tab === 'tab-view') {
          setTimeout(() => {
            visualizer.resize();
            visualizer.fitView();
            visualizer.render();
          }, 50);
        }
      }
    });
  });

  // 2. Preset Program Selection
  function populatePresets() {
    selectPreset.innerHTML = '<option value="">-- Выберите типовую программу Fanuc --</option>';
    for (const [key, val] of Object.entries(SAMPLE_FANUC_PROGRAMS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = val.title;
      selectPreset.appendChild(opt);
    }
  }
  populatePresets();

  selectPreset.addEventListener('change', (e) => {
    const key = e.target.value;
    if (key && SAMPLE_FANUC_PROGRAMS[key]) {
      gcodeEditor.value = SAMPLE_FANUC_PROGRAMS[key].code;
      parseAndVisualize(gcodeEditor.value);
    }
  });

  // Calibration & OCR State
  let activePreset = 'smooth_gray';
  let activeRotation = 0;
  let activeCrop = { top: 0, bottom: 0, left: 0, right: 0 };
  let activeInvert = true;
  let activeDilate = false;
  let selectedEngine = 'ai';

  const engineRadios = document.querySelectorAll('input[name="ocrEngine"]');
  const aiKeyBox = document.getElementById('aiKeyBox');
  const inputApiKey = document.getElementById('inputApiKey');
  const btnSaveApiKey = document.getElementById('btnSaveApiKey');
  const cropOverlay = document.getElementById('cropOverlay');

  const presetBtns = document.querySelectorAll('.preset-btn');
  const sliderRotation = document.getElementById('sliderRotation');
  const valRotation = document.getElementById('valRotation');
  const btnResetRotation = document.getElementById('btnResetRotation');

  const sliderCropTop = document.getElementById('sliderCropTop');
  const sliderCropBottom = document.getElementById('sliderCropBottom');
  const sliderCropLeft = document.getElementById('sliderCropLeft');
  const sliderCropRight = document.getElementById('sliderCropRight');
  const valCropTop = document.getElementById('valCropTop');
  const valCropBottom = document.getElementById('valCropBottom');
  const valCropLeft = document.getElementById('valCropLeft');
  const valCropRight = document.getElementById('valCropRight');

  const checkInvert = document.getElementById('checkInvert');
  const checkDilate = document.getElementById('checkDilate');

  const btnTestApiKey = document.getElementById('btnTestApiKey');
  const aiKeyStatus = document.getElementById('aiKeyStatus');

  // Load saved Gemini API Key or auto-populate default key
  const defaultKey = (typeof window !== 'undefined' && window.DEFAULT_GEMINI_KEY) ? window.DEFAULT_GEMINI_KEY : '';
  const savedKey = localStorage.getItem('gemini_cnc_api_key') || defaultKey;
  if (savedKey && inputApiKey) {
    const cleanSaved = savedKey.trim().replace(/[^a-zA-Z0-9._-]/g, '');
    inputApiKey.value = cleanSaved;
    localStorage.setItem('gemini_cnc_api_key', cleanSaved);
  }

  // Auto-clean key on input (strip Russian text, "оно?", spaces, quotes)
  if (inputApiKey) {
    inputApiKey.addEventListener('input', () => {
      const raw = inputApiKey.value;
      const clean = raw.trim().replace(/[^a-zA-Z0-9._-]/g, '');
      if (raw !== clean) {
        inputApiKey.value = clean;
      }
    });
  }

  // Global helper: insert default key
  window.insertDefaultKey = function() {
    const key = (window.DEFAULT_GEMINI_KEY || '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
    if (!key) {
      alert('Дефолтный ключ не найден. Вставьте ключ вручную.');
      return;
    }
    if (inputApiKey) {
      inputApiKey.value = key;
    }
    localStorage.setItem('gemini_cnc_api_key', key);
    if (aiKeyStatus) {
      aiKeyStatus.innerHTML = '<span style="color: #4ade80; font-weight: bold;">🔑 Ваш ключ успешно вставлен и сохранен в браузере! Нажмите «⚡ Тест» для проверки.</span>';
    }
  };

  // Global helper: test API key with Google AI Studio
  window.testGeminiKey = async function() {
    const raw = (inputApiKey ? inputApiKey.value : '') || localStorage.getItem('gemini_cnc_api_key') || window.DEFAULT_GEMINI_KEY || '';
    const clean = raw.trim().replace(/[^a-zA-Z0-9._-]/g, '');
    
    if (!clean) {
      if (aiKeyStatus) {
        aiKeyStatus.innerHTML = '<span style="color: #ef4444; font-weight: bold;">⚠️ Введите API ключ в поле или нажмите «🔑 Вставить мой ключ»!</span>';
      }
      alert('⚠️ Пожалуйста, введите API ключ или нажмите «🔑 Вставить мой ключ»!');
      return;
    }

    if (inputApiKey) inputApiKey.value = clean;

    const testBtn = document.getElementById('btnTestApiKey');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.textContent = '⏳ Проверка...';
    }
    if (aiKeyStatus) {
      aiKeyStatus.innerHTML = '<span style="color: var(--fanuc-yellow); font-weight: bold;">⏳ Проверка ключа через Google AI Studio...</span>';
    }

    try {
      const models = ['gemini-3-flash-preview', 'gemini-3.8-flash', 'gemini-flash-latest'];
      let workingModel = null;
      let lastErrMsg = '';

      for (const model of models) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${clean}`;
        try {
          const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] })
          });

          if (resp.ok) {
            workingModel = model;
            break;
          } else {
            const err = await resp.json().catch(() => ({}));
            lastErrMsg = err.error?.message || `HTTP ${resp.status}`;
          }
        } catch (netErr) {
          lastErrMsg = netErr.message;
        }
      }

      if (workingModel) {
        localStorage.setItem('gemini_cnc_api_key', clean);
        if (aiKeyStatus) {
          aiKeyStatus.innerHTML = `<span style="color: #4ade80; font-weight: bold;">✅ Ключ проверен и активен! (${workingModel}) Доступ открыт.</span>`;
        }
        if (testBtn) {
          testBtn.textContent = '✅ OK!';
          testBtn.style.backgroundColor = '#16a34a';
        }
        alert(`✅ Ключ Gemini API успешно проверен и работает!\n\nМодель: ${workingModel}\nКлюч сохранен в браузере. Теперь вы можете фотографировать стойку Fanuc и распознавать программы с точностью 99.9%.`);
      } else {
        if (aiKeyStatus) {
          aiKeyStatus.innerHTML = `<span style="color: #ef4444; font-weight: bold;">❌ Ошибка: ${lastErrMsg || 'Неверный ключ'}</span>`;
        }
        if (testBtn) {
          testBtn.textContent = '❌ Ошибка';
          testBtn.style.backgroundColor = '#dc2626';
        }
        alert(`❌ Ошибка проверки API ключа:\n\n${lastErrMsg || 'Неверный ключ'}\n\nУбедитесь, что ключ введен без лишних пробелов и символов.`);
      }
    } catch (err) {
      if (aiKeyStatus) {
        aiKeyStatus.innerHTML = `<span style="color: #ef4444;">❌ Сетевая ошибка: ${err.message}</span>`;
      }
      alert(`❌ Сетевая ошибка: ${err.message}`);
    } finally {
      setTimeout(() => {
        if (testBtn) {
          testBtn.disabled = false;
          testBtn.textContent = '⚡ Тест';
          testBtn.style.backgroundColor = '';
        }
      }, 3500);
    }
  };

  if (btnSaveApiKey) {
    btnSaveApiKey.addEventListener('click', () => {
      const clean = (inputApiKey ? inputApiKey.value : '').trim().replace(/[^a-zA-Z0-9._-]/g, '');
      if (!clean) {
        alert('Пожалуйста, введите ключ перед сохранением!');
        return;
      }
      inputApiKey.value = clean;
      localStorage.setItem('gemini_cnc_api_key', clean);
      if (aiKeyStatus) {
        aiKeyStatus.innerHTML = '<span style="color: #4ade80; font-weight: bold;">💾 Ключ успешно сохранен в браузере!</span>';
      }
    });
  }

  // Engine Switch
  engineRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      selectedEngine = e.target.value;
      if (selectedEngine === 'ai') {
        aiKeyBox.style.display = 'block';
      } else {
        aiKeyBox.style.display = 'none';
      }
    });
  });

  // Screen Presets
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activePreset = btn.dataset.preset;

      if (activePreset === 'threshold') {
        checkInvert.checked = false;
        activeInvert = false;
      } else {
        checkInvert.checked = true;
        activeInvert = true;
      }

      updateImageCalibration();
    });
  });

  // Rotation
  sliderRotation.addEventListener('input', (e) => {
    activeRotation = parseInt(e.target.value, 10);
    valRotation.textContent = `${activeRotation}°`;
    updateImageCalibration();
  });

  btnResetRotation.addEventListener('click', () => {
    sliderRotation.value = 0;
    activeRotation = 0;
    valRotation.textContent = '0°';
    updateImageCalibration();
  });

  // Crop Sliders
  sliderCropTop.addEventListener('input', (e) => {
    activeCrop.top = parseInt(e.target.value, 10);
    valCropTop.textContent = `${activeCrop.top}%`;
    updateImageCalibration();
  });
  sliderCropBottom.addEventListener('input', (e) => {
    activeCrop.bottom = parseInt(e.target.value, 10);
    valCropBottom.textContent = `${activeCrop.bottom}%`;
    updateImageCalibration();
  });
  sliderCropLeft.addEventListener('input', (e) => {
    activeCrop.left = parseInt(e.target.value, 10);
    valCropLeft.textContent = `${activeCrop.left}%`;
    updateImageCalibration();
  });
  sliderCropRight.addEventListener('input', (e) => {
    activeCrop.right = parseInt(e.target.value, 10);
    valCropRight.textContent = `${activeCrop.right}%`;
    updateImageCalibration();
  });

  // Checkboxes
  checkInvert.addEventListener('change', (e) => {
    activeInvert = e.target.checked;
    updateImageCalibration();
  });
  checkDilate.addEventListener('change', (e) => {
    activeDilate = e.target.checked;
    updateImageCalibration();
  });

  // 3. Image Preprocessing & Display
  function handleImageLoaded(img) {
    currentImageSource = img;
    imgPreviewOriginal.src = img.src;

    updateImageCalibration();

    btnRunOcr.disabled = false;
    btnRunOcr.scrollIntoView({ behavior: 'smooth' });
  }

  function updateImageCalibration() {
    if (!currentImageSource) return;

    // Update overlay UI
    cropOverlay.style.top = `${activeCrop.top}%`;
    cropOverlay.style.bottom = `${activeCrop.bottom}%`;
    cropOverlay.style.left = `${activeCrop.left}%`;
    cropOverlay.style.right = `${activeCrop.right}%`;

    const cropObj = {
      x: activeCrop.left / 100,
      y: activeCrop.top / 100,
      w: Math.max(0.1, (100 - activeCrop.left - activeCrop.right) / 100),
      h: Math.max(0.1, (100 - activeCrop.top - activeCrop.bottom) / 100)
    };

    preprocessedCanvas = ocr.preprocessImage(currentImageSource, {
      crop: cropObj,
      rotation: activeRotation,
      method: activePreset,
      invert: activeInvert,
      dilate: activeDilate
    });

    imgPreviewProcessed.src = preprocessedCanvas.toDataURL();
  }

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => handleImageLoaded(img);
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });

  cameraInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const img = new Image();
      img.onload = () => handleImageLoaded(img);
      img.src = evt.target.result;
    };
    reader.readAsDataURL(file);
  });

  // Instant test with synthetic Fanuc screen photo
  btnSamplePhoto.addEventListener('click', () => {
    const mockCanvas = createSyntheticFanucScreen('g71_cycle');
    const img = new Image();
    img.onload = () => handleImageLoaded(img);
    img.src = mockCanvas.toDataURL();
  });

  // 4. OCR & AI Vision Execution
  btnRunOcr.addEventListener('click', async () => {
    if (!preprocessedCanvas) return;

    ocrProgressContainer.style.display = 'block';
    btnRunOcr.disabled = true;
    ocrCorrectionLog.innerHTML = '';

    const progressCallback = (p) => {
      const pct = Math.round(p.progress * 100);
      ocrProgressBar.style.width = `${pct}%`;
      ocrProgressText.textContent = `${p.message} (${pct}%)`;
    };

    try {
      let result;

      if (selectedEngine === 'ai') {
        const rawKey = inputApiKey.value || localStorage.getItem('gemini_cnc_api_key') || '';
        const apiKey = rawKey.trim().replace(/[^a-zA-Z0-9._-]/g, '');
        if (!apiKey) {
          aiKeyBox.style.display = 'block';
          inputApiKey.focus();
          throw new Error('Пожалуйста, введите Gemini API Key для режима AI Vision (он бесплатный в Google AI Studio)');
        }
        result = await ocr.recognizeWithAI(preprocessedCanvas, apiKey, progressCallback);
      } else {
        result = await ocr.recognize(preprocessedCanvas, progressCallback);
      }

      const modeLabel = result.mode === 'gemini_vision' ? '✨ Gemini Flash Vision' : '⚡ Tesseract CNC Engine';
      const conf = Math.round(result.confidence);
      const confColor = conf >= 75 ? '#4ade80' : (conf >= 50 ? '#fbbf24' : '#f87171');
      const validInfo = result.validLines !== undefined ? ` • Валидных кадров: ${result.validLines}/${result.totalLines}` : '';
      ocrProgressText.innerHTML = `Готово (${modeLabel})! Достоверность: <strong style="color: ${confColor}; font-size: 13px;">${conf}%</strong>${validInfo}`;
      ocrProgressBar.style.width = '100%';

      // Display Corrections
      renderCorrections(result.corrections);

      // Populate Editor
      gcodeEditor.value = result.correctedText;
      btnApplyOcr.style.display = 'block';

      // Automatically parse
      parseAndVisualize(result.correctedText);
    } catch (err) {
      alert(`Ошибка OCR: ${err.message}`);
      ocrProgressText.textContent = `Ошибка: ${err.message}`;
    } finally {
      btnRunOcr.disabled = false;
    }
  });

  btnApplyOcr.addEventListener('click', () => {
    // Switch to visualizer tab
    const viewTabBtn = document.querySelector('[data-tab="tab-view"]');
    if (viewTabBtn) viewTabBtn.click();
  });

  function renderCorrections(corrections) {
    if (!corrections || !corrections.length) {
      ocrCorrectionLog.innerHTML = '<div class="alert-success">Ошибок OCR не обнаружено, синтаксис Fanuc корректен!</div>';
      return;
    }

    let html = `<div class="correction-header">Автокорректор Fanuc исправил ${corrections.length} строк:</div>`;
    html += '<ul class="correction-list">';
    corrections.forEach(c => {
      html += `<li><strong>Кадр ${c.line}:</strong> <span class="text-red">«${escapeHtml(c.before)}»</span> &rarr; <span class="text-green">«${escapeHtml(c.after)}»</span></li>`;
    });
    html += '</ul>';
    ocrCorrectionLog.innerHTML = html;
  }

  // 5. G-Code Parsing & Visualization Core
  btnParseEditor.addEventListener('click', () => {
    parseAndVisualize(gcodeEditor.value);
    const viewTabBtn = document.querySelector('[data-tab="tab-view"]');
    if (viewTabBtn) viewTabBtn.click();
  });

  function parseAndVisualize(codeText) {
    if (!codeText.trim()) return;

    lastParsedData = parser.parse(codeText);
    const { blocks, segments, stats } = lastParsedData;

    // Update Visualizer
    visualizer.setSegments(segments);

    // Update Slider
    timelineSlider.max = segments.length;
    timelineSlider.value = segments.length;
    stepCounter.textContent = `${segments.length} / ${segments.length}`;

    // Update HUD Stats
    statMaxD.textContent = `⌀${stats.maxDiameter.toFixed(1)} мм`;
    statMaxZ.textContent = `${stats.minZ.toFixed(1)} мм`;
    statCutTime.textContent = stats.estimatedTimeFormatted;
    statCutDist.textContent = `${stats.feedLengthMm} мм (раб.)`;

    // Warnings
    renderWarnings(blocks);

    // Blocks Table
    renderBlocksTable(blocks);
  }

  function renderWarnings(blocks) {
    const allWarnings = [];
    blocks.forEach(b => {
      if (b.warnings && b.warnings.length) {
        b.warnings.forEach(w => allWarnings.push(`Кадр ${b.lineNum}: ${w}`));
      }
    });

    if (allWarnings.length) {
      warningsContainer.style.display = 'block';
      warningsList.innerHTML = allWarnings.map(w => `<li>⚠️ ${escapeHtml(w)}</li>`).join('');
    } else {
      warningsContainer.style.display = 'none';
      warningsList.innerHTML = '';
    }
  }

  function renderBlocksTable(blocks) {
    blocksTableBody.innerHTML = '';
    blocks.forEach(b => {
      const tr = document.createElement('tr');

      // Badges
      let badgeHtml = '';
      if (b.tokens.some(t => t.letter === 'G' && t.value === 0)) {
        badgeHtml = '<span class="badge badge-rapid">G00</span>';
      } else if (b.tokens.some(t => t.letter === 'G' && t.value === 1)) {
        badgeHtml = '<span class="badge badge-feed">G01</span>';
      } else if (b.tokens.some(t => t.letter === 'G' && (t.value === 2 || t.value === 3))) {
        badgeHtml = '<span class="badge badge-arc">ARC</span>';
      } else if (b.tokens.some(t => t.letter === 'G' && t.value === 71)) {
        badgeHtml = '<span class="badge badge-cycle">G71</span>';
      } else if (b.tokens.some(t => t.letter === 'T')) {
        badgeHtml = '<span class="badge badge-tool">TOOL</span>';
      }

      tr.innerHTML = `
        <td class="col-num">${b.lineNum}</td>
        <td class="col-code"><code>${escapeHtml(b.raw)}</code></td>
        <td class="col-badge">${badgeHtml}</td>
        <td class="col-desc">${escapeHtml(b.explanation.join('; ') || 'Технологический кадр')}</td>
      `;

      tr.addEventListener('click', () => {
        // Highlight corresponding segments
        document.querySelectorAll('#blocksTableBody tr').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');

        const segIdx = lastParsedData.segments.findIndex(s => s.lineNum === b.lineNum);
        if (segIdx !== -1) {
          timelineSlider.value = segIdx + 1;
          visualizer.setStep(segIdx + 1);
          stepCounter.textContent = `${segIdx + 1} / ${lastParsedData.segments.length}`;
        }
      });

      blocksTableBody.appendChild(tr);
    });
  }

  // 6. Timeline Playback & Controls
  timelineSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    visualizer.setStep(val);
    stepCounter.textContent = `${val} / ${visualizer.segments.length}`;
    highlightBlockForStep(val);
  });

  btnStepBack.addEventListener('click', () => {
    let cur = parseInt(timelineSlider.value, 10);
    if (cur > 0) {
      cur--;
      timelineSlider.value = cur;
      visualizer.setStep(cur);
      stepCounter.textContent = `${cur} / ${visualizer.segments.length}`;
      highlightBlockForStep(cur);
    }
  });

  btnStepForward.addEventListener('click', () => {
    let cur = parseInt(timelineSlider.value, 10);
    if (cur < visualizer.segments.length) {
      cur++;
      timelineSlider.value = cur;
      visualizer.setStep(cur);
      stepCounter.textContent = `${cur} / ${visualizer.segments.length}`;
      highlightBlockForStep(cur);
    }
  });

  btnPlay.addEventListener('click', () => {
    if (isPlaying) {
      pausePlayback();
    } else {
      startPlayback();
    }
  });

  function startPlayback() {
    isPlaying = true;
    btnPlay.textContent = '⏸ Пауза';
    btnPlay.classList.add('playing');

    if (parseInt(timelineSlider.value, 10) >= visualizer.segments.length) {
      timelineSlider.value = 0;
      visualizer.setStep(0);
    }

    playInterval = setInterval(() => {
      let cur = parseInt(timelineSlider.value, 10);
      if (cur < visualizer.segments.length) {
        cur++;
        timelineSlider.value = cur;
        visualizer.setStep(cur);
        stepCounter.textContent = `${cur} / ${visualizer.segments.length}`;
        highlightBlockForStep(cur);
      } else {
        pausePlayback();
      }
    }, 120);
  }

  function pausePlayback() {
    isPlaying = false;
    btnPlay.textContent = '▶ Старт';
    btnPlay.classList.remove('playing');
    if (playInterval) clearInterval(playInterval);
  }

  function highlightBlockForStep(step) {
    if (!lastParsedData || !lastParsedData.segments.length || step <= 0) return;
    const seg = lastParsedData.segments[step - 1];
    if (seg && seg.lineNum) {
      const rows = document.querySelectorAll('#blocksTableBody tr');
      rows.forEach(r => r.classList.remove('selected'));
      const activeRow = rows[seg.lineNum - 1];
      if (activeRow) {
        activeRow.classList.add('selected');
      }
    }
  }

  btnFit.addEventListener('click', () => {
    visualizer.fitView();
    visualizer.render();
  });

  toggleRevolution.addEventListener('change', (e) => {
    visualizer.showRevolutionBody = e.target.checked;
    visualizer.render();
  });

  toggleRapids.addEventListener('change', (e) => {
    visualizer.showRapids = e.target.checked;
    visualizer.render();
  });

  toggleDiameter.addEventListener('change', (e) => {
    visualizer.diameterMode = e.target.checked;
    parser.diameterMode = e.target.checked;
    if (lastParsedData) {
      parseAndVisualize(gcodeEditor.value);
    }
  });

  window.addEventListener('resize', () => {
    visualizer.resize();
  });

  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Initial load: parse default stepped shaft
  gcodeEditor.value = SAMPLE_FANUC_PROGRAMS.step_shaft.code;
  parseAndVisualize(gcodeEditor.value);
});
