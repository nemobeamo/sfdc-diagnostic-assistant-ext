import { saveChunk } from './core/store.js';
let media, stream, pending = Promise.resolve(), index = 0, bytes = 0, failure, stopping, sessionId;
const MAX_BYTES = 100 * 1024 * 1024;
async function start(message) {
  if (media && media.state !== 'inactive') throw new Error('Recorder already active');
  index = 0; bytes = 0; failure = null; pending = Promise.resolve(); sessionId = message.sessionId; stopping = null;
  stream = await navigator.mediaDevices.getUserMedia({ audio: false,
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: message.streamId, maxFrameRate: 15 } } });
  try {
    media = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 1500000 });
    media.ondataavailable = e => {
      if (!e.data.size) return;
      bytes += e.data.size;
      if (bytes > MAX_BYTES) { signalStop('100 MB recording limit reached.'); return; }
      const chunkIndex = index++;
      pending = pending.then(() => saveChunk(sessionId, chunkIndex, e.data)).catch(error => {
        failure = error; signalStop('Recording storage failed.');
      });
    };
    media.onerror = e => { failure = e.error || new Error('MediaRecorder failed'); signalStop('Recorder failed.'); };
    stream.getVideoTracks()[0].onended = () => { if (!stopping) signalStop('Captured tab closed or recording ended.'); };
    media.start(1000); return { startedMs: Date.now() };
  } catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
}
function signalStop(reason) {
  chrome.runtime.sendMessage({ target: 'controller', type: 'STOP', reason }).catch(() => {});
}
function stop() {
  if (stopping) return stopping;
  stopping = (async () => {
    if (media && media.state !== 'inactive') await new Promise(resolve => {
      media.addEventListener('stop', resolve, { once: true }); media.stop();
    });
    stream?.getTracks().forEach(t => t.stop()); await pending;
    if (failure) throw failure;
  })();
  return stopping;
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'recorder' || sender.id !== chrome.runtime.id || sender.tab) return;
  const task = message.type === 'START' ? start(message) : message.type === 'STOP' ? stop() : Promise.reject(new Error('Unknown recorder command'));
  task.then(result => respond({ ok: true, ...result }), error => respond({ ok: false, error: error.message })); return true;
});
