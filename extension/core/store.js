let opening;
function database() {
  return opening ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('diagnostic-assistant', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('sessions', { keyPath: 'id' });
      req.result.createObjectStore('chunks', { keyPath: ['sessionId', 'index'] });
    };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
}
async function operation(name, mode, run) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode); const req = run(tx.objectStore(name));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Evidence storage failed'));
  });
}
export const saveSession = s => operation('sessions', 'readwrite', store => store.put(s));
export const getSession = id => operation('sessions', 'readonly', store => store.get(id));
export const saveChunk = (sessionId, index, blob) => operation('chunks', 'readwrite', store => store.put({ sessionId, index, blob }));
export const getChunks = id => operation('chunks', 'readonly', store => store.getAll(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
export async function deleteSession(id) {
  await operation('chunks', 'readwrite', store => store.delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER])));
  await operation('sessions', 'readwrite', store => store.delete(id));
}
