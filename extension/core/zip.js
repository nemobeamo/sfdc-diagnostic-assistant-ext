// ZIP STORE: no compression, no runtime dependency or remote code. Limited to <4 GiB.
const encoder = new TextEncoder();
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function header(size) { const bytes = new Uint8Array(size); return [bytes, new DataView(bytes.buffer)]; }
export function makeZip(files) {
  const local = [], directory = []; let offset = 0, dirSize = 0;
  for (const [filename, content] of Object.entries(files)) {
    const name = encoder.encode(filename);
    if (!/^[\w./-]+$/.test(filename) || filename.includes('..')) throw new Error('Unsafe ZIP filename');
    const data = typeof content === 'string' ? encoder.encode(content) : content;
    const crc = crc32(data); const [l, lv] = header(30 + name.length);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); l.set(name, 30); local.push(l, data);
    const [c, cv] = header(46 + name.length);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); c.set(name, 46);
    directory.push(c); offset += l.length + data.length; dirSize += c.length;
  }
  if (offset + dirSize > 0xffffffff || directory.length > 65535) throw new Error('ZIP limit exceeded');
  const [end, ev] = header(22); ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, directory.length, true); ev.setUint16(10, directory.length, true);
  ev.setUint32(12, dirSize, true); ev.setUint32(16, offset, true);
  return new Blob([...local, ...directory, end], { type: 'application/zip' });
}
