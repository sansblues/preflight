// Compares Preflight's parser with VolvoWrench's, run through ~/hl1/vw-oracle.
// Usage: node tools/oracle-diff.ts <oracle.jsonl>
// Each line of the oracle output names its demo; this parses the same file and reports any difference.

import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parseDemo } from '../src/demo.ts';
import type { BxtData } from '../src/bxt.ts';

// VolvoWrench's physics checks, in its order (GoldSourceParser.cs).
const VW_PHYSICS = [
  ['Gravity', 'gravity', 800], ['Stopspeed', 'stopspeed', 100], ['Maxspeed', 'maxspeed', 320],
  ['Accelerate', 'accelerate', 10], ['Airaccelerate', 'airaccelerate', 10], ['Friction', 'friction', 4],
  ['Edgefriction', 'edgefriction', 2], ['Stepsize', 'stepsize', 18], ['Maxvelocity', 'maxvelocity', 2000],
] as const;

const toOracle = (d: BxtData) =>
  d.type === 'cvars' ? { type: d.type, values: [...d.values].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)) } : d;

const lines = readFileSync(process.argv[2], 'utf8').split('\n').filter(Boolean);
let same = 0;
const diffs: Record<string, number> = {};
for (const line of lines) {
  const vw = JSON.parse(line);
  const demo = parseDemo(readFileSync(vw.path));
  const ours = {
    broken: demo.error !== undefined,
    header: demo.header,
    entries: demo.entries,
    stats: demo.stats,
    cheats: [...new Set(demo.moveVars.flatMap(m => VW_PHYSICS.filter(([, k, v]) => m.vars[k] !== v).map(([n, k]) => `${n}: ${Math.fround(m.vars[k])}`)))],
    bxt: demo.bxt.map(g => g.data.map(toOracle)),
    bxtErrors: demo.bxt.filter(g => g.error).map(g => `${g.frame}: ${g.error}`),
  };
  const theirs = {
    broken: vw.errors.length > 0,
    header: vw.header,
    entries: vw.entries.map(({ framesParsed, ...e }: any) => e),
    // VolvoWrench reads msec as a signed byte, Preflight as unsigned (usercmd_t.msec is a byte). No corpus demo has msec > 127.
    stats: vw.stats,
    cheats: vw.cheats.map((c: string) => c.replace(/: (.*)/, (_, v) => `: ${Math.fround(Number(v))}`)),
    bxt: (vw.bxt ?? []).filter((g: unknown[]) => g.length > 0),
    bxtErrors: [],
  };
  // .NET writes non-finite floats as strings.
  const json = (x: unknown) => JSON.parse(JSON.stringify(x, (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v)));
  Object.assign(ours, json(ours));
  const bad = Object.keys(ours).filter(k => !isDeepStrictEqual((ours as any)[k], (theirs as any)[k]));
  if (bad.length === 0) { same++; continue; }
  for (const k of bad) diffs[k] = (diffs[k] ?? 0) + 1;
  if (Object.values(diffs).reduce((a, b) => a + b) <= 20) {
    console.log(`\n${vw.path}: ${bad.join(', ')}`);
    if (vw.errors.length || demo.error) console.log('  VW:', vw.errors, '| ours:', demo.error);
    for (const k of bad.filter(k => k !== 'bxt')) console.log(`  ${k}\n    ours:   ${JSON.stringify((ours as any)[k])}\n    theirs: ${JSON.stringify((theirs as any)[k])}`.slice(0, 2000));
    if (bad.includes('bxt')) {
      const a = ours.bxt, b = theirs.bxt;
      console.log(`  bxt groups: ours ${a.length}, theirs ${b.length}`);
      for (let i = 0; i < Math.max(a.length, b.length); i++)
        if (!isDeepStrictEqual(a[i], b[i])) { console.log(`  first differing group ${i}:\n    ours:   ${JSON.stringify(a[i])?.slice(0, 600)}\n    theirs: ${JSON.stringify(b[i])?.slice(0, 600)}`); break; }
    }
  }
}
console.log(`\n${same}/${lines.length} demos identical.`, Object.keys(diffs).length ? 'Differences by field: ' + JSON.stringify(diffs) : '');
