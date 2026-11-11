// Decoder for the runtime data BunnymodXT writes into demos.
//
// BXT serializes a list of objects with cereal, encrypts it with TEA in 8-byte blocks
// (padding the last block with 0xFE), escapes bytes a console command can't hold, and
// splits the result into "//BXTD0..." console command frames. Decoding reverses that.
// Source: BunnymodXT/runtime_data.cpp.

export type Vec3 = [number, number, number];

export type Time = { hours: number; minutes: number; seconds: number; remainder: number };

export type BxtData =
  | { type: 'version'; build: number; version: string }
  | { type: 'cvars'; values: Map<string, string> }
  | ({ type: 'time' } & Time)
  | { type: 'bind'; command: string }
  | { type: 'alias'; name: string; command: string }
  | { type: 'script'; filename: string; contents: string }
  | { type: 'command'; command: string }
  | { type: 'gameEnd' }
  | { type: 'modules'; filenames: string[] }
  | { type: 'trigger'; min: Vec3; max: Vec3; command: string }
  | { type: 'edicts'; edicts: number }
  | { type: 'health'; health: number }
  | { type: 'split'; min: Vec3; max: Vec3; name: string; map: string }
  | { type: 'flags'; flags: number };

export const seconds = (t: Time) => t.hours * 3600 + t.minutes * 60 + t.seconds + t.remainder;

const Key = [0x1337face, 0x12345678, 0xdeadbeef, 0xfeedabcd];
const Delta = 0x9e3779b9;
const Unescape: Record<number, number> = { 0x01: 0x00, 0x02: 0x22, 0x03: 0x0a, 0x04: 0x3b, 0xff: 0xff };
const utf8 = new TextDecoder();

/** Decodes the payload of one frame's BXT console commands (with the "//BXTD0" headers removed). */
export function decodeBxt(payload: Uint8Array): { data: BxtData[]; error?: string } {
  const data: BxtData[] = [];
  try {
    const bytes = decrypt(unescape(payload));
    const r = new Reader(bytes);
    // One archive per frame in practice. If there are more, they follow each other on block boundaries.
    while (r.pos < bytes.length) {
      for (let n = r.u32(); n > 0; n--) data.push(readObject(r));
      r.pos = Math.ceil(r.pos / 8) * 8;
    }
    return { data };
  } catch (e) {
    return { data, error: (e as Error).message };
  }
}

function unescape(input: Uint8Array): Uint8Array {
  const out = new Uint8Array(input.length);
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    let b = input[i];
    if (b === 0xff) {
      const original = Unescape[input[++i]];
      if (original === undefined) throw new Error('invalid escape sequence');
      b = original;
    }
    out[n++] = b;
  }
  return out.subarray(0, n);
}

function decrypt(bytes: Uint8Array): Uint8Array {
  if (bytes.length % 8 !== 0) throw new Error(`length ${bytes.length} is not a multiple of 8`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  for (let i = 0; i < bytes.length; i += 8) {
    let v0 = view.getUint32(i, true);
    let v1 = view.getUint32(i + 4, true);
    let sum = 0xc6ef3720;
    for (let round = 0; round < 32; round++) {
      v1 = (v1 - ((((v0 << 4) + Key[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + Key[3])) >>> 0)) >>> 0;
      v0 = (v0 - ((((v1 << 4) + Key[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + Key[1])) >>> 0)) >>> 0;
      sum = (sum - Delta) >>> 0;
    }
    view.setUint32(i, v0, true);
    view.setUint32(i + 4, v1, true);
  }
  return bytes;
}

// Type numbers from BXT's RuntimeDataType enum.
function readObject(r: Reader): BxtData {
  const type = r.u8();
  switch (type) {
    case 1: return { type: 'version', build: r.i32(), version: r.str() };
    case 2: {
      const values = new Map<string, string>();
      for (let n = r.u32(); n > 0; n--) values.set(r.str(), r.str());
      return { type: 'cvars', values };
    }
    case 3: return { type: 'time', hours: r.u32(), minutes: r.u8(), seconds: r.u8(), remainder: r.f64() };
    case 4: return { type: 'bind', command: r.str() };
    case 5: return { type: 'alias', name: r.str(), command: r.str() };
    case 6: return { type: 'script', filename: r.str(), contents: r.str() };
    case 7: return { type: 'command', command: r.str() };
    case 8: return { type: 'gameEnd' };
    case 9: {
      const filenames: string[] = [];
      for (let n = r.u32(); n > 0; n--) filenames.push(r.str());
      return { type: 'modules', filenames };
    }
    case 10: return { type: 'trigger', min: r.vec3(), max: r.vec3(), command: r.str() };
    case 11: return { type: 'edicts', edicts: r.i32() };
    case 12: return { type: 'health', health: r.i32() };
    case 13: return { type: 'split', min: r.vec3(), max: r.vec3(), name: r.str(), map: r.str() };
    case 14: return { type: 'flags', flags: r.i32() };
    default: throw new Error(`unknown data type ${type}`);
  }
}

class Reader {
  pos = 0;
  private view: DataView;
  private bytes: Uint8Array;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  }

  private take(n: number): number {
    if (this.pos + n > this.bytes.length) throw new Error('data ends unexpectedly');
    const at = this.pos;
    this.pos += n;
    return at;
  }

  u8() { return this.view.getUint8(this.take(1)); }
  u32() { return this.view.getUint32(this.take(4), true); }
  i32() { return this.view.getInt32(this.take(4), true); }
  f32() { return this.view.getFloat32(this.take(4), true); }
  f64() { return this.view.getFloat64(this.take(8), true); }
  vec3(): Vec3 { return [this.f32(), this.f32(), this.f32()]; }
  str() {
    const n = this.u32();
    const at = this.take(n);
    return utf8.decode(this.bytes.subarray(at, at + n));
  }
}
