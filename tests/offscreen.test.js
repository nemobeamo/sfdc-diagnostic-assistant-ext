import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
test('tab recorder uses a consistent constraint format and releases video tracks on stop', async () => {
  const source = (await readFile(new URL('../extension/offscreen.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  let listener, stopped = false;
  const track = { stop() { stopped = true; } };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] };
  class Recorder {
    state = 'inactive';
    start() { this.state = 'recording'; }
    addEventListener(_, fn) { this.onStop = fn; }
    stop() { this.state = 'inactive'; this.onStop(); }
  }
  vm.runInNewContext(source, {
    navigator: { mediaDevices: { async getUserMedia(constraints) {
      assert.equal(constraints.audio, false);
      assert.equal(constraints.video.mandatory.chromeMediaSourceId, 'test-stream');
      assert.equal(constraints.video.mandatory.maxFrameRate, 15);
      assert.deepEqual(Object.keys(constraints.video), ['mandatory']);
      return stream;
    } } }, MediaRecorder: Recorder, saveChunk: async () => {},
    chrome: { runtime: { id: 'test', onMessage: { addListener(fn) { listener = fn; } } } }
  });
  const send = message => new Promise(resolve => listener({target: 'recorder', ...message}, {id:'test'}, resolve));
  assert.equal((await send({type:'START', sessionId:'test-session', streamId:'test-stream'})).ok, true);
  assert.equal((await send({type:'STOP'})).ok, true);
  assert.equal(stopped, true);
});
