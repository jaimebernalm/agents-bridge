/* Full-bleed ASCII field. All glyphs and logo masks are cached locally. */
(() => {
  'use strict';

  const canvas = document.querySelector('canvas.ascii-field');
  const hero = canvas?.closest('.hero');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !hero || !ctx) return;

  // The logo masks are drawn from the page's own hidden SVG paths (#logo-claude, #logo-openai).
  const pathOf = id => document.getElementById(id)?.getAttribute('d') ?? '';
  const paths = { claude: pathOf('logo-claude'), openai: pathOf('logo-openai') };
  const glyphs = '.:;-=+*x#%';
  const maskSize = 384;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, time: 0, active: false, strength: 0 };
  const strokes = [];
  const atlas = document.createElement('canvas');
  const atlasCtx = atlas.getContext('2d');
  if (!atlasCtx) return;
  let width = 0, height = 0, dpr = 1, cells = [];
  let frame = 0, lastFrame = null, elapsed = 0, dirty = true;
  let visible = true, cellWidth = 8, cellHeight = 13;
  let atlasWidth = 0, atlasHeight = 0, columns = 0, rows = 0;
  let rippleStep = 18, rippleCols = 0, rippleRows = 0;
  let heights = new Float32Array(0), previous = new Float32Array(0);
  let simulationTime = 0;

  function resetRipples() {
    heights.fill(0);
    previous.fill(0);
    strokes.length = 0;
    simulationTime = 0;
    pointer.active = false;
    pointer.strength = 0;
  }
  function disturb(x, y, amount) {
    const gx = x / rippleStep + 1, gy = y / rippleStep + 1;
    const radius = 3;
    for (let row = Math.max(1, Math.floor(gy - radius)); row <= Math.min(rippleRows - 2, gy + radius); row++) {
      for (let col = Math.max(1, Math.floor(gx - radius)); col <= Math.min(rippleCols - 2, gx + radius); col++) {
        const distance = ((col - gx) ** 2 + (row - gy) ** 2) / 2.4;
        const impulse = Math.exp(-distance) * amount;
        const i = row * rippleCols + col;
        heights[i] = Math.max(-3, Math.min(3, heights[i] + impulse));
        previous[i] = Math.max(-3, Math.min(3, previous[i] + impulse * .55));
      }
    }
  }
  function advanceRipples(delta) {
    for (const stroke of strokes) {
      const length = Math.hypot(stroke.x - stroke.fromX, stroke.y - stroke.fromY);
      const steps = Math.min(16, Math.max(1, Math.ceil(length / (rippleStep * .7))));
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        disturb(stroke.fromX + (stroke.x - stroke.fromX) * t,
          stroke.fromY + (stroke.y - stroke.fromY) * t, stroke.energy / Math.sqrt(steps));
      }
    }
    strokes.length = 0;
    // Fixed 40ms steps keep propagation/damping stable when rendering slows.
    simulationTime = Math.min(simulationTime + delta, 120);
    while (simulationTime >= 40) {
      for (let row = 1; row < rippleRows - 1; row++) {
        for (let col = 1; col < rippleCols - 1; col++) {
          const i = row * rippleCols + col;
          const laplacian = heights[i - 1] + heights[i + 1]
            + heights[i - rippleCols] + heights[i + rippleCols] - heights[i] * 4;
          // Two height buffers implement a thick, viscous wave with absorbing edges: it spreads slowly and settles fast.
          const edge = Math.min(col, row, rippleCols - 1 - col, rippleRows - 1 - row);
          const damping = edge < 5 ? .88 + edge * .014 : .955;
          previous[i] = (2 * heights[i] - previous[i] + .16 * laplacian) * damping;
        }
      }
      [heights, previous] = [previous, heights];
      simulationTime -= 40;
    }
  }
  function interpolate(buffer, i, tx, ty, stride) {
    const a = buffer[i] * (1 - tx) + buffer[i + 1] * tx;
    const b = buffer[i + stride] * (1 - tx) + buffer[i + stride + 1] * tx;
    return a * (1 - ty) + b * ty;
  }

  function makeMask(path) {
    const mask = document.createElement('canvas');
    mask.width = mask.height = maskSize;
    const maskCtx = mask.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) return null;
    maskCtx.scale(maskSize / 24, maskSize / 24);
    maskCtx.fillStyle = '#fff';
    maskCtx.fill(new Path2D(path));
    return maskCtx.getImageData(0, 0, maskSize, maskSize).data;
  }
  const masks = [makeMask(paths.claude), makeMask(paths.openai)];

  function smoothstep(a, b, value) {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }
  function noise(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }
  function sampleMask(mask, x, y, left, top, size) {
    if (!mask) return 0;
    let coverage = 0;
    for (let sy = 0; sy < 3; sy++) {
      for (let sx = 0; sx < 3; sx++) {
        const mx = Math.floor((x + (sx / 2 - .5) * cellWidth - left) / size * maskSize);
        const my = Math.floor((y + (sy / 2 - .5) * cellHeight - top) / size * maskSize);
        if (mx >= 0 && my >= 0 && mx < maskSize && my < maskSize) {
          coverage += mask[(my * maskSize + mx) * 4 + 3] / (255 * 9);
        }
      }
    }
    return coverage;
  }
  function rgb(color, fallback) {
    // Resolve CSS colors with the canvas, including rgb() and color-mix().
    atlasCtx.fillStyle = fallback;
    atlasCtx.fillStyle = color || fallback;
    atlasCtx.fillRect(0, 0, 1, 1);
    return [...atlasCtx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  }
  function rebuild() {
    dirty = false;
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (!width || !height) return;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Bound the cell count on very wide screens as well as the backing-store DPR.
    cellWidth = Math.max(9, width / 190);
    cellHeight = cellWidth * 1.38;
    atlasWidth = Math.ceil(cellWidth * dpr);
    atlasHeight = Math.ceil(cellHeight * dpr);
    atlas.width = atlasWidth * 25;
    atlas.height = atlasHeight * glyphs.length;
    const style = getComputedStyle(canvas);
    const orange = rgb(style.getPropertyValue('--ascii-claude').trim(), '#ff7a3d');
    const white = rgb(style.getPropertyValue('--ascii-openai').trim(), '#f4f4f5');
    atlasCtx.clearRect(0, 0, atlas.width, atlas.height);
    atlasCtx.font = `500 ${cellHeight * .96 * dpr}px ${style.getPropertyValue('--mono').trim() || 'monospace'}`;
    atlasCtx.textAlign = 'center';
    atlasCtx.textBaseline = 'middle';
    for (let color = 0; color < 25; color++) {
      const mix = color / 24;
      const channels = orange.map((channel, i) => Math.round(channel + (white[i] - channel) * mix));
      atlasCtx.fillStyle = `rgb(${channels.join(',')})`;
      for (let i = 0; i < glyphs.length; i++) {
        atlasCtx.fillText(glyphs[i], (color + .5) * atlasWidth, (i + .5) * atlasHeight);
      }
    }
    columns = Math.ceil(width / cellWidth);
    rows = Math.ceil(height / cellHeight);
    rippleStep = Math.max(16, width / 100);
    rippleCols = Math.ceil(width / rippleStep) + 4;
    rippleRows = Math.ceil(height / rippleStep) + 4;
    heights = new Float32Array(rippleCols * rippleRows);
    previous = new Float32Array(heights.length);
    resetRipples();
    cells = [];
    const size = Math.min(width * .37, height * .62, 520);
    const logoY = height * .44 - size / 2;
    for (let row = 0; row < rows; row++) {
      const y = (row + .5) * cellHeight;
      for (let col = 0; col < columns; col++) {
        const x = (col + .5) * cellWidth;
        const seed = noise(col, row);
        const logo = Math.max(
          sampleMask(masks[0], x, y, width * .18 - size / 2, logoY, size),
          sampleMask(masks[1], x, y, width * .82 - size / 2, logoY, size));
        const color = Math.round(smoothstep(.28, .72, x / width) * 24);
        // Fixed glyphs prevent a noisy, flickering screen as the wave passes.
        const glyph = Math.min(glyphs.length - 1, Math.floor(seed * 7 + logo * 3));
        const gx = x / rippleStep + 1, gy = y / rippleStep + 1;
        cells.push({ x, y, nx: x / width, ny: y / height, color, glyph, seed,
          row, col, logo, balance: 1.12 - color / 24 * .25,
          rippleIndex: Math.floor(gy) * rippleCols + Math.floor(gx),
          tx: gx % 1, ty: gy % 1 });
      }
    }
  }
  function stamp(cell, glyph, x, y) {
    ctx.drawImage(atlas, cell.color * atlasWidth, glyph * atlasHeight,
      atlasWidth, atlasHeight, x - cellWidth / 2, y - cellHeight / 2,
      cellWidth, cellHeight);
  }
  function logoAt(x, y) {
    const col = Math.max(0, Math.min(columns - 1.001, x / cellWidth - .5));
    const row = Math.max(0, Math.min(rows - 1.001, y / cellHeight - .5));
    const i = Math.floor(row) * columns + Math.floor(col);
    const tx = col % 1, ty = row % 1;
    // The last row/column may be sampled on a very narrow canvas.
    const right = Math.min(i + 1, cells.length - 1);
    const below = Math.min(i + columns, cells.length - 1);
    const diagonal = Math.min(below + 1, cells.length - 1);
    return (cells[i].logo * (1 - tx) + cells[right].logo * tx) * (1 - ty)
      + (cells[below].logo * (1 - tx) + cells[diagonal].logo * tx) * ty;
  }
  function draw(delta) {
    ctx.clearRect(0, 0, width, height);
    const still = reducedMotion.matches;
    if (!still) advanceRipples(delta);
    const time = still ? 0 : elapsed / 1000;
    pointer.strength += ((pointer.active && !still ? 1 : 0) - pointer.strength)
      * (1 - Math.exp(-delta / 220));
    for (const cell of cells) {
      const { rippleIndex: i, tx, ty } = cell;
      const height = interpolate(heights, i, tx, ty, rippleCols);
      const slopeX = (interpolate(heights, i + 1, tx, ty, rippleCols)
        - interpolate(heights, i - 1, tx, ty, rippleCols)) * .5;
      const slopeY = (interpolate(heights, i + rippleCols, tx, ty, rippleCols)
        - interpolate(heights, i - rippleCols, tx, ty, rippleCols)) * .5;
      // Several narrow, curved wavefronts travel slowly across the whole field.
      const phase = cell.ny * 38 + cell.nx * 11
        + Math.sin(cell.nx * 7.2 - time * .12) * 1.3 - time * .3;
      const crossPhase = cell.nx * 26 - cell.ny * 17 + time * .2
        + Math.sin(cell.ny * 5 + time * .08);
      const wave = Math.pow(.5 + .5 * Math.sin(phase), 5);
      const crossWave = Math.pow(.5 + .5 * Math.sin(crossPhase), 7);
      const wake = still ? 0 : Math.min(1, Math.abs(height) * .3 + Math.hypot(slopeX, slopeY) * 1.4);
      const refractX = Math.tanh(slopeX * 2) * 12;
      const refractY = Math.tanh(slopeY * 2) * 12;
      const logo = wake > .002 ? logoAt(cell.x + refractX, cell.y + refractY) : cell.logo;
      const distance = ((cell.x - pointer.x) ** 2 + (cell.y - pointer.y) ** 2) / (125 ** 2);
      const glow = Math.exp(-distance * 1.8) * pointer.strength;
      const extra = wake * (.13 + logo * .16) + glow * (.035 + logo * .07);
      const ambient = (.04 + wave * .20 + crossWave * .08) * (.72 + cell.seed * .28);
      const base = (.14 + cell.seed * .06 + logo * .18) * cell.balance;
      ctx.globalAlpha = Math.min(.85, base + (1 - base) * (ambient + extra) * cell.balance);
      // Density changes in the wake, while ambient motion keeps glyphs stable.
      const glyph = Math.min(glyphs.length - 1, Math.floor(cell.seed * 7 + logo * 3 + wake * 3));
      const driftX = still ? 0 : Math.sin(phase * .7) * .6;
      const driftY = still ? 0 : Math.cos(crossPhase * .6) * .8;
      stamp(cell, glyph, cell.x + driftX + refractX * .45, cell.y + driftY + refractY * .45);
    }
    ctx.globalAlpha = 1;
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = null;
  }
  function schedule() {
    if (!frame && visible && !document.hidden) frame = requestAnimationFrame(render);
  }
  function render(time) {
    frame = 0;
    const delta = lastFrame === null ? 40 : time - lastFrame;
    if (!dirty && delta < 40 && !reducedMotion.matches) { schedule(); return; }
    if (!reducedMotion.matches && lastFrame !== null) elapsed += Math.min(delta, 100);
    lastFrame = time;
    if (dirty || dpr !== Math.min(window.devicePixelRatio || 1, 2)) rebuild();
    if (width && height) draw(delta);
    if (!reducedMotion.matches) schedule();
  }
  function resize() { dirty = true; schedule(); }
  window.addEventListener('resize', resize, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(hero);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting;
      if (visible) schedule(); else { leave(); stop(); }
    }).observe(hero);
  }
  function move(event) {
    if (reducedMotion.matches || !visible || document.hidden || !width || !height) return;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const fromX = pointer.active ? pointer.x : x;
    const fromY = pointer.active ? pointer.y : y;
    const time = event.timeStamp || 0;
    const speed = Math.hypot(x - fromX, y - fromY) / Math.max(8, time - pointer.time);
    if (x >= 0 && y >= 0 && x <= width && y <= height) {
      if (strokes.length >= 24) strokes.shift();
      strokes.push({ x, y, fromX, fromY, energy: .05 + Math.min(speed, 2.5) * .22 });
      pointer.x = x;
      pointer.y = y;
      pointer.time = time;
      pointer.active = true;
    }
  }
  // Passive touch/pointer listeners leave native page scrolling untouched.
  hero.addEventListener('pointerdown', move, { passive: true });
  hero.addEventListener('pointermove', move, { passive: true });
  function leave() { pointer.active = false; }
  hero.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') leave(); }, { passive: true });
  hero.addEventListener('pointerleave', leave);
  hero.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { leave(); stop(); } else schedule();
  });
  reducedMotion.addEventListener('change', () => {
    resetRipples();
    elapsed = 0;
    stop();
    schedule();
  });
  if (document.fonts) document.fonts.ready.then(resize);
  schedule();
})();
