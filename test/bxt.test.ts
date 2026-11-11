import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBxt, seconds, type BxtData } from '../src/bxt.ts';
import { archive, bxtCommands, teaEncrypt } from './write.ts';

// What parseDemo hands the decoder: each command after "//BXTD0" up to its first NUL, joined.
const payload = (commands: Uint8Array[]) =>
  Uint8Array.from(commands.flatMap(c => [...c.subarray(7, c.indexOf(0, 7))]));

const ALL: BxtData[] = [
  { type: 'version', build: 4554, version: '9ec20d9534f7c1347a362bc85efcb6f3115994f6-CLEAN based on sep-19-2026' },
  { type: 'cvars', values: new Map([['sv_cheats', '0'], ['fps_max', '100.0'], ['name', 'ünïcode ;"\n']]) },
  { type: 'time', hours: 1, minutes: 2, seconds: 3, remainder: 0.25 },
  { type: 'bind', command: '+jump' },
  { type: 'alias', name: 'a', command: '+duck;wait;-duck' },
  { type: 'script', filename: 'userconfig.cfg', contents: 'bind space +jump\n' },
  { type: 'command', command: 'bxt_timer_start' },
  { type: 'gameEnd' },
  { type: 'modules', filenames: ['hl.dll', 'client.dll'] },
  { type: 'trigger', min: [-1.5, 2, 3], max: [4, 5, 6.25], command: 'say hi' },
  { type: 'edicts', edicts: 900 },
  { type: 'health', health: -5 },
  { type: 'split', min: [0, 0, 0], max: [1, 1, 1], name: 'start', map: 'c1a0' },
  { type: 'flags', flags: 1 },
];

test('TEA matches BunnymodXT', () => {
  // BunnymodXT/TEA.cpp, compiled unchanged, encrypts "Prefligh" to this.
  const block = new TextEncoder().encode('Prefligh');
  teaEncrypt(block);
  assert.equal(Buffer.from(block).toString('hex'), 'cdef732e8f7380af');
  const { error } = decodeBxt(block);
  assert.ok(error); // Not a valid archive, but decryption itself must not throw.
});

test('decodes every data type', () => {
  assert.deepEqual(decodeBxt(payload(bxtCommands(archive(ALL)))), { data: ALL });
});

test('decodes two archives saved in the same frame', () => {
  const a = ALL.slice(0, 3), b = ALL.slice(3);
  assert.deepEqual(decodeBxt(payload(bxtCommands(archive(a), archive(b)))).data, ALL);
});

test('round-trips random data, including escapes split across commands', () => {
  let seed = 1;
  const random = () => ((seed = (seed * 48271) % 0x7fffffff) / 0x7fffffff);
  let splits = 0;
  for (let n = 0; n < 300; n++) {
    const objects: BxtData[] = Array.from({ length: 1 + Math.floor(random() * 5) }, () => ({
      type: 'command',
      command: String.fromCharCode(...Array.from({ length: Math.floor(random() * 120) }, () => 32 + Math.floor(random() * 95))),
    }));
    const commands = bxtCommands(archive(objects));
    const escaped = payload(commands);
    for (let i = 0; i < escaped.length; i++) if (escaped[i] === 0xff && i++ % 56 === 55) splits++;
    assert.deepEqual(decodeBxt(escaped), { data: objects });
  }
  assert.ok(splits >= 5, `only ${splits} split escapes`);
});

test('keeps what it decoded before an error', () => {
  const bytes = archive(ALL.slice(0, 2));
  bytes[0] = 3; // Claims a third object, which isn't there.
  const cut = decodeBxt(payload(bxtCommands(bytes)));
  assert.deepEqual(cut.data, ALL.slice(0, 2));
  assert.ok(cut.error);

  const unknown = [...archive([ALL[6]]), 15];
  unknown[0] = 2;
  assert.deepEqual(decodeBxt(payload(bxtCommands(unknown))), { data: [ALL[6]], error: 'unknown data type 15' });
});

test('rejects malformed payloads', () => {
  assert.equal(decodeBxt(Uint8Array.of(0xff, 0x09)).error, 'invalid escape sequence');
  assert.equal(decodeBxt(Uint8Array.of(0xff)).error, 'invalid escape sequence');
  assert.equal(decodeBxt(Uint8Array.of(1, 2, 3)).error, 'length 3 is not a multiple of 8');
  assert.deepEqual(decodeBxt(new Uint8Array()), { data: [] });
});

test('seconds', () => {
  assert.equal(seconds({ hours: 1, minutes: 2, seconds: 3, remainder: 0.5 }), 3723.5);
});
