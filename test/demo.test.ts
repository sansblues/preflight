import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDemo } from '../src/demo.ts';
import { archive, bxtCommands, demo, DEFAULT_VARS, type Frame } from './write.ts';

const version = { type: 'version', build: 4554, version: 'abc' } as const;
const time = { type: 'time', hours: 0, minutes: 0, seconds: 1, remainder: 0.5 } as const;

// LOADING has two frames; Playback has network frames, BXT data in frames 10 and 12, and one of each other frame type.
const loading: Frame[] = [{ type: 'other', time: 0, frame: 1, kind: 2 }, { type: 'net', time: 0.5, frame: 2, frametime: 0.02, msec: 20 }];
const playback: Frame[] = [
  ...bxtCommands(archive([version])).map(command => ({ type: 'console', time: 1, frame: 10, command }) as const),
  { type: 'console', time: 1, frame: 10, command: 'toggleconsole' },
  { type: 'net', time: 1, frame: 10, frametime: 0.01 },
  ...([4, 6, 7, 8, 9] as const).map(kind => ({ type: 'other', time: 1.5, frame: 11, kind }) as const),
  { type: 'net', time: 2, frame: 11, frametime: 0.005, msec: 5, vars: { gravity: 400 } },
  ...bxtCommands(archive([time])).map(command => ({ type: 'console', time: 2.5, frame: 12, command }) as const),
  { type: 'net', time: 3, frame: 12, frametime: 0.01, vars: { gravity: 400 } },
];
const file = demo(loading, playback, 'c1a0', 'valve_WON');

test('parses header, entries and stats', () => {
  const d = parseDemo(file);
  assert.equal(d.error, undefined);
  assert.deepEqual({ ...d.header, directoryOffset: 0 }, { demoProtocol: 5, netProtocol: 47, mapName: 'c1a0', gameDir: 'valve_WON', mapCrc: 0, directoryOffset: 0 });
  assert.deepEqual(d.entries.map(e => [e.description, e.trackTime, e.frameCount]), [['LOADING', 0, 0], ['Playback', 3, 3]]);
  assert.deepEqual(d.stats, {
    count: 4, frametimeMin: Math.fround(0.005), frametimeMax: Math.fround(0.02),
    frametimeSum: Math.fround(0.02) + Math.fround(0.01) + Math.fround(0.005) + Math.fround(0.01), msecMin: 5, msecMax: 20, msecSum: 45,
  });
});

test('records movevars when they change', () => {
  assert.deepEqual(parseDemo(file).moveVars, [
    { frame: 2, time: 0.5, vars: DEFAULT_VARS },
    { frame: 11, time: 2, vars: { ...DEFAULT_VARS, gravity: 400 } },
  ]);
});

test('groups BXT data by frame, with its time', () => {
  assert.deepEqual(parseDemo(file).bxt, [{ frame: 10, time: 1, data: [version] }, { frame: 12, time: 2.5, data: [time] }]);
});

test('recovers a demo without a directory', () => {
  const unfinished = file.slice();
  new DataView(unfinished.buffer).setInt32(540, 0, true);
  const { error, header, recovered, ...rest } = parseDemo(unfinished);
  const { error: _, header: __, ...expected } = parseDemo(file);
  assert.match(error!, /no directory/);
  assert.equal(recovered, true);
  assert.deepEqual(rest, expected);
});

test('reads a cut-off demo up to its last complete frame', () => {
  const unfinished = file.slice();
  new DataView(unfinished.buffer).setInt32(540, 0, true);
  // Cut in the middle of the last network frame, which is followed by the next-section frame.
  const d = parseDemo(unfinished.subarray(0, parseDemo(file).header.directoryOffset - 9 - 200));
  assert.match(d.error!, /no directory/);
  assert.deepEqual(d.entries.map(e => [e.description, e.trackTime, e.frameCount]), [['LOADING', 0, 0], ['Playback', 2.5, 2]]);
  assert.equal(d.bxt.length, 2);
});

test('reports broken files instead of throwing', () => {
  assert.equal(parseDemo(new Uint8Array()).error, 'This is not a GoldSrc demo.');
  assert.equal(parseDemo(new TextEncoder().encode('PK\x03\x04')).error, 'This is not a GoldSrc demo.');
  assert.equal(parseDemo(file.subarray(0, 100)).error, 'The file is too short to be a demo.');

  const protocol = file.slice();
  new DataView(protocol.buffer).setInt32(8, 4, true);
  assert.match(parseDemo(protocol).error!, /protocol 4/);

  // A directory pointing into the frames: the entry runs past the end.
  const damaged = file.slice();
  const view = new DataView(damaged.buffer);
  const dir = view.getInt32(540, true);
  view.setInt32(dir + 4 + 92 + 84, damaged.length - 20, true);
  assert.match(parseDemo(damaged).error!, /Playback section ends unexpectedly/);
});
