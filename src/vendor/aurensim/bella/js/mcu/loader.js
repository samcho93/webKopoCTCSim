// loader.js — 펌웨어 이미지 파서: ELF32(ARM) / Intel HEX / raw BIN → 플래시 세그먼트 + 심볼
'use strict';

/** @returns {{format, segments:[{addr,data}], symbols: Map<name,{addr,size,type}>, entry}} */
export function parseFirmware(buf, name = '') {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8[0] === 0x7F && u8[1] === 0x45 && u8[2] === 0x4C && u8[3] === 0x46) return parseElf(u8);
  const head = new TextDecoder().decode(u8.subarray(0, 64)).trimStart();
  if (head.startsWith(':') || /\.hex$/i.test(name)) return parseHex(new TextDecoder().decode(u8));
  return { format: 'BIN', segments: [{ addr: 0x08000000, data: u8.slice() }], symbols: new Map(), entry: null };
}

function parseElf(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8[4] !== 1 || u8[5] !== 1) throw new Error('ELF32 little-endian 만 지원');
  if (dv.getUint16(18, true) !== 40) throw new Error('ARM ELF 가 아님');
  const entry = dv.getUint32(24, true);
  const phoff = dv.getUint32(28, true), shoff = dv.getUint32(32, true);
  const phentsize = dv.getUint16(42, true), phnum = dv.getUint16(44, true);
  const shentsize = dv.getUint16(46, true), shnum = dv.getUint16(48, true);
  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    if (dv.getUint32(o, true) !== 1) continue;              // PT_LOAD
    const off = dv.getUint32(o + 4, true), paddr = dv.getUint32(o + 12, true), filesz = dv.getUint32(o + 16, true);
    if (!filesz) continue;
    segments.push({ addr: paddr, data: u8.slice(off, off + filesz) });   // LMA(플래시에 실리는 주소)
  }
  // 심볼 테이블
  const symbols = new Map();
  const sh = (i) => { const o = shoff + i * shentsize; return { type: dv.getUint32(o + 4, true), offset: dv.getUint32(o + 16, true), size: dv.getUint32(o + 20, true), link: dv.getUint32(o + 24, true), entsize: dv.getUint32(o + 36, true) }; };
  for (let i = 0; i < shnum; i++) {
    const s = sh(i);
    if (s.type !== 2) continue;                               // SHT_SYMTAB
    const str = sh(s.link);
    const td = new TextDecoder();
    for (let o = s.offset; o < s.offset + s.size; o += 16) {
      const nameOff = dv.getUint32(o, true), value = dv.getUint32(o + 4, true), size = dv.getUint32(o + 8, true), info = u8[o + 12];
      const type = info & 15;
      if (type !== 1 && type !== 2) continue;                  // OBJECT / FUNC
      let e = str.offset + nameOff; while (u8[e]) e++;
      const nm = td.decode(u8.subarray(str.offset + nameOff, e));
      if (!nm) continue;
      if (!symbols.has(nm)) symbols.set(nm, { addr: value, size, type: type === 2 ? 'func' : 'obj' });
    }
  }
  return { format: 'ELF', segments, symbols, entry };
}

function parseHex(text) {
  const segs = new Map(); let base = 0, entry = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const b = line.slice(1).match(/../g).map(h => parseInt(h, 16));
    const n = b[0], addr = (b[1] << 8) | b[2], type = b[3], data = b.slice(4, 4 + n);
    if (type === 0) {
      const a = base + addr;
      const blk = a & ~0xFFFF;
      if (!segs.has(blk)) segs.set(blk, new Uint8Array(0x10000).fill(0xFF));
      const m = segs.get(blk);
      for (let i = 0; i < n; i++) {
        const aa = a + i, bb = aa & ~0xFFFF;
        if (!segs.has(bb)) segs.set(bb, new Uint8Array(0x10000).fill(0xFF));
        (bb === blk ? m : segs.get(bb))[aa & 0xFFFF] = data[i];
      }
    } else if (type === 2) base = ((data[0] << 8) | data[1]) << 4;
    else if (type === 4) base = (((data[0] << 8) | data[1]) << 16) >>> 0;
    else if (type === 5) entry = ((data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3]) >>> 0;
    else if (type === 1) break;
  }
  return { format: 'HEX', segments: [...segs].map(([addr, data]) => ({ addr, data })), symbols: new Map(), entry };
}
