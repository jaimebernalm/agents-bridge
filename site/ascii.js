/* Full-bleed ASCII field. All glyphs and logo masks are cached locally. */
(() => {
  'use strict';

  const canvas = document.querySelector('canvas.ascii-field');
  const hero = canvas?.closest('.hero');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !hero || !ctx) return;

  // Simple Icons 13.21.0 (CC0 SVG geometry; trademarks belong to their owners).
  // https://cdn.jsdelivr.net/npm/simple-icons@13.21.0/icons/{claude,openai}.svg
  const paths = {
    claude: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z',
    openai: 'M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z',
  };
  const glyphs = '.:;-=+*x#%';
  const maskSize = 384;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const pointer = { x: 0, y: 0, active: false, strength: 0 };
  const base = document.createElement('canvas');
  const baseCtx = base.getContext('2d');
  const atlas = document.createElement('canvas');
  const atlasCtx = atlas.getContext('2d');
  if (!baseCtx || !atlasCtx) return;
  let width = 0, height = 0, dpr = 1, cells = [];
  let frame = 0, lastFrame = null, elapsed = 0, dirty = true;
  let visible = true, cellWidth = 8, cellHeight = 13;
  let atlasWidth = 0, atlasHeight = 0;

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
    canvas.width = base.width = Math.round(width * dpr);
    canvas.height = base.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    baseCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    cells = [];
    const size = Math.min(width * .37, height * .62, 520);
    const logoY = height * .44 - size / 2;
    for (let row = 0, y = cellHeight / 2; y < height; row++, y += cellHeight) {
      for (let col = 0, x = cellWidth / 2; x < width; col++, x += cellWidth) {
        const seed = noise(col, row);
        const logo = Math.max(
          sampleMask(masks[0], x, y, width * .18 - size / 2, logoY, size),
          sampleMask(masks[1], x, y, width * .82 - size / 2, logoY, size));
        const color = Math.round(smoothstep(.28, .72, x / width) * 24);
        // Fixed glyphs prevent a noisy, flickering screen as the wave passes.
        const glyph = Math.min(glyphs.length - 1, Math.floor(seed * 7 + logo * 3));
        const cell = { x, y, nx: x / width, ny: y / height, color, glyph, seed,
          logo, balance: 1.12 - color / 24 * .25 };
        cells.push(cell);
        baseCtx.globalAlpha = (.14 + seed * .06 + logo * .18) * cell.balance;
        stamp(baseCtx, cell);
      }
    }
    baseCtx.globalAlpha = 1;
  }
  function stamp(target, cell) {
    target.drawImage(atlas, cell.color * atlasWidth, cell.glyph * atlasHeight,
      atlasWidth, atlasHeight, cell.x - cellWidth / 2, cell.y - cellHeight / 2,
      cellWidth, cellHeight);
  }
  function draw(delta) {
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.drawImage(base, 0, 0, base.width, base.height, 0, 0, width, height);
    const time = elapsed / 1000;
    pointer.strength += ((pointer.active ? 1 : 0) - pointer.strength) * (1 - Math.exp(-delta / 220));
    for (const cell of cells) {
      // One very broad crest: ~90 seconds per cycle, no hard wave edge.
      const crest = .49 + Math.sin(cell.nx * 5.4 - time * .07) * .15
        + Math.sin(cell.nx * 2.8 + time * .045) * .06;
      const distance = (cell.ny - crest) / .20;
      const wave = Math.exp(-distance * distance * 2);
      const secondary = Math.exp(-Math.pow((cell.ny - crest - .24) / .25, 2) * 2);
      const dx = (cell.x - pointer.x) / 125;
      const dy = (cell.y - pointer.y) / 125;
      const hover = Math.exp(-(dx * dx + dy * dy) * 1.8) * pointer.strength * .05;
      ctx.globalAlpha = ((wave * .40 + secondary * .055) * (.72 + cell.seed * .28) + hover) * cell.balance;
      if (ctx.globalAlpha > .004) stamp(ctx, cell);
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
      if (visible) schedule(); else stop();
    }).observe(hero);
  }
  hero.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || reducedMotion.matches) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
    pointer.active = true;
  }, { passive: true });
  function leave() { pointer.active = false; }
  hero.addEventListener('pointerleave', leave);
  hero.addEventListener('pointercancel', leave);
  window.addEventListener('blur', leave);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { leave(); stop(); } else schedule();
  });
  reducedMotion.addEventListener('change', () => {
    pointer.active = false;
    pointer.strength = 0;
    elapsed = 0;
    stop();
    schedule();
  });
  if (document.fonts) document.fonts.ready.then(resize);
  schedule();
})();
