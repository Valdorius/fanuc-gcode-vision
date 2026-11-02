/**
 * Preset Fanuc 0i-TF Turning Programs & Screen Generators
 */

const SAMPLE_FANUC_PROGRAMS = {
  step_shaft: {
    title: 'Ступенчатый вал с фасками (O1001)',
    desc: 'Классическая токарная обработка: подрезка торца, продольное точение шеек ⌀20, ⌀35, ⌀50 мм с фасками 1×45°',
    code: `%
O1001 (STEPPED SHAFT)
G21 G40 G97 G99
G28 U0. W0.
(ROUGH & FINISH OD TOOL)
T0101
G50 S2500
G96 S180 M03
M08
(RAPID TO WORKPIECE)
G00 X55.0 Z5.0
G00 Z0.2
(FACE WORKPIECE)
G01 X-1.0 F0.15
G00 X55.0 Z2.0
(START CONTOUR)
G00 X18.0 Z2.0
G01 Z0. F0.2
X20.0 Z-1.0
Z-25.0
X33.0
X35.0 Z-26.0
Z-50.0
X48.0
X50.0 Z-51.0
Z-70.0
(RETRACT)
G00 X55.0
G00 Z10.0
M09
M05
G28 U0. W0.
M30
%`
  },

  g71_cycle: {
    title: 'Черновой цикл G71 + чистовой G70 (O2002)',
    desc: 'Стандартный 2-строчный цикл Fanuc 0i-TF: съем припуска по 2 мм с чистовым контуром N100-N200',
    code: `%
O2002 (FANUC G71 CYCLE)
G21 G40 G99
G28 U0. W0.
T0101
G50 S2200
G96 S160 M03
M08
G00 X65.0 Z2.0
(G71 ROUGHING: DEPTH 2.0MM, RETRACT 0.5MM)
G71 U2.0 R0.5
(G71 PROFILE: N100 TO N200, FINISH ALLOWANCE X0.5 Z0.1)
G71 P100 Q200 U0.5 W0.1 F0.25
N100 G00 X20.0
G01 Z0. F0.15
X24.0 Z-2.0
Z-20.0
X36.0 Z-30.0
Z-45.0
G02 X46.0 Z-50.0 R5.0
G01 X58.0
N200 G01 X62.0 Z-52.0
(G70 FINISHING PASS)
G70 P100 Q200 F0.12
G00 X70.0 Z20.0
M09
M05
G28 U0. W0.
M30
%`
  },

  radii_sphere: {
    title: 'Фасонная деталь со сферой и галтелями (O3003)',
    desc: 'Круговая интерполяция G02 (CW) и G03 (CCW) с радиусами R на токарном Fanuc',
    code: `%
O3003 (SPHERE AND RADII)
G21 G40 G97 G99
G28 U0. W0.
T0101
G50 S2000
G96 S170 M03
M08
G00 X45.0 Z2.0
G00 X0. Z2.0
G01 Z0. F0.15
(R10 NOSE SPHERE)
G03 X20.0 Z-10.0 R10.0 F0.18
(CYLINDER SECTION)
G01 Z-25.0
(R6 CONCAVE FILLET)
G02 X32.0 Z-31.0 R6.0
(TAPER SECTION)
G01 X40.0 Z-45.0
Z-60.0
G00 X45.0
G00 Z10.0
M09
M05
G28 U0. W0.
M30
%`
  },

  grooving_cutoff: {
    title: 'Канавка и отрезка (O4004)',
    desc: 'Канавочный резец T0202: врезание с подачей F0.08 мм/об и отскоком',
    code: `%
O4004 (GROOVE AND CUTOFF)
G21 G40 G97 G99
G28 U0. W0.
(GROOVING TOOL W=3MM)
T0202
G97 S800 M03
M08
G00 X42.0 Z-20.0
(FIRST PLUNGE)
G01 X28.0 F0.08
G04 X0.5
G00 X42.0
(STEP OVER 2.5MM)
G00 W-2.5
G01 X28.0 F0.08
G04 X0.5
G00 X42.0
(CUTOFF PLUNGE)
G00 Z-45.0
G01 X0. F0.06
G00 X45.0 Z10.0
M09
M05
G28 U0. W0.
M30
%`
  },

  threading_g76: {
    title: 'Нарезание резьбы M30x2.0 (O5005)',
    desc: 'Многопроходный резьбовой цикл Fanuc G76 с чистовыми проходами',
    code: `%
O5005 (THREAD M30X2.0)
G21 G40 G97 G99
G28 U0. W0.
(THREADING TOOL)
T0303
G97 S650 M03
M08
G00 X34.0 Z5.0
(G76 THREAD CYCLE)
G76 P010060 Q100 R0.05
G76 X27.55 Z-30.0 P1227 Q250 F2.0
G00 X40.0 Z10.0
M09
M05
G28 U0. W0.
M30
%`
  }
};

/**
 * Generate a realistic high-resolution photo of a Fanuc 0i-TF Screen
 * Rendered at 1280x900 (Retina HD) with crisp Fanuc monospace font
 */
function createSyntheticFanucScreen(programKey = 'g71_cycle') {
  const prog = SAMPLE_FANUC_PROGRAMS[programKey] || SAMPLE_FANUC_PROGRAMS.g71_cycle;
  const lines = prog.code.split('\n').filter(l => l.trim().length > 0).slice(0, 20);

  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');

  // Dark industrial Fanuc CRT screen background
  ctx.fillStyle = '#060a08';
  ctx.fillRect(0, 0, 1280, 900);

  // Top header status bar
  ctx.fillStyle = '#16221f';
  ctx.fillRect(0, 0, 1280, 60);
  ctx.strokeStyle = '#2d3748';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 1280, 60);

  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 24px "Courier New", monospace';
  ctx.fillText('FANUC Series 0i - TF', 25, 40);

  ctx.fillStyle = '#10b981';
  ctx.font = 'bold 20px "Courier New", monospace';
  ctx.fillText('MEM   ST:STOP   *** *** ***', 780, 40);

  // Subheader: Program title row
  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 22px "Courier New", monospace';
  ctx.fillText('PROGRAM (MEM)   O2002', 40, 105);

  // Crisp High-Contrast Green Phosphor CRT text for G-code lines
  ctx.fillStyle = '#4ade80';
  ctx.font = 'bold 24px "Courier New", Courier, monospace';
  ctx.textBaseline = 'middle';

  let y = 150;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Draw G-code line clearly with generous line height for OCR
    ctx.fillText(line, 45, y);
    y += 36;
    if (y > 800) break;
  }

  // Bottom softkey bar
  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 830, 1280, 70);
  ctx.strokeStyle = '#374151';
  ctx.strokeRect(0, 830, 1280, 70);

  ctx.fillStyle = '#94a3b8';
  ctx.font = 'bold 18px "Courier New", monospace';
  const softkeys = ['[ PROGRAM ]', '[ DIR ]', '[ OPRT ]', '[ CHECK ]', '[ GRAPH ]'];
  for (let s = 0; s < softkeys.length; s++) {
    ctx.fillText(softkeys[s], 35 + (s * 250), 872);
  }

  return canvas;
}

if (typeof window !== 'undefined') {
  window.SAMPLE_FANUC_PROGRAMS = SAMPLE_FANUC_PROGRAMS;
  window.createSyntheticFanucScreen = createSyntheticFanucScreen;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SAMPLE_FANUC_PROGRAMS, createSyntheticFanucScreen };
}
