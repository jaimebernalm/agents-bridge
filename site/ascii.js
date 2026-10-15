/* Decorative, procedural ASCII marks. No images, dependencies or idle animation. */
(() => {
  'use strict';

  const canvases = [...document.querySelectorAll('canvas.ascii-bg[data-logo]')];
  if (!canvases.length) return;

  const ramp = ' .:-=+*#%@';
  const maskSize = 320;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, active: false };
  let frame = 0;
  let previousTime = 0;

  function surface() {
    return document.createElement('canvas');
  }

  // These are hand-drawn approximations, rather than copies of brand SVGs.
  function makeMask(logo) {
    const canvas = surface();
    canvas.width = canvas.height = maskSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, maskSize, maskSize);
    ctx.translate(maskSize / 2, maskSize / 2);
    ctx.scale(maskSize * 0.92, maskSize * 0.92);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';

    if (logo === 'claude') {
      const lengths = [0.47, 0.38, 0.46, 0.40, 0.48, 0.39, 0.46, 0.42, 0.49, 0.39, 0.45, 0.41];
      lengths.forEach((length, i) => {
        ctx.save();
        ctx.rotate(i * Math.PI / 6 + 0.1);
        ctx.beginPath();
        ctx.moveTo(-0.058, 0.075);
        ctx.lineTo(-0.033, -length * 0.91);
        ctx.lineTo(0.019, -length);
        ctx.lineTo(0.065, 0.035);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    } else {
      // Six rounded links, rotated around a shared hexagonal opening.
      for (let i = 0; i < 6; i++) {
        ctx.save();
        ctx.rotate(i * Math.PI / 3);
        ctx.lineWidth = 0.047;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(0.015, -0.18);
        ctx.lineTo(0.015, -0.31);
        ctx.bezierCurveTo(0.015, -0.47, 0.23, -0.51, 0.31, -0.37);
        ctx.lineTo(0.395, -0.225);
        ctx.bezierCurveTo(0.47, -0.095, 0.35, 0.04, 0.225, -0.025);
        ctx.lineTo(0.015, -0.145);
        ctx.stroke();
        ctx.restore();
      }
    }
    return ctx.getImageData(0, 0, maskSize, maskSize).data;
  }

  function glyphLayer(state, cellHeight, color) {
    const canvas = surface();
    canvas.width = state.canvas.width;
    canvas.height = state.canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    ctx.scale(state.dpr, state.dpr);
    ctx.fillStyle = color;
    ctx.font = `${cellHeight}px ${state.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cellWidth = cellHeight * 0.62;
    const size = Math.min(state.width, state.height);
    // Keep the central headline clear; the outer edges may crop the marks.
    const outward = state.canvas.dataset.logo === 'claude' ? -1 : 1;
    const left = (state.width - size) / 2 + outward * size * 0.18;
    const top = (state.height - size) / 2;
    for (let y = cellHeight / 2; y < state.height; y += cellHeight) {
      for (let x = cellWidth / 2; x < state.width; x += cellWidth) {
        let luminance = 0;
        // Average a cell's area so narrow rays survive coarse sampling.
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const mx = Math.floor((x + (sx / 3 - 0.5) * cellWidth - left) / size * maskSize);
            const my = Math.floor((y + (sy / 3 - 0.5) * cellHeight - top) / size * maskSize);
            if (mx >= 0 && mx < maskSize && my >= 0 && my < maskSize) {
              luminance += state.mask[(my * maskSize + mx) * 4] / (255 * 16);
            }
          }
        }
        const index = Math.min(ramp.length - 1, Math.round(luminance * (ramp.length - 1)));
        if (index) ctx.fillText(ramp[index], x, y);
      }
    }
    return canvas;
  }

  const states = canvases.flatMap(canvas => {
    if (!['claude', 'openai'].includes(canvas.dataset.logo)) return [];
    const ctx = canvas.getContext('2d');
    const mask = makeMask(canvas.dataset.logo);
    const lens = surface();
    const lensCtx = lens.getContext('2d');
    if (!ctx || !mask || !lensCtx) return [];
    return [{ canvas, ctx, mask, lens, lensCtx, dirty: true, width: 0, height: 0,
      x: 0, y: 0, radius: 0, targetRadius: 0, positioned: false }];
  });
  if (!states.length) return;

  function schedule() {
    if (!frame && !document.hidden) frame = requestAnimationFrame(render);
  }

  function rebuild(state) {
    state.dirty = false;
    const rect = state.canvas.getBoundingClientRect();
    state.width = rect.width;
    state.height = rect.height;
    if (!state.width || !state.height) return;
    state.dpr = Math.min(window.devicePixelRatio || 1, 3);
    state.canvas.width = Math.round(state.width * state.dpr);
    state.canvas.height = Math.round(state.height * state.dpr);
    state.lens.width = state.canvas.width;
    state.lens.height = state.canvas.height;
    const style = getComputedStyle(state.canvas);
    state.font = style.getPropertyValue('--mono').trim() || 'ui-monospace, monospace';
    state.coarse = glyphLayer(state, 15, style.getPropertyValue('--ascii-ink').trim() || '#5c3626');
    state.fine = glyphLayer(state, 7, style.getPropertyValue('--ascii-hot').trim() || '#d97757');
  }

  function draw(state) {
    const { ctx, lensCtx, canvas } = state;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(state.coarse, 0, 0);
    if (state.radius < 0.1) return;

    const x = state.x * state.dpr;
    const y = state.y * state.dpr;
    const radius = state.radius * state.dpr;
    const gradient = ctx.createRadialGradient(x, y, radius * 0.55, x, y, radius);
    gradient.addColorStop(0, '#000');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';

    lensCtx.clearRect(0, 0, canvas.width, canvas.height);
    lensCtx.drawImage(state.fine, 0, 0);
    lensCtx.globalCompositeOperation = 'destination-in';
    lensCtx.fillStyle = gradient;
    lensCtx.fillRect(0, 0, canvas.width, canvas.height);
    lensCtx.globalCompositeOperation = 'source-over';
    ctx.drawImage(state.lens, 0, 0);
  }

  function render(time) {
    frame = 0;
    const delta = previousTime ? Math.min(64, time - previousTime) : 16;
    const ease = reducedMotion.matches ? 1 : 1 - Math.exp(-delta / 50);
    let settling = false;
    for (const state of states) {
      if (state.dirty || state.dpr !== Math.min(window.devicePixelRatio || 1, 3)) rebuild(state);
      if (!state.width || !state.height) continue;
      const rect = state.canvas.getBoundingClientRect();
      const x = pointer.x - rect.left;
      const y = pointer.y - rect.top;
      const near = pointer.active && x > -140 && y > -140 && x < state.width + 140 && y < state.height + 140;
      state.targetRadius = near ? 140 : 0;
      if (!state.positioned || state.radius < 0.1) {
        state.x = x;
        state.y = y;
        state.positioned = true;
      }
      state.x += (x - state.x) * ease;
      state.y += (y - state.y) * ease;
      state.radius += (state.targetRadius - state.radius) * ease;
      const moving = Math.abs(state.x - x) + Math.abs(state.y - y) > 0.2;
      const growing = Math.abs(state.radius - state.targetRadius) > 0.2;
      if (!growing) state.radius = state.targetRadius;
      if (!moving) { state.x = x; state.y = y; }
      settling ||= growing || (state.targetRadius > 0 && moving);
      draw(state);
    }
    previousTime = settling ? time : 0;
    if (settling) schedule();
  }

  window.addEventListener('pointermove', event => {
    // Touch devices keep the static background and native scroll behavior.
    if (event.pointerType === 'touch') return;
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.active = true;
    schedule();
  }, { passive: true });
  function leave() {
    pointer.active = false;
    schedule();
  }
  document.documentElement.addEventListener('pointerleave', leave);
  window.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  window.addEventListener('scroll', schedule, { passive: true });
  function resize() {
    states.forEach(state => { state.dirty = true; });
    schedule();
  }
  window.addEventListener('resize', resize, { passive: true });
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(resize);
    states.forEach(state => observer.observe(state.canvas));
  }
  reducedMotion.addEventListener('change', schedule);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      pointer.active = false;
    } else schedule();
  });
  // Web fonts may arrive after the initial cached glyph layers.
  if (document.fonts) document.fonts.ready.then(resize);
  schedule();
})();
