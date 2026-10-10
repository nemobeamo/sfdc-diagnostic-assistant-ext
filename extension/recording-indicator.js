(() => {
  const key = '__salesforceDiagnosticRecordingIndicator';
  if (globalThis[key]) { globalThis[key].refresh(); return; }
  let host, button, timer, session, position;
  function hide() {
    clearInterval(timer); host?.remove(); host = button = session = null;
  }
  function show(value) {
    if (session?.id === value.id && session.apexStatus === value.apexStatus && host?.isConnected) return;
    hide(); session = value;
    host = document.createElement('div');
    host.style.cssText = 'all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647;display:block;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      button { display:flex; align-items:center; gap:12px; cursor:pointer; border:3px solid white;
        border-radius:16px; padding:16px 22px; background:#b42318; color:white; font:700 16px/1.4 system-ui,sans-serif;
        touch-action:none; user-select:none; cursor:grab; max-width:calc(100vw - 32px); box-sizing:border-box;
        box-shadow:0 0 0 3px #b42318,0 8px 28px #0007; text-align:left; }
      button:active { cursor:grabbing; } button:hover { background:#87180f; } button:focus-visible { outline:4px solid #ffdf00; outline-offset:6px; }
      button:disabled { cursor:wait; } .dot { width:14px; height:14px; border-radius:50%; background:white; animation:pulse 1.2s infinite; }
      small { display:block; font:500 13px/1.4 system-ui,sans-serif; } @keyframes pulse { 50% { opacity:.35; } }
      @media (prefers-reduced-motion:reduce) { .dot { animation:none; } }
    `;
    button = document.createElement('button'); button.type = 'button';
    button.setAttribute('aria-label', 'Stop Salesforce recording and review evidence');
    button.title = 'Drag to move. Click to stop. Arrow keys move the focused indicator.';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'), title = document.createElement('span'), hint = document.createElement('small');
    hint.textContent = (value.videoOnly ? 'Video only · ' : '') + (['preparing','not-started'].includes(value.apexStatus) ? 'Preparing Apex · ' : value.apexStatus === 'unavailable' ? 'Apex unavailable · ' : '') + 'Drag to move · Click to stop';
    label.append(title, hint); button.append(dot, label); root.append(style, button);
    const update = () => {
      const seconds = Math.max(0, Math.floor((Date.now() - value.startedMs) / 1000));
      title.textContent = 'RECORDING ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
    };
    update(); timer = setInterval(update, 1000);
    let gesture, dragged = false;
    button.addEventListener('pointerdown', e => {
      if (e.button !== 0 || button.disabled) return;
      dragged = false;
      const rect = host.getBoundingClientRect();
      gesture = { id: e.pointerId, x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      button.setPointerCapture(e.pointerId);
    });
    button.addEventListener('pointermove', e => {
      if (!gesture || gesture.id !== e.pointerId) return;
      const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y;
      if (!dragged && Math.hypot(dx, dy) < 6) return;
      dragged = true; move(gesture.left + dx, gesture.top + dy);
    });
    const finishDrag = e => {
      if (!gesture || gesture.id !== e.pointerId) return;
      if (e.type === 'pointercancel') dragged = true;
      gesture = null;
    };
    button.addEventListener('pointerup', finishDrag);
    button.addEventListener('pointercancel', finishDrag);
    button.addEventListener('keydown', e => {
      const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      if (!directions[e.key]) return;
      e.preventDefault();
      const rect = host.getBoundingClientRect(), step = e.shiftKey ? 30 : 10;
      move(rect.left + directions[e.key][0] * step, rect.top + directions[e.key][1] * step);
    });
    button.onclick = async e => {
      // A pointer drag generates a click on release; only a separate click stops.
      if (e.detail !== 0 && dragged) { dragged = false; return; }
      const active = session; button.disabled = true; clearInterval(timer); title.textContent = 'STOPPING…';
      try {
        const reply = await chrome.runtime.sendMessage({ target: 'recording-indicator', type: 'STOP', id: active.id });
        if (!reply?.ok) throw new Error(reply?.error || 'Could not stop recording');
        hide();
      } catch {
        if (!button) return;
        button.disabled = false; hint.textContent = 'Could not stop · Try again or use the extension';
      }
    };
    document.documentElement.append(host);
    if (position) move(position.x, position.y);
  }
  function move(x, y) {
    if (!host) return;
    const rect = host.getBoundingClientRect(), margin = 12;
    position = {
      x: Math.max(margin, Math.min(x, innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, innerHeight - rect.height - margin))
    };
    Object.assign(host.style, { left: position.x + 'px', top: position.y + 'px', right: 'auto', bottom: 'auto' });
  }
  window.addEventListener('resize', () => { if (position) move(position.x, position.y); });
  async function refresh() {
    try {
      const reply = await chrome.runtime.sendMessage({ target: 'recording-indicator', type: 'STATUS' });
      if (reply?.ok && reply.session) show(reply.session); else hide();
    } catch { hide(); }
  }
  globalThis[key] = { refresh };
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message.target !== 'recording-indicator') return;
    if (message.type === 'HIDE') hide();
    else if (message.type === 'SHOW') show(message.session);
    else return;
    respond({ok:true});
  });
  refresh();
})();
