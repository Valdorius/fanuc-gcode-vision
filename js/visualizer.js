/**
 * Fanuc 0i-TF 2D Turning Toolpath Visualizer
 * Specializes in Lathe coordinate systems:
 * - Horizontal Z axis (Z=0 face, Z- spindle/chuck, Z+ tailstock)
 * - Vertical X axis (Diameter / Radius mode)
 * - Workpiece body of revolution with symmetry reflection
 * - Dynamic CNMG/WNMG lathe insert tool simulation
 * - Interactive Pan/Zoom, touch gestures, and segment stepping
 */

class LatheVisualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    // Display options
    this.diameterMode = true; // Fanuc default
    this.showRevolutionBody = true;
    this.showRapids = true;
    this.showGrid = true;
    this.showTool = true;

    // Viewport transform
    this.zoom = 4.0; // Pixels per mm
    this.panX = 0;   // In pixels
    this.panY = 0;   // In pixels

    // Playback state
    this.segments = [];
    this.currentStep = -1; // -1 = show all

    this.isDragging = false;
    this.lastMouseX = 0;
    this.lastMouseY = 0;
    this.initialPinchDistance = null;

    this.initEvents();
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.resetTransform();
    this.ctx.scale(dpr, dpr);
    this.render();
  }

  setSegments(segments) {
    this.segments = segments || [];
    this.currentStep = this.segments.length; // Show all by default
    this.fitView();
    this.render();
  }

  setStep(stepIndex) {
    this.currentStep = Math.max(-1, Math.min(stepIndex, this.segments.length));
    this.render();
  }

  /**
   * Fit view to center the part with margin
   */
  fitView() {
    if (!this.segments.length) {
      this.panX = this.canvas.clientWidth * 0.7;
      this.panY = this.canvas.clientHeight * 0.5;
      this.zoom = 5;
      return;
    }

    let minZ = Infinity, maxZ = -Infinity;
    let minR = 0, maxR = -Infinity;

    for (const seg of this.segments) {
      const r1 = seg.startX / (this.diameterMode ? 2 : 1);
      const r2 = seg.endX / (this.diameterMode ? 2 : 1);
      minZ = Math.min(minZ, seg.startZ, seg.endZ);
      maxZ = Math.max(maxZ, seg.startZ, seg.endZ);
      maxR = Math.max(maxR, r1, r2);
    }

    const partLenZ = Math.max(10, maxZ - minZ);
    const partHeightR = Math.max(10, maxR * 2); // Full diameter height

    const cw = this.canvas.clientWidth;
    const ch = this.canvas.clientHeight;

    const zoomZ = (cw * 0.75) / partLenZ;
    const zoomR = (ch * 0.65) / partHeightR;
    this.zoom = Math.min(zoomZ, zoomR, 20.0);
    this.zoom = Math.max(this.zoom, 0.5);

    // Position Z=0 toward the right, center of rotation vertically in center
    const centerZ = (minZ + maxZ) / 2;
    this.panX = cw / 2 - (centerZ * this.zoom);
    this.panY = ch / 2;
  }

  // World coordinates (Z mm, Radius mm) to Screen Canvas pixels
  toScreen(zMm, radiusMm) {
    // Z increases to the right: screenX = panX + z * zoom
    // Radius increases upwards: screenY = panY - radius * zoom
    return {
      x: this.panX + (zMm * this.zoom),
      y: this.panY - (radiusMm * this.zoom)
    };
  }

  toWorld(screenX, screenY) {
    return {
      z: (screenX - this.panX) / this.zoom,
      radius: (this.panY - screenY) / this.zoom
    };
  }

  render() {
    const ctx = this.ctx;
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;

    // Clear background (Dark industrial slate)
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, width, height);

    if (this.showGrid) {
      this.drawGrid(ctx, width, height);
    }

    // Draw Chuck / Spindle representation on the far left
    this.drawChuck(ctx);

    // Draw Centerline of Rotation (Z axis)
    this.drawCenterline(ctx, width);

    if (!this.segments.length) {
      this.drawPlaceholder(ctx, width, height);
      return;
    }

    const visibleSegments = this.currentStep === -1
      ? this.segments
      : this.segments.slice(0, this.currentStep);

    // Draw Workpiece Solid Body of Revolution (if enabled)
    if (this.showRevolutionBody) {
      this.drawWorkpieceBody(ctx, visibleSegments);
    }

    // Draw Toolpaths (G00 rapids, G01/G02/G03 feeds)
    this.drawToolpaths(ctx, visibleSegments);

    // Draw Current Tool Insert at the tip of the latest active move
    if (this.showTool && visibleSegments.length > 0) {
      const lastSeg = visibleSegments[visibleSegments.length - 1];
      const r = lastSeg.endX / (this.diameterMode ? 2 : 1);
      this.drawLatheTool(ctx, lastSeg.endZ, r, lastSeg.motion);
    }

    // Draw Coordinate / Scale HUD
    this.drawHUD(ctx, width, height);
  }

  drawGrid(ctx, width, height) {
    ctx.save();
    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 1;

    // Step in mm based on zoom
    let stepMm = 10;
    if (this.zoom * stepMm < 30) stepMm = 50;
    if (this.zoom * stepMm > 150) stepMm = 2;

    const leftWorld = this.toWorld(0, 0).z;
    const rightWorld = this.toWorld(width, 0).z;
    const startZ = Math.floor(leftWorld / stepMm) * stepMm;

    // Vertical grid lines (Z steps)
    ctx.beginPath();
    for (let z = startZ; z <= rightWorld; z += stepMm) {
      const p = this.toScreen(z, 0);
      ctx.moveTo(p.x, 0);
      ctx.lineTo(p.x, height);
    }

    // Horizontal grid lines (Radius steps)
    const topRadius = this.toWorld(0, 0).radius;
    const bottomRadius = this.toWorld(0, height).radius;
    const startR = Math.floor(bottomRadius / stepMm) * stepMm;

    for (let r = startR; r <= topRadius; r += stepMm) {
      const p = this.toScreen(0, r);
      ctx.moveTo(0, p.y);
      ctx.lineTo(width, p.y);
    }
    ctx.stroke();

    // Minor coordinates text
    ctx.fillStyle = '#475569';
    ctx.font = '10px monospace';
    for (let z = startZ; z <= rightWorld; z += stepMm * 2) {
      const p = this.toScreen(z, 0);
      if (p.x > 30 && p.x < width - 30) {
        ctx.fillText(`Z${z}`, p.x + 2, this.panY + 14);
      }
    }
    ctx.restore();
  }

  drawCenterline(ctx, width) {
    ctx.save();
    ctx.strokeStyle = '#ef4444'; // Red dash-dot line for axis of revolution
    ctx.lineWidth = 1.5;
    ctx.setLineDash([12, 4, 3, 4]); // Dash-dot standard
    ctx.beginPath();
    ctx.moveTo(0, this.panY);
    ctx.lineTo(width, this.panY);
    ctx.stroke();

    // Origin marker at (Z=0, X=0)
    const origin = this.toScreen(0, 0);
    ctx.setLineDash([]);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(origin.x, origin.y, 4, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#f59e0b';
    ctx.font = '11px sans-serif';
    ctx.fillText('Z0, X0 (Торец детали)', origin.x + 8, origin.y - 8);
    ctx.restore();
  }

  drawChuck(ctx) {
    let minZ = 0;
    for (const s of this.segments) {
      minZ = Math.min(minZ, s.startZ, s.endZ);
    }
    const chuckZ = minZ - 5;
    const p = this.toScreen(chuckZ, 0);

    ctx.save();
    // Chuck face
    ctx.fillStyle = '#334155';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;

    const chuckWidth = 40;
    const chuckHeight = 180;
    ctx.fillRect(p.x - chuckWidth, p.y - chuckHeight / 2, chuckWidth, chuckHeight);
    ctx.strokeRect(p.x - chuckWidth, p.y - chuckHeight / 2, chuckWidth, chuckHeight);

    // Chuck Jaws (кулачки патрона)
    ctx.fillStyle = '#475569';
    // Top jaw
    ctx.fillRect(p.x - 15, p.y - 70, 20, 30);
    ctx.strokeRect(p.x - 15, p.y - 70, 20, 30);
    // Bottom jaw
    ctx.fillRect(p.x - 15, p.y + 40, 20, 30);
    ctx.strokeRect(p.x - 15, p.y + 40, 20, 30);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('Шпиндель / Патрон', p.x - chuckWidth - 2, p.y - chuckHeight / 2 - 6);
    ctx.restore();
  }

  drawWorkpieceBody(ctx, segments) {
    // Collect cutting profile points (G01, G02, G03)
    const cutSegments = segments.filter(s => s.motion > 0 && !s.isCycleSubmove);
    if (!cutSegments.length) return;

    ctx.save();
    ctx.beginPath();

    // Draw upper contour
    let first = true;
    for (const seg of cutSegments) {
      const r1 = seg.startX / (this.diameterMode ? 2 : 1);
      const r2 = seg.endX / (this.diameterMode ? 2 : 1);
      const p1 = this.toScreen(seg.startZ, r1);
      const p2 = this.toScreen(seg.endZ, r2);

      if (first) {
        ctx.moveTo(p1.x, p1.y);
        first = false;
      }
      ctx.lineTo(p2.x, p2.y);
    }

    // Mirror lower contour backwards
    for (let i = cutSegments.length - 1; i >= 0; i--) {
      const seg = cutSegments[i];
      const r1 = seg.startX / (this.diameterMode ? 2 : 1);
      const r2 = seg.endX / (this.diameterMode ? 2 : 1);
      // Mirrored radius is negative
      const p2m = this.toScreen(seg.endZ, -r2);
      const p1m = this.toScreen(seg.startZ, -r1);
      ctx.lineTo(p2m.x, p2m.y);
      ctx.lineTo(p1m.x, p1m.y);
    }

    ctx.closePath();

    // Metallic gradient fill
    const grad = ctx.createLinearGradient(0, this.panY - 60, 0, this.panY + 60);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0.25)'); // Light steel cyan
    grad.addColorStop(0.5, 'rgba(148, 163, 184, 0.45)'); // Bright reflection at centerline
    grad.addColorStop(1, 'rgba(30, 58, 138, 0.25)'); // Dark bottom shadow
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle edge contour
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();
  }

  drawToolpaths(ctx, segments) {
    ctx.save();

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLatest = (i === segments.length - 1);

      const r1 = seg.startX / (this.diameterMode ? 2 : 1);
      const r2 = seg.endX / (this.diameterMode ? 2 : 1);
      const p1 = this.toScreen(seg.startZ, r1);
      const p2 = this.toScreen(seg.endZ, r2);

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);

      if (seg.motion === 0) {
        // G00 Rapid Positioning: dashed yellow/amber
        if (!this.showRapids) continue;
        ctx.strokeStyle = isLatest ? '#fbbf24' : '#d97706';
        ctx.lineWidth = isLatest ? 2.0 : 1.2;
        ctx.setLineDash([5, 4]);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      } else if (seg.motion === 1) {
        // G01 Linear Feed Cut: vibrant solid lime green
        ctx.setLineDash([]);
        ctx.strokeStyle = isLatest ? '#4ade80' : '#22c55e';
        ctx.lineWidth = isLatest ? 3.0 : 2.0;
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      } else if (seg.motion === 2 || seg.motion === 3) {
        // G02 / G03 Circular Arcs: Cyan/Magenta
        ctx.setLineDash([]);
        ctx.strokeStyle = seg.motion === 2 ? '#38bdf8' : '#e879f9';
        ctx.lineWidth = isLatest ? 3.0 : 2.2;

        // Approximate arc with segments
        this.drawArcSegment(ctx, seg, r1, r2);
      }

      // Small vertex dot
      ctx.setLineDash([]);
      ctx.fillStyle = seg.motion === 0 ? '#f59e0b' : '#10b981';
      ctx.beginPath();
      ctx.arc(p2.x, p2.y, isLatest ? 4 : 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  drawArcSegment(ctx, seg, r1, r2) {
    // Simple 3-point Bézier or circular subdivision
    const p1 = this.toScreen(seg.startZ, r1);
    const p2 = this.toScreen(seg.endZ, r2);

    let ctrlZ = (seg.startZ + seg.endZ) / 2;
    let ctrlR = (r1 + r2) / 2;

    const r = seg.arcR || 5.0;
    const bulge = seg.motion === 2 ? (r / 2) : -(r / 2);
    ctrlR += bulge;

    const pCtrl = this.toScreen(ctrlZ, ctrlR);
    ctx.quadraticCurveTo(pCtrl.x, pCtrl.y, p2.x, p2.y);
    ctx.stroke();
  }

  drawLatheTool(ctx, zMm, radiusMm, motion) {
    const tip = this.toScreen(zMm, radiusMm);

    ctx.save();
    ctx.translate(tip.x, tip.y);

    // Lathe insert diamond (80 deg rhombus / CNMG type)
    // Tool comes from top-right (+X, +Z)
    ctx.beginPath();
    ctx.moveTo(0, 0); // Tool nose radius tip
    ctx.lineTo(14, -18);
    ctx.lineTo(26, -14);
    ctx.lineTo(12, 4);
    ctx.closePath();

    // Insert color (Gold carbide)
    ctx.fillStyle = '#fbbf24';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    // Chipbreaker hole in center of insert
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.arc(13, -7, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Steel Toolholder shank
    ctx.fillStyle = '#475569';
    ctx.strokeStyle = '#334155';
    ctx.beginPath();
    ctx.moveTo(14, -18);
    ctx.lineTo(26, -14);
    ctx.lineTo(55, -28);
    ctx.lineTo(45, -45);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Motion indicator badge
    ctx.fillStyle = motion === 0 ? '#f59e0b' : '#22c55e';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(motion === 0 ? 'G0' : 'G1', -16, -10);

    ctx.restore();
  }

  drawHUD(ctx, width, height) {
    ctx.save();
    // Top right mode info
    ctx.fillStyle = 'rgba(15, 23, 42, 0.75)';
    ctx.fillRect(width - 160, 10, 150, 48);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.strokeRect(width - 160, 10, 150, 48);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px monospace';
    ctx.fillText(`РЕЖИМ: FANUC 0i-TF`, width - 150, 24);
    ctx.fillText(`X: ${this.diameterMode ? 'ДИАМЕТР (⌀)' : 'РАДИУС'}`, width - 150, 37);
    ctx.fillText(`МАСШТАБ: ${this.zoom.toFixed(1)} px/мм`, width - 150, 50);

    ctx.restore();
  }

  drawPlaceholder(ctx, width, height) {
    ctx.save();
    ctx.fillStyle = '#64748b';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Загрузите фото или выберите пример программы', width / 2, height / 2 - 10);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#475569';
    ctx.fillText('Траектория токарной обработки отобразится здесь', width / 2, height / 2 + 15);
    ctx.restore();
  }

  initEvents() {
    const canvas = this.canvas;

    // Mouse drag
    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouseX;
      const dy = e.clientY - this.lastMouseY;
      this.panX += dx;
      this.panY += dy;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.render();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    // Mouse wheel zoom
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      const mouse = this.toWorld(e.offsetX, e.offsetY);
      this.zoom = Math.max(0.2, Math.min(this.zoom * zoomFactor, 100));
      // Re-anchor to mouse position
      this.panX = e.offsetX - (mouse.z * this.zoom);
      this.panY = e.offsetY + (mouse.radius * this.zoom);
      this.render();
    }, { passive: false });

    // Touch support (mobile pan & pinch-to-zoom)
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this.isDragging = true;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this.isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this.initialPinchDistance = Math.hypot(dx, dy);
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this.isDragging) {
        const dx = e.touches[0].clientX - this.lastMouseX;
        const dy = e.touches[0].clientY - this.lastMouseY;
        this.panX += dx;
        this.panY += dy;
        this.lastMouseX = e.touches[0].clientX;
        this.lastMouseY = e.touches[0].clientY;
        this.render();
      } else if (e.touches.length === 2 && this.initialPinchDistance) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / this.initialPinchDistance;
        this.zoom = Math.max(0.2, Math.min(this.zoom * (factor > 1 ? 1.05 : 0.95), 100));
        this.initialPinchDistance = dist;
        this.render();
      }
    }, { passive: true });

    canvas.addEventListener('touchend', () => {
      this.isDragging = false;
      this.initialPinchDistance = null;
    });
  }
}

if (typeof window !== 'undefined') {
  window.LatheVisualizer = LatheVisualizer;
}
