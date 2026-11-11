// Checks directory recovery: strips the directory from every intact demo and expects the
// frame-by-frame read to give exactly the same result. Also cuts demos at random points
// and expects a clean error, never an exception.
// Usage: node tools/recover-check.ts <folder>

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parseDemo } from '../src/demo.ts';

const demos = (readdirSync(process.argv[2], { recursive: true }) as string[]).filter(f => f.endsWith('.dem')).map(f => join(process.argv[2], f));
let same = 0, intact = 0, cuts = 0;
for (const path of demos) {
  const file = readFileSync(path);
  const original = parseDemo(file);
  if (original.error) continue;
  intact++;

  const stripped = new Uint8Array(file);
  new DataView(stripped.buffer).setInt32(540, 0, true);
  const { header, error, ...recovered } = parseDemo(stripped);
  const { header: h0, error: e0, ...expected } = original;
  if (isDeepStrictEqual(recovered, expected) && error) same++;
  else console.log('differs:', path);

  // Cut inside the frames: recovery must keep a prefix of the BXT data.
  for (let k = 0; k < 3; k++) {
    const cut = 544 + Math.floor(Math.random() * (h0.directoryOffset - 544));
    const d = parseDemo(new Uint8Array(stripped.subarray(0, cut)));
    cuts++;
    const prefix = d.bxt.slice(0, -1).every((g, i) => isDeepStrictEqual(g, original.bxt[i]));
    if (!d.error || !prefix) console.log('bad cut:', path, cut, d.error);
  }
}
console.log(`${same}/${intact} intact demos recover identically; ${cuts} random cuts checked.`);
