// Writes the synthetic gauntlet runs (test/gauntlet.ts) to a folder, one subfolder per run.
// Usage: node tools/write-gauntlet.ts <folder>

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gauntlet } from '../test/gauntlet.ts';

const root = process.argv[2];
for (const run of gauntlet()) {
  const dir = join(root, run.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of run.files) writeFileSync(join(dir, f.name), f.bytes);
  console.log(`${dir}: ${run.files.length} demos`);
}
