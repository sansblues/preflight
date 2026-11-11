// Generates src/levels.json from the official individual-level configs (speedrun.com/hl1/resources):
// "[Current] Individual Level: Configs and Saves" and "[Legacy] Individual Level: Configs".
// Usage: node tools/levels.ts <current Configs folder> <legacy half-life folder>
//
// Each current config loads the chapter's save, gives the items, sets health and armor, and adds two triggers:
// one starts the timer at the chapter's first changelevel, the other stops it and the demo at the end.
// A legacy config loads the chapter's first map, starts the timer, records, and gives the items.
// Anything unexpected in a config stops the script.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, legacyDir] = process.argv.slice(2);
if (!dir || !legacyDir) throw new Error('Usage: node tools/levels.ts <current Configs folder> <legacy half-life folder>');

// Chapters in play order, with their first maps (as in BunnymodXT's discord_integration.hpp).
const Chapters = {
  AM: ['Anomalous Materials', 'c1a0'], UC: ['Unforeseen Consequences', 'c1a0c'], OC: ['Office Complex', 'c1a2'], WGH: ['We\'ve Got Hostiles', 'c1a3'],
  BP: ['Blast Pit', 'c1a4'], PU: ['Power Up', 'c2a1'], OAR: ['On A Rail', 'c2a2'], APP: ['Apprehension', 'c2a3'], RP: ['Residue Processing', 'c2a4'],
  QE: ['Questionable Ethics', 'c2a4d'], ST: ['Surface Tension', 'c2a5'], FAF: ['Forget About Freeman', 'c3a1'], LC: ['Lambda Core', 'c3a2e'],
  XEN: ['Xen', 'c4a1'], GON: ['Gonarch\'s Lair', 'c4a2'], INT: ['Interloper', 'c4a1a'], NIH: ['Nihilanth', 'c4a3'],
};
const Start = 'bxt_timer_reset;bxt_timer_start;bxt_triggers_delete 1';
const Stop = 'bxt_timer_stop;stop';
const Ignored = /^(wait|w \d+|stop|sv_cheats [01]|bxt_triggers_clear|bxt_show_custom_triggers 0|bxt_hud_timer 1|bxt_timer_(reset|start)|bxt_autorecord \S+|map c1a0)$/;

type Box = { min: number[]; max: number[] };

function parse(file: string, text: string) {
  const fail = (line: string): never => { throw new Error(`${file}: unexpected "${line}". Update tools/levels.ts.`); };
  const boxes: Box[] = [], commands: string[] = [], gives: Record<string, number> = {};
  let save: string | undefined, health: number | null | undefined, armor: number | null | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    const command = /^bxt_triggers_setcommand(?: (\d))? "([^"]*)"$/i.exec(line);
    if (command) {
      commands[command[1] ? Number(command[1]) - 1 : boxes.length - 1] = command[2];
      continue;
    }
    for (const part of line.split(';').map(p => p.trim())) {
      const [cmd, comment] = part.split(/\s*\/\/\s*/);
      let m: RegExpExecArray | null;
      if (Ignored.test(cmd)) continue;
      if ((m = /^load (\S+)$/.exec(cmd))) save = m[1];
      else if ((m = /^give (\w+)$/.exec(cmd))) gives[m[1]] = (gives[m[1]] ?? 0) + 1;
      else if ((m = /^bxt_triggers_add((?: -?[\d.]+){6})$/.exec(cmd))) {
        const v = m[1].trim().split(' ').map(Number);
        boxes.push({ min: [0, 1, 2].map(i => Math.min(v[i], v[i + 3])), max: [0, 1, 2].map(i => Math.max(v[i], v[i + 3])) });
      } else if ((m = /^bxt_ch_set_(health|armor) (\d+)$/.exec(cmd))) {
        // The limit is in the comment: "Maximum 100" or "Maximum unlimited".
        const limit = /^Maximum (\d+|unlimited)$/.exec(comment ?? '') ?? fail(part);
        const value = limit[1] === 'unlimited' ? null : Number(limit[1]);
        if (m[1] === 'health') health = value;
        else armor = value;
      } else fail(part);
    }
  }
  const trigger = (command: string) => boxes[commands.indexOf(command)];
  return { save, start: trigger(Start), stop: trigger(Stop), gives, health, armor };
}

/** The items a legacy config gives, after checking it has the usual shape. */
function legacy(map: string) {
  const file = `${map}.cfg`, gives: Record<string, number> = {};
  const lines = readFileSync(join(legacyDir, file), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const head = ['sv_cheats 1', 'wait', 'stop', 'bxt_timer_reset', `map ${map}`, 'bxt_timer_start', 'bxt_record IL'];
  if (lines.slice(0, head.length).join('|') !== head.join('|') || lines.at(-1) !== 'sv_cheats 0') throw new Error(`${file} changed shape`);
  for (const part of lines.slice(head.length, -1).flatMap(l => l.split(';')).map(p => p.trim())) {
    const give = /^give (\w+)$/.exec(part);
    if (give) gives[give[1]] = (gives[give[1]] ?? 0) + 1;
    // c4a1.cfg has a line that starts with "ammo_9mmAR" without "give": the game ignores it as an unknown command.
    else if (part !== 'wait' && !/^(ammo|weapon|item)_\w+$/.test(part)) throw new Error(`${file}: unexpected "${part}"`);
  }
  return gives;
}

const files = readdirSync(dir).filter(f => f.endsWith('_IL.cfg'));
const chapters = Object.entries(Chapters);
const levels = chapters.map(([code, [name, first]], i) => {
  const file = `${code}_IL.cfg`;
  if (!files.includes(file)) throw new Error(`${file} is missing`);
  const c = parse(file, readFileSync(join(dir, file), 'utf8'));
  // A chapter ends at its stop trigger or on the changelevel into the next one, whichever comes first.
  // The moderators timed a verified Anomalous Materials run at the changelevel, which fired before the trigger.
  // Nihilanth has neither: it ends with the game.
  const endMap = chapters[i + 1]?.[1][1];
  const shared = { name, first, ...(endMap && { endMap }), legacy: legacy(first) };
  if (code === 'AM') {
    // A new game, like a full run.
    if (c.save || c.start || !c.stop) throw new Error('AM_IL.cfg changed shape');
    return { ...shared, stop: c.stop };
  }
  if (!c.save || !c.start || c.health === undefined || c.armor === undefined) throw new Error(`${file} changed shape`);
  return { ...shared, save: c.save, start: c.start, ...(c.stop && { stop: c.stop }), gives: c.gives, health: c.health, armor: c.armor };
});
if (files.length !== levels.length) throw new Error(`unexpected configs: ${files.join(', ')}`);

const hash = createHash('sha256');
for (const f of files.sort()) hash.update(readFileSync(join(dir, f)));
for (const [, [, first]] of chapters) hash.update(readFileSync(join(legacyDir, `${first}.cfg`)));
const out = {
  source: { resource: 'https://www.speedrun.com/hl1/resources', configs: hash.digest('hex').slice(0, 16) },
  // Hazard Course has no config: a new game on t0a0, ending with the game.
  levels: [{ name: 'Hazard Course', first: 't0a0' }, ...levels],
};
writeFileSync(new URL('../src/levels.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(`${levels.length + 1} levels`);
