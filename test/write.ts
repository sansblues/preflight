// Test helpers that write what BXT and the engine write, so tests can build demos from scratch.

import type { BxtData } from '../src/bxt.ts';
import type { MoveVars } from '../src/demo.ts';

const Key = [0x1337face, 0x12345678, 0xdeadbeef, 0xfeedabcd];
const Types = ['version', 'cvars', 'time', 'bind', 'alias', 'script', 'command', 'gameEnd', 'modules', 'trigger', 'edicts', 'health', 'split', 'flags'];
const Escape: Record<number, number> = { 0x00: 0x01, 0x22: 0x02, 0x0a: 0x03, 0x3b: 0x04, 0xff: 0xff };

class Bytes {
  out: number[] = [];
  private v = new DataView(new ArrayBuffer(8));
  private put(n: number) { this.out.push(...new Uint8Array(this.v.buffer, 0, n)); }
  u8(x: number) { this.out.push(x & 0xff); }
  i32(x: number) { this.v.setInt32(0, x, true); this.put(4); }
  u32(x: number) { this.v.setUint32(0, x, true); this.put(4); }
  f32(x: number) { this.v.setFloat32(0, x, true); this.put(4); }
  f64(x: number) { this.v.setFloat64(0, x, true); this.put(8); }
  str(s: string) { const b = new TextEncoder().encode(s); this.u32(b.length); this.out.push(...b); }
  fixed(s: string, n: number) { for (let i = 0; i < n; i++) this.u8(i < s.length ? s.charCodeAt(i) : 0); }
  raw(b: ArrayLike<number>) { this.out.push(...Array.from(b)); }
}

/** One cereal archive of BXT objects, as RuntimeData::SaveStored serializes it. */
export function archive(objects: BxtData[]): number[] {
  const w = new Bytes();
  w.u32(objects.length);
  for (const o of objects) {
    w.u8(Types.indexOf(o.type) + 1);
    switch (o.type) {
      case 'version': w.i32(o.build); w.str(o.version); break;
      case 'cvars': w.u32(o.values.size); for (const [k, v] of o.values) { w.str(k); w.str(v); } break;
      case 'time': w.u32(o.hours); w.u8(o.minutes); w.u8(o.seconds); w.f64(o.remainder); break;
      case 'bind': case 'command': w.str(o.command); break;
      case 'alias': w.str(o.name); w.str(o.command); break;
      case 'script': w.str(o.filename); w.str(o.contents); break;
      case 'gameEnd': break;
      case 'modules': w.u32(o.filenames.length); o.filenames.forEach(f => w.str(f)); break;
      case 'trigger': [...o.min, ...o.max].forEach(x => w.f32(x)); w.str(o.command); break;
      case 'edicts': w.i32(o.edicts); break;
      case 'health': w.i32(o.health); break;
      case 'split': [...o.min, ...o.max].forEach(x => w.f32(x)); w.str(o.name); w.str(o.map); break;
      case 'flags': w.i32(o.flags); break;
    }
  }
  return w.out;
}

export function teaEncrypt(block: Uint8Array) {
  const v = new DataView(block.buffer, block.byteOffset, 8);
  let v0 = v.getUint32(0, true), v1 = v.getUint32(4, true), sum = 0;
  for (let i = 0; i < 32; i++) {
    sum = (sum + 0x9e3779b9) >>> 0;
    v0 = (v0 + ((((v1 << 4) + Key[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + Key[1])) >>> 0)) >>> 0;
    v1 = (v1 + ((((v0 << 4) + Key[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + Key[3])) >>> 0)) >>> 0;
  }
  v.setUint32(0, v0, true);
  v.setUint32(4, v1, true);
}

/** Encrypts and escapes archives, then splits them into 64-byte "//BXTD0" console commands. */
export function bxtCommands(...archives: number[][]): Uint8Array[] {
  const escaped: number[] = [];
  for (const a of archives) {
    const padded = Uint8Array.from([...a, ...Array((8 - (a.length % 8)) % 8).fill(0xfe)]);
    for (let i = 0; i < padded.length; i += 8) teaEncrypt(padded.subarray(i, i + 8));
    for (const b of padded) escaped.push(...(b in Escape ? [0xff, Escape[b]] : [b]));
  }
  const commands: Uint8Array[] = [];
  for (let i = 0; i < escaped.length; i += 56) {
    const c = new Uint8Array(64);
    c.set(new TextEncoder().encode('//BXTD0'));
    c.set(escaped.slice(i, i + 56), 7);
    commands.push(c);
  }
  return commands;
}

export const DefaultVars: MoveVars = {
  gravity: 800, stopspeed: 100, maxspeed: 320, spectatormaxspeed: 500, accelerate: 10, airaccelerate: 10,
  wateraccelerate: 10, friction: 4, edgefriction: 2, waterfriction: 1, entgravity: 1, bounce: 1, stepsize: 18, maxvelocity: 2000,
};

export type Frame =
  | { type: 'net'; time: number; frame: number; frametime?: number; msec?: number; vars?: Partial<MoveVars> }
  | { type: 'console'; time: number; frame: number; command: Uint8Array | string }
  | { type: 'other'; time: number; frame: number; kind: 2 | 4 | 6 | 7 | 8 | 9 };

/** A demo the way the engine records one: header, LOADING and Playback entries, directory. */
export function demo(loading: Frame[], playback: Frame[], map = 'c1a0', gameDir = 'valve'): Uint8Array {
  const w = new Bytes();
  w.fixed('HLDEMO', 8); w.i32(5); w.i32(47); w.fixed(map, 260); w.fixed(gameDir, 260); w.u32(0); w.i32(0);

  const entries: { offset: number; length: number; time: number; frames: number }[] = [];
  for (const frames of [loading, playback]) {
    const offset = w.out.length;
    let time = 0, nets = 0;
    for (const f of frames) {
      w.u8(f.type === 'net' ? 1 : f.type === 'console' ? 3 : f.kind); w.f32(f.time); w.i32(f.frame);
      time = f.time;
      if (f.type === 'net') {
        nets++;
        const body = new Bytes();
        body.raw(Array(64).fill(0)); body.f32(f.frametime ?? 0.01);
        body.raw(Array(238 - 68).fill(0)); body.u8(f.msec ?? 10);
        body.raw(Array(288 - 239).fill(0));
        const vars = { ...DefaultVars, ...f.vars };
        for (const k of Object.keys(DefaultVars) as (keyof MoveVars)[]) body.f32(vars[k]);
        body.raw(Array(464 - 344).fill(0)); body.i32(3); body.raw([1, 2, 3]);
        w.raw(body.out);
      } else if (f.type === 'console') {
        const c = f.command;
        w.raw(typeof c === 'string' ? Uint8Array.from({ length: 64 }, (_, i) => c.charCodeAt(i) || 0) : c);
      } else {
        const sizes = { 2: [], 4: Array(32).fill(0), 6: Array(84).fill(0), 7: Array(8).fill(0) } as Record<number, number[]>;
        if (f.kind === 8) { w.i32(0); w.i32(2); w.raw([7, 7]); w.raw(Array(16).fill(0)); }
        else if (f.kind === 9) { w.i32(3); w.raw([9, 9, 9]); }
        else w.raw(sizes[f.kind]);
      }
    }
    w.u8(5); w.f32(time + 0.25); w.i32(0); // Next section: its time doesn't count
    entries.push({ offset, length: w.out.length - offset, time: entries.length ? time : 0, frames: entries.length ? nets : 0 });
  }

  const dir = w.out.length;
  w.i32(entries.length);
  entries.forEach((e, i) => {
    w.i32(i); w.fixed(i ? 'Playback' : 'LOADING', 64); w.i32(0); w.i32(-1); w.f32(e.time); w.i32(e.frames); w.i32(e.offset); w.i32(e.length);
  });
  const file = Uint8Array.from(w.out);
  new DataView(file.buffer).setInt32(540, dir, true);
  return file;
}
