'use strict';
/* Minimaler ZIP-Schreiber (ohne Komprimierung, "stored"), keine Bibliothek nötig.
   Zip.build([{ name: 'ordner/datei.txt', data: Blob | Uint8Array, date: Date }, { name: 'leer/', data: null }]) → Blob
   Namen mit "/" am Ende sind Ordner. Für Dateien unter 4 GB (kein ZIP64). */
window.Zip = (() => {
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = -1;
    for (let i = 0; i < bytes.length; i++) c = (c >>> 8) ^ TABLE[(c ^ bytes[i]) & 0xff];
    return (c ^ -1) >>> 0;
  }

  function dosTime(d) {
    const date = d instanceof Date && !Number.isNaN(+d) ? d : new Date();
    const y = Math.min(Math.max(date.getFullYear(), 1980), 2107);
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  async function build(entries) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const e of entries) {
      const name = enc.encode(e.name);
      const isDir = e.name.endsWith('/');
      let data = new Uint8Array(0);
      if (!isDir && e.data) data = e.data instanceof Uint8Array ? e.data : new Uint8Array(await e.data.arrayBuffer());
      const crc = isDir ? 0 : crc32(data);
      const { time, date } = dosTime(e.date);

      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, data);

      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint16(30, 0, true); ch.setUint16(32, 0, true); ch.setUint16(34, 0, true); ch.setUint16(36, 0, true);
      ch.setUint32(38, isDir ? 0x10 : 0, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);

      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  return { build, crc32 };
})();
