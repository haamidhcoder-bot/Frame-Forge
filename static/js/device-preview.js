'use strict';
/* FrameForge device preview. This is deliberately isolated from the editor canvas and prototype player. */
(() => {
  const $d = id => document.getElementById(id);
  const presets = {
    iphone: { name: 'iPhone 16', w: 393, h: 852, radius: 38, bezel: 10 },
    'iphone-pro': { name: 'iPhone 16 Pro Max', w: 440, h: 956, radius: 42, bezel: 11 },
    pixel: { name: 'Google Pixel 9', w: 412, h: 915, radius: 30, bezel: 9 },
    samsung: { name: 'Samsung Galaxy S24', w: 384, h: 854, radius: 30, bezel: 9 },
    ipad: { name: 'iPad', w: 820, h: 1180, radius: 24, bezel: 12 },
    custom: { name: 'Custom', w: 393, h: 852, radius: 24, bezel: 10 },
  };
  const state = { open: false, frameId: null, w: 393, h: 852, zoom: 'fit', frame: true, history: [], historyIndex: -1, lastBuilt: null };
  const modal = $d('devicePreview');
  if (!modal) return;

  function getFrame() {
    resolveAll();
    const frames = RES.filter(f => f.type === 'frame' && !f.parent && !f.isComp);
    if (!frames.length) return null;
    const selected = S.sel.length ? rootOf(get(S.sel[0])) : null;
    return selected && frames.some(f => f.id === selected.id) ? selected : frames.find(f => f.page === S.page) || frames[0];
  }
  function openDevicePreview() {
    const frame = getFrame();
    if (!frame) return toast('Create a frame before opening Device Preview', true);
    state.open = true; state.frameId = frame.id; state.history = [frame.id]; state.historyIndex = 0;
    const preset = presets.iphone;
    state.w = preset.w; state.h = preset.h; state.zoom = 'fit'; state.frame = true;
    $d('devicePreset').value = 'iphone'; $d('deviceWidth').value = state.w; $d('deviceHeight').value = state.h;
    $d('deviceZoom').value = 'fit'; $d('deviceFrameToggle').checked = true;
    modal.hidden = false; document.body.classList.add('device-preview-open');
    renderDevice();
  }
  function currentFrame() {
    resolveAll();
    return RMAP.get(state.frameId) || RES.find(f => f.type === 'frame' && !f.parent && f.page === S.page) || null;
  }
  function renderDevice() {
    if (!state.open) return;
    const frame = currentFrame();
    if (!frame) { $d('deviceScreenContent').replaceChildren(); return; }
    const content = $d('deviceScreenContent'); content.replaceChildren();
    const registry = new Map();
    const node = buildNode(frame, registry);
    node.style.left = '0px'; node.style.top = '0px';
    node.style.transformOrigin = '0 0';
    const workspace = $d('deviceWorkspace');
    const availableW = Math.max(220, workspace.clientWidth - 90);
    const availableH = Math.max(260, workspace.clientHeight - 70);
    const fitScale = Math.min(availableW / (state.w + 30), availableH / (state.h + 30), 1);
    const zoomScale = state.zoom === 'fit' ? fitScale : Number(state.zoom);
    const scale = Math.max(.15, Math.min(2, zoomScale));
    const contentScale = scale * (state.w / Math.max(1, frame.w));
    node.style.transform = `scale(${contentScale})`;
    node.style.transformOrigin = 'top left';
    content.style.width = `${Math.max(state.w * scale, frame.w * contentScale)}px`;
    content.style.height = `${Math.max(state.h * scale, frame.h * contentScale)}px`;
    content.style.setProperty('--device-content-scale', contentScale);
    content.appendChild(node);
    const shell = $d('deviceShell');
    shell.style.width = `${state.w * scale + (state.frame ? 24 : 0)}px`;
    shell.style.height = `${state.h * scale + (state.frame ? 24 : 0)}px`;
    shell.style.padding = state.frame ? '10px' : '0';
    shell.classList.toggle('no-frame', !state.frame);
    shell.classList.toggle('tablet', state.w >= 700);
    shell.style.setProperty('--device-radius', `${Math.max(8, Math.min(42, (state.w >= 700 ? 24 : 38) * scale))}px`);
    $d('deviceScreen').style.width = `${state.w * scale}px`;
    $d('deviceScreen').style.height = `${state.h * scale}px`;
    $d('deviceScreen').style.borderRadius = `${Math.max(4, (state.w >= 700 ? 14 : 30) * scale)}px`;
    $d('deviceDimensions').textContent = `${state.w} × ${state.h}`;
    $d('deviceAddress').value = `frameforge://preview/${(frame.name || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    $d('deviceBack').disabled = state.historyIndex <= 0;
    $d('deviceForward').disabled = state.historyIndex >= state.history.length - 1;
  }
  function closeDevicePreview() {
    state.open = false; modal.hidden = true; document.body.classList.remove('device-preview-open');
    $d('deviceScreenContent').replaceChildren();
  }
  function changeFrame(id, addHistory = true) {
    resolveAll();
    const frame = RMAP.get(id);
    if (!frame || frame.type !== 'frame') return;
    state.frameId = id;
    if (addHistory) { state.history = state.history.slice(0, state.historyIndex + 1); state.history.push(id); state.historyIndex++; }
    renderDevice();
  }
  function applyPreset(key) {
    const p = presets[key] || presets.custom;
    state.w = p.w; state.h = p.h;
    $d('deviceWidth').value = state.w; $d('deviceHeight').value = state.h;
    renderDevice();
  }
  function validDimensions() {
    const w = Math.max(240, Math.min(2400, Number($d('deviceWidth').value) || 393));
    const h = Math.max(320, Math.min(3000, Number($d('deviceHeight').value) || 852));
    state.w = Math.round(w); state.h = Math.round(h);
    $d('deviceWidth').value = state.w; $d('deviceHeight').value = state.h;
    $d('devicePreset').value = 'custom'; renderDevice();
  }
  function rotate() {
    [state.w, state.h] = [state.h, state.w];
    $d('deviceWidth').value = state.w; $d('deviceHeight').value = state.h;
    $d('devicePreset').value = 'custom'; renderDevice();
  }
  window.startDevicePreview = openDevicePreview;
  $d('deviceClose').addEventListener('click', closeDevicePreview);
  $d('deviceRefresh').addEventListener('click', renderDevice);
  $d('devicePreset').addEventListener('change', ev => applyPreset(ev.target.value));
  $d('deviceWidth').addEventListener('change', validDimensions);
  $d('deviceHeight').addEventListener('change', validDimensions);
  $d('deviceRotate').addEventListener('click', rotate);
  $d('deviceZoom').addEventListener('change', ev => { state.zoom = ev.target.value; renderDevice(); });
  $d('deviceFrameToggle').addEventListener('change', ev => { state.frame = ev.target.checked; renderDevice(); });
  $d('deviceBack').addEventListener('click', () => { if (state.historyIndex > 0) changeFrame(state.history[--state.historyIndex], false); });
  $d('deviceForward').addEventListener('click', () => { if (state.historyIndex < state.history.length - 1) changeFrame(state.history[++state.historyIndex], false); });
  $d('deviceScreenContent').addEventListener('click', ev => {
    let n = ev.target.closest('.el');
    while (n) {
      const e = RMAP.get(n.dataset.id);
      if (e && e.link && e.link.kind === 'frame' && RMAP.has(e.link.value)) { changeFrame(e.link.value); return; }
      if (e && e.link && e.link.kind === 'url' && /^https?:\/\//i.test(e.link.value || '')) { window.open(e.link.value, '_blank', 'noopener'); return; }
      n = n.parentElement && n.parentElement.closest('.el');
    }
  });
  window.addEventListener('resize', () => { if (state.open) renderDevice(); });
  window.addEventListener('keydown', ev => {
    if (!state.open) return;
    if (ev.key === 'Escape') { ev.stopPropagation(); closeDevicePreview(); }
    if ((ev.altKey && ev.key === 'ArrowLeft') || (ev.key === 'Backspace' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName))) { ev.preventDefault(); $d('deviceBack').click(); }
    if (ev.altKey && ev.key === 'ArrowRight') { ev.preventDefault(); $d('deviceForward').click(); }
  }, true);
  // Rebuild after edits made in the editor while the preview is open.
  const originalRender = window.render;
  if (typeof originalRender === 'function') window.render = function(...args) { const result = originalRender.apply(this, args); if (state.open) renderDevice(); return result; };
})();
