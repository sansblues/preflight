import { test } from 'node:test';
import assert from 'node:assert/strict';
import factory, { type SevenZipModuleFactory } from '7z-wasm';
import { extract } from '../src/archive.ts';
import { gauntlet } from './gauntlet.ts';

const SevenZip = factory as unknown as SevenZipModuleFactory;
const demo = gauntlet()[1].files[0].bytes.slice();

async function sevenZip(password?: string) {
  const sz = await SevenZip({ print: () => {}, printErr: () => {} });
  sz.FS.mkdir('/run');
  sz.FS.writeFile('/run/run_1.dem', demo);
  sz.callMain(['a', ...(password ? [`-p${password}`] : []), '/run.7z', '/run']);
  return new Blob([sz.FS.readFile('/run.7z').slice()]);
}

test('extracts a .7z', async () => {
  const [entry, ...rest] = await extract(await sevenZip(), 'run.7z');
  assert.deepEqual([entry.name, entry.size, rest.length], ['run/run_1.dem', demo.length, 0]);
  assert.deepEqual(await entry.read(), demo);
});

test('explains archives it can\'t open', async () => {
  await assert.rejects(extract(await sevenZip('secret'), 'run.7z'), { message: 'run.7z has a password. Extract it and drop the folder.' });
  await assert.rejects(extract(new Blob([demo]), 'run.rar'), { message: 'Can\'t open run.rar. It may be damaged.' });
  process.exitCode = 0; // 7-Zip's Node build reports its last error as the exit code.
});
