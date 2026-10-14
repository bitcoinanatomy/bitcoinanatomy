/** Minimal 16-bit PCM WAV encode/decode (works in Node and the browser). */

export function encodeWav(channels: Float32Array[], sampleRate: number): Uint8Array {
  const n = channels[0].length;
  const ch = channels.length;
  const dataLen = n * ch * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataLen, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * ch * 2, true);
  v.setUint16(32, ch * 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, dataLen, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}

/** Duration in seconds of a PCM WAV file (reads the header chunks). */
export function wavDuration(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 12;
  let byteRate = 0;
  while (o + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
    let size = v.getUint32(o + 4, true);
    if (id === 'fmt ') byteRate = v.getUint32(o + 16, true);
    if (id === 'data') {
      if (size === 0 || size === 0xffffffff || o + 8 + size > bytes.length) size = bytes.length - o - 8;
      return byteRate ? size / byteRate : 0;
    }
    o += 8 + size + (size % 2);
  }
  return 0;
}
