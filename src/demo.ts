// Parser for GoldSrc demos (.dem, demo protocol 5).
//
// Layout: a 544-byte header, then frames grouped into directory entries ("LOADING",
// "Playback"), then the directory itself, which the header points to.
// The parser records facts only; judging them is the checks' job.

import { decodeBxt, type BxtData } from './bxt.ts';

export type Header = {
  demoProtocol: number;
  netProtocol: number;
  mapName: string;
  gameDir: string;
  mapCrc: number;
  directoryOffset: number;
};

export type Entry = {
  type: number;
  description: string;
  flags: number;
  cdTrack: number;
  trackTime: number;
  frameCount: number;
  offset: number;
  fileLength: number;
};

/** Over all network frames: frame times in seconds and the msec of each usercmd. */
export type Stats = {
  count: number;
  frametimeMin: number;
  frametimeMax: number;
  frametimeSum: number;
  msecMin: number;
  msecMax: number;
  msecSum: number;
};

/** Server physics settings, sent with every network frame. */
export type MoveVars = {
  gravity: number;
  stopspeed: number;
  maxspeed: number;
  spectatormaxspeed: number;
  accelerate: number;
  airaccelerate: number;
  wateraccelerate: number;
  friction: number;
  edgefriction: number;
  waterfriction: number;
  entgravity: number;
  bounce: number;
  stepsize: number;
  maxvelocity: number;
};

/** Where something happened: the engine frame number and the demo time in seconds. */
export type At = { frame: number; time: number };

/** BXT data saved during one engine frame. */
export type BxtGroup = At & { data: BxtData[]; error?: string };

export type Demo = {
  header: Header;
  entries: Entry[];
  stats: Stats;
  /** The movevars of the first network frame, then each time they change. */
  moveVars: (At & { vars: MoveVars })[];
  bxt: BxtGroup[];
  /**
   * Set when the file is broken. Everything read before the problem is kept.
   * A demo whose directory is missing (an unfinished recording, or a cut-off file) is read
   * frame by frame instead (`recovered`), and its entries are rebuilt as the engine would have written them.
   */
  error?: string;
  recovered?: boolean;
};

const MoveVarKeys: (keyof MoveVars)[] = [
  'gravity', 'stopspeed', 'maxspeed', 'spectatormaxspeed', 'accelerate', 'airaccelerate', 'wateraccelerate',
  'friction', 'edgefriction', 'waterfriction', 'entgravity', 'bounce', 'stepsize', 'maxvelocity',
];

// Network frame layout (after the frame header): fixed part, then the message.
const NetFixed = 468;
const NetFrametime = 64; // ref_params_t.frametime
const NetMsec = 238; // usercmd_t.msec
const NetMoveVars = 288; // movevars_t, first field

const BxtHeader = [0x2f, 0x2f, 0x42, 0x58, 0x54, 0x44, 0x30]; // "//BXTD0"

class Broken extends Error {}

export function parseDemo(file: Uint8Array): Demo {
  const view = new DataView(file.buffer, file.byteOffset, file.length);
  const demo: Demo = {
    header: { demoProtocol: 0, netProtocol: 0, mapName: '', gameDir: '', mapCrc: 0, directoryOffset: 0 },
    entries: [],
    stats: { count: 0, frametimeMin: 0, frametimeMax: 0, frametimeSum: 0, msecMin: 0, msecMax: 0, msecSum: 0 },
    moveVars: [],
    bxt: [],
  };
  const s = demo.stats;

  const need = (at: number, n: number) => {
    if (at < 0 || n < 0 || at + n > file.length) throw new Broken();
  };
  const text = (at: number, n: number) => {
    let str = '';
    for (let i = at; i < at + n && file[i] !== 0; i++) str += String.fromCharCode(file[i]);
    return str;
  };

  // BXT data of the current entry, by engine frame. It's decoded once the entry is read.
  const groups = new Map<number, { at: At; parts: Uint8Array[] }>();
  const flush = () => {
    for (const { at, parts } of groups.values()) {
      const { data, error } = decodeBxt(concat(parts));
      demo.bxt.push(error === undefined ? { ...at, data } : { ...at, data, error });
    }
    groups.clear();
  };

  let lastVars = -1; // Offset of the last movevars seen.
  // Reads one entry's frames. `seg` tracks progress, so a cut-off entry can still be described.
  const readEntry = (seg: { end: number; lastTime: number; netFrames: number }) => {
    for (let done = false; !done; ) {
      let at = seg.end;
      need(at, 9);
      const type = view.getInt8(at);
      const time = view.getFloat32(at + 1, true);
      const frame = view.getInt32(at + 5, true);
      at += 9;
      switch (type) {
        case 2: break; // Demo start
        case 3: { // Console command
          need(at, 64);
          if (BxtHeader.every((b, i) => file[at + i] === b)) {
            let end = at + 7;
            while (end < at + 64 && file[end] !== 0) end++;
            let g = groups.get(frame);
            if (!g) groups.set(frame, (g = { at: { frame, time }, parts: [] }));
            g.parts.push(file.subarray(at + 7, end));
          }
          at += 64;
          break;
        }
        case 4: need(at, 32); at += 32; break; // Client data
        case 5: done = true; break; // Next section
        case 6: need(at, 84); at += 84; break; // Event
        case 7: need(at, 8); at += 8; break; // Weapon animation
        case 8: { // Sound
          need(at, 8);
          const len = view.getInt32(at + 4, true);
          need(at + 8, len);
          need(at + 8 + len, 16);
          at += 8 + len + 16;
          break;
        }
        case 9: { // Demo buffer
          need(at, 4);
          const len = view.getInt32(at, true);
          need(at + 4, len);
          at += 4 + len;
          break;
        }
        default: { // Network message
          need(at, NetFixed);
          const len = view.getInt32(at + NetFixed - 4, true);
          need(at + NetFixed, len);

          const frametime = view.getFloat32(at + NetFrametime, true);
          const msec = file[at + NetMsec];
          if (s.count === 0) {
            s.frametimeMin = s.frametimeMax = frametime;
            s.msecMin = s.msecMax = msec;
          } else {
            s.frametimeMin = Math.min(s.frametimeMin, frametime);
            s.frametimeMax = Math.max(s.frametimeMax, frametime);
            s.msecMin = Math.min(s.msecMin, msec);
            s.msecMax = Math.max(s.msecMax, msec);
          }
          s.count++;
          s.frametimeSum += frametime;
          s.msecSum += msec;

          const mv = at + NetMoveVars;
          if (lastVars < 0 || !sameBytes(file, lastVars, mv, MoveVarKeys.length * 4)) {
            const vars = {} as MoveVars;
            MoveVarKeys.forEach((k, i) => (vars[k] = view.getFloat32(mv + i * 4, true)));
            demo.moveVars.push({ frame, time, vars });
          }
          lastVars = mv;
          seg.netFrames++;
          at += NetFixed + len;
        }
      }
      if (!done) seg.lastTime = time;
      seg.end = at;
    }
  };

  try {
    if (text(0, 4) === 'IDEM') throw new Broken('This demo is from Xash3D. Runs have to be recorded in GoldSrc with BXT.');
    if (text(0, 8) !== 'HLDEMO' || file[7] !== 0) throw new Broken('This isn\'t a Half-Life demo.');
    need(0, 544);
    const h = demo.header;
    h.demoProtocol = view.getInt32(8, true);
    h.netProtocol = view.getInt32(12, true);
    h.mapName = text(16, 260);
    h.gameDir = text(276, 260);
    h.mapCrc = view.getUint32(536, true);
    h.directoryOffset = view.getInt32(540, true);
    if (h.demoProtocol !== 5) throw new Broken(`This demo uses protocol ${h.demoProtocol}, which isn't supported.`);

    const dir = h.directoryOffset;
    const count = dir >= 544 && dir + 4 <= file.length ? view.getInt32(dir, true) : -1;
    if (count < 1 || dir + 4 + count * 92 > file.length) return recover();

    for (let i = 0, at = dir + 4; i < count; i++, at += 92) {
      demo.entries.push({
        type: view.getInt32(at, true),
        description: text(at + 4, 64),
        flags: view.getInt32(at + 68, true),
        cdTrack: view.getInt32(at + 72, true),
        trackTime: view.getFloat32(at + 76, true),
        frameCount: view.getInt32(at + 80, true),
        offset: view.getInt32(at + 84, true),
        fileLength: view.getInt32(at + 88, true),
      });
    }
    for (const [i, entry] of demo.entries.entries()) {
      try {
        readEntry({ end: entry.offset, lastTime: 0, netFrames: 0 });
      } catch (e) {
        if (e instanceof Broken && !e.message) throw new Broken(`This demo is damaged: its ${entry.description || `entry ${i + 1}`} part ends early.`);
        throw e;
      }
      flush();
    }
  } catch (e) {
    if (!(e instanceof Broken)) throw e;
    flush();
    demo.error = e.message || 'This file is too short to be a demo.';
  }
  return demo;

  // Reads every complete frame from the start, then rebuilds the directory.
  // Recorded demos always have a LOADING entry with no time or frames, then Playback.
  function recover(): Demo {
    demo.recovered = true;
    demo.error = 'The recording didn\'t finish, or the file is cut off. It was read up to its last complete frame.';
    for (let at = 544; at < file.length && demo.entries.length < 2; ) {
      const loading = demo.entries.length === 0;
      const seg = { end: at, lastTime: 0, netFrames: 0 };
      let complete = true;
      try {
        readEntry(seg);
      } catch (e) {
        if (!(e instanceof Broken)) throw e;
        complete = false;
      }
      flush();
      if (seg.end === at) break;
      demo.entries.push({
        type: loading ? 0 : 1,
        description: loading ? 'LOADING' : 'Playback',
        flags: 0,
        cdTrack: -1,
        trackTime: loading ? 0 : seg.lastTime,
        frameCount: loading ? 0 : seg.netFrames,
        offset: at,
        fileLength: seg.end - at,
      });
      if (!complete) break;
      at = seg.end;
    }
    return demo;
  }
}

function sameBytes(b: Uint8Array, x: number, y: number, n: number) {
  for (let i = 0; i < n; i++) if (b[x + i] !== b[y + i]) return false;
  return true;
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let n = 0;
  for (const p of parts) {
    out.set(p, n);
    n += p.length;
  }
  return out;
}
