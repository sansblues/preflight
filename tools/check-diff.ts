// Compares Preflight's checks with VolvoWrench's, run through ~/hl1/vw-oracle ("check" mode).
// Usage: node tools/check-diff.ts <oracle check .json>...
// Every line VolvoWrench prints is mapped to a kind of finding and its subject, then counted per demo.

import { readFileSync } from 'node:fs';
import { parseDemo } from '../src/demo.ts';
import { checkRun, type Kind } from '../src/check.ts';

type Item = `${string}|${string}`; // kind|subject
const count = (m: Map<Item, number>, k: Item) => m.set(k, (m.get(k) ?? 0) + 1);
// Each item is kind|subject|severity.

// Kinds VolvoWrench doesn't have: Preflight's improvements.
const Extra: Kind[] = ['broken', 'unfinished', 'missing', 'conflict', 'copy', 'naming', 'no-bxt'];
// Deliberate severity changes. VolvoWrench prints these uncoloured, except a number written differently, which it shows in red.
const Reseverity: Partial<Record<Kind, [string, string]>> = {
  'alias-script': ['info', 'check'], 'probably-disallowed': ['info', 'check'], 'cvar-format': ['problem', 'info'], 'bxt-version': ['info', 'problem'],
};
const severity = (color: string) => (color === 'illegal' ? 'problem' : color === 'warning' ? 'check' : 'info');

/** VolvoWrench's lines for one demo, as items. */
function vwItems(entries: [string, string][]): { items: Map<Item, number>; unmapped: string[] } {
  // Rebuild lines, keeping the first non-default colour of each.
  const lines: { text: string; color: string }[] = [{ text: '', color: 'default' }];
  for (const [text, color] of entries) {
    text.split('\n').forEach((part, i) => {
      if (i > 0) lines.push({ text: '', color: 'default' });
      const line = lines[lines.length - 1];
      line.text += part;
      if (part && line.color === 'default' && color !== 'default') line.color = color;
    });
  }
  const items = new Map<Item, number>(), unmapped: string[] = [];
  let cheats = false;
  for (const { text, color } of lines) {
    const items0 = new Map(items);
    const t = text.replace(/^\t/, '').replace(/ — Frame: \d+$/, '');
    let m: RegExpExecArray | null;
    if (!t || / -> /.test(t) || t === 'BXTData:' || /^(BXT Version: Latest|Game Version: |Demo bxt time: |BS start offset: )/.test(t)) cheats = false;
    else if (t === 'Possible cheats:') cheats = true;
    else if (cheats && (m = /^(\w+): (.*)$/.exec(t))) count(items, `physics|${m[1].toLowerCase()}=${Math.fround(Number(m[2]))}`);
    else if ((m = /^BXT Version: INVALID=(.*)$/.exec(t))) count(items, `bxt-version|${m[1]}`);
    else if ((m = /^Illegal Cvar: (\S+) (.*)$/.exec(t))) count(items, `cvar|${m[1].toLowerCase()} "${m[2]}"`);
    else if ((m = /^Possible script: (.*)$/.exec(t))) count(items, `bind-script|${m[1]}`);
    else if (t.startsWith('HL100: Illegal bound report_to_demo')) count(items, 'report-to-demo|');
    else if ((m = /^Alias \[(.*?)\]: (.*)$/.exec(t))) count(items, `alias-script|${m[1]}: ${m[2]}`);
    else if ((m = /^Movement command in alias \[(.*?)\]: /.exec(t))) count(items, `alias-movement|${m[1]}`);
    else if ((m = /^Config execution: (.*)$/.exec(t))) count(items, `config|${m[1]}`);
    else if ((m = /^Possible (autojump|ducktap): (.*)$/.exec(t))) count(items, `${m[1]}|${m[2]}`);
    else if ((m = /^Disallowed BXT command: (.*)$/.exec(t))) count(items, `bxt-command|${m[1]}`);
    else if ((m = /^cust value out of range: (.*)$/.exec(t))) count(items, `cust|${m[1]}`);
    else if ((m = /^Disallowed: (.*)$/.exec(t))) count(items, `disallowed|${m[1]}`);
    else if ((m = /^Probably disallowed .*?: (.*)$/.exec(t))) count(items, `probably-disallowed|${m[1]}`);
    else if (/^load/i.test(t)) count(items, `${color === 'illegal' ? 'load-unknown' : color === 'warning' ? 'load-named' : 'load'}|${t}`);
    else if (t.startsWith('GAME END')) count(items, 'game-end|');
    else if (t.startsWith('BS RETIME')) count(items, 'blue-shift|');
    else if (t.startsWith('Custom trigger')) count(items, 'trigger|');
    else if (t.startsWith('Split trigger')) count(items, 'split|');
    else if ((m = /^Max edicts value is higher than 900: (\d+)/.exec(t))) count(items, `edicts|${m[1]}`);
    else if (t.includes('bxt_enable_big_map')) count(items, 'big-map|');
    else unmapped.push(t);
    // Tag what this line added with its severity. Physics lines sit under a yellow header.
    for (const [k, n] of items) if (n !== items0.get(k) && k.split('|').length === 2) {
      items.delete(k);
      if (items0.get(k)) items.set(k, items0.get(k)!);
      const tagged = `${k}|${k.startsWith('physics|') ? 'check' : severity(color)}` as Item;
      items.set(tagged, (items.get(tagged) ?? 0) + n - (items0.get(k) ?? 0));
    }
  }
  return { items, unmapped };
}

/** Preflight's findings for one demo, keyed like VolvoWrench's. */
function ourItems(findings: ReturnType<typeof checkRun>['findings'], demo: string): Map<Item, number> {
  const items = new Map<Item, number>();
  for (const f of findings) {
    if (Extra.includes(f.kind)) continue;
    let subject = f.subject;
    let kind: string = f.kind;
    if (kind === 'cvar' || kind === 'cvar-format') { kind = 'cvar'; subject = subject.replace(/ \(must be .*\)$/, ''); }
    else if (kind === 'physics') { const m = /^(\w+) is (\S+)/.exec(subject)!; subject = `${m[1]}=${Math.fround(Number(m[2]))}`; }
    else if (kind === 'alias-movement') subject = subject.split(':')[0];
    else if (['report-to-demo', 'game-end', 'blue-shift', 'trigger', 'split', 'big-map'].includes(kind)) subject = '';
    const sev = Reseverity[f.kind]?.[1] === f.severity ? Reseverity[f.kind]![0] : f.severity;
    for (const w of f.where) if (w.demo === demo) count(items, `${kind}|${subject}|${sev}`);
  }
  // VolvoWrench lists each changed physics value once per demo.
  for (const k of [...items.keys()]) if (k.startsWith('physics|')) items.set(k, 1);
  return items;
}

let demos = 0, same = 0, runs = 0;
const extras = new Map<string, number>();
for (const file of process.argv.slice(2)) {
  const vw = JSON.parse(readFileSync(file, 'utf8'));
  const paths: string[] = [...vw.demos.map((d: any) => d.path), ...vw.broken];
  const report = checkRun(paths.map(p => ({ name: p, demo: parseDemo(readFileSync(p)) })));
  runs++;
  if ((report.mode === 'scriptless') !== vw.scriptless) console.log(`${file}: mode differs (${report.mode})`);
  for (const f of report.findings) if (Extra.includes(f.kind)) extras.set(f.kind, (extras.get(f.kind) ?? 0) + f.where.length);

  for (const d of vw.demos) {
    demos++;
    const theirs = vwItems(d.entries), ours = ourItems(report.findings, d.path);
    const keys = new Set([...theirs.items.keys(), ...ours.keys()]);
    const diff = [...keys].filter(k => theirs.items.get(k) !== ours.get(k));
    if (!diff.length && !theirs.unmapped.length) { same++; continue; }
    console.log(`\n${d.path}`);
    for (const k of diff.slice(0, 10)) console.log(`  ${k}: VolvoWrench ${theirs.items.get(k) ?? 0}, Preflight ${ours.get(k) ?? 0}`);
    for (const u of theirs.unmapped.slice(0, 5)) console.log(`  unmapped VolvoWrench line: ${u}`);
  }
}
console.log(`\n${same}/${demos} demos in ${runs} runs agree.`, 'Preflight only:', Object.fromEntries(extras));
