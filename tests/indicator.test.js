import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
async function harness() {
  const elements = [], calls = [], windowListeners = {};
  function element(tag) {
    const e = { tag, style: {}, handlers: {}, children: [], isConnected: false,
      append(...children) { this.children.push(...children); children.forEach(c => {c.isConnected = true;}); },
      attachShadow() { this.root = element('shadow'); return this.root; },
      setAttribute() {}, setPointerCapture() {}, addEventListener(name, fn) {this.handlers[name] = fn;},
      getBoundingClientRect() {return {left:parseFloat(this.style.left ?? 700), top:parseFloat(this.style.top ?? 600), width:250, height:80};},
      remove() {this.isConnected = false;} };
    elements.push(e); return e;
  }
  const context = vm.createContext({ document: {createElement: element, documentElement: element('html')},
    window: {addEventListener(name, fn) {windowListeners[name] = fn;}}, innerWidth:1000, innerHeight:800,
    setInterval: () => 1, clearInterval() {},
    chrome: {runtime: {id:'test', onMessage: {addListener() {}}, async sendMessage(m) {
      calls.push(m); return m.type === 'STATUS' ? {ok:true, session:{id:'session', startedMs:Date.now()}} : {ok:true};
    }}} });
  vm.runInContext(await readFile(new URL('../extension/recording-indicator.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setImmediate(resolve));
  return {button:elements.find(e=>e.tag==='button'), host:elements.find(e=>e.root), calls, context, windowListeners};
}
test('dragging moves the indicator, clamps it on screen, and does not stop recording on release', async () => {
  const h = await harness(), b = h.button;
  b.handlers.pointerdown({button:0, pointerId:1, clientX:720, clientY:620});
  b.handlers.pointermove({pointerId:1, clientX:420, clientY:320});
  assert.equal(h.host.style.left, '400px'); assert.equal(h.host.style.top, '300px');
  b.handlers.pointermove({pointerId:1, clientX:-100, clientY:-100});
  assert.equal(h.host.style.left, '12px'); assert.equal(h.host.style.top, '12px');
  b.handlers.pointerup({pointerId:1}); await b.onclick({detail:1});
  assert.ok(!h.calls.some(m=>m.type==='STOP'));
  b.handlers.pointerdown({button:0, pointerId:2, clientX:30, clientY:30});
  b.handlers.pointerup({pointerId:2}); await b.onclick({detail:1});
  assert.equal(h.calls.filter(m=>m.type==='STOP').length, 1); assert.equal(h.host.isConnected, false);
});
test('keyboard movement and resize keep the indicator visible while keyboard activation stops', async () => {
  const h = await harness();
  h.button.handlers.keydown({key:'ArrowLeft', preventDefault() {}, shiftKey:true});
  assert.equal(h.host.style.left, '670px');
  h.context.innerWidth = 500; h.context.innerHeight = 400; h.windowListeners.resize();
  assert.equal(h.host.style.left, '238px'); assert.equal(h.host.style.top, '308px');
  await h.button.onclick({detail:0}); assert.ok(h.calls.some(m=>m.type==='STOP'));
});
