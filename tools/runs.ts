// Summarizes each run folder: demos, BXT version, final BXT time, and the demos' own playback time.
// Usage: node tools/runs.ts <folder of run folders>

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDemo } from '../src/demo.ts';
import { seconds, type Time } from '../src/bxt.ts';

const root = process.argv[2];
const num = (f: string) => Number(/(\d+)\.dem$/.exec(f)?.[1] ?? NaN);
let totalMs = 0, totalBytes = 0;
for (const run of readdirSync(root).sort()) {
  const files = readdirSync(join(root, run)).filter(f => f.endsWith('.dem')).sort((a, b) => num(a) - num(b));
  let playback = 0, first: Time | undefined, last: Time | undefined, broken = 0, version = new Set<string>(), maps = new Set<string>();
  for (const f of files) {
    const bytes = readFileSync(join(root, run, f));
    const t0 = performance.now();
    const d = parseDemo(bytes);
    totalMs += performance.now() - t0; totalBytes += bytes.length;
    if (d.error) broken++;
    maps.add(d.header.mapName);
    playback += d.entries.reduce((n, e) => n + e.trackTime, 0);
    for (const g of d.bxt) for (const o of g.data) {
      if (o.type === 'time') { first ??= o; last = o; }
      if (o.type === 'version') version.add(o.version.slice(0, 7));
    }
  }
  const bxt = last ? seconds(last) : NaN;
  console.log(`${run}  ${files.length} demos  ${maps.size} maps  broken ${broken}  bxt ${[...version]}  first ${first ? seconds(first).toFixed(3) : '-'}  final ${bxt.toFixed(3)}s  playback ${playback.toFixed(3)}s  diff ${(bxt - playback).toFixed(3)}`);
}
console.log(`parsed ${(totalBytes / 1e6).toFixed(0)} MB in ${(totalMs / 1000).toFixed(1)} s (${(totalBytes / 1e3 / totalMs).toFixed(0)} MB/s)`);
