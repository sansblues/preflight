// Generates src/rules.json from the moderators' checker, VolvoWrench (hobokenn/VolvoWrench, branch scriptless).
// Usage: node tools/rules.ts <VolvoWrench clone>
//
// The literal tables (cvar values, allowed commands, the expected BXT build, physics defaults) are
// extracted strictly: anything unexpected stops the script. The logic around them is ported by hand
// in src/check.ts, so it's fingerprinted instead: when it changes upstream, the tests fail until
// the port is reviewed and PORTED_LOGIC in src/check.ts is updated.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) throw new Error('Usage: node tools/rules.ts <VolvoWrench clone>');
const dir = join(repo, 'VolvoWrench/Demo stuff/GoldSource');
const verification = readFileSync(join(dir, 'Verification.cs'), 'utf8').replace(/\r\n/g, '\n');
const parser = readFileSync(join(dir, 'GoldSourceParser.cs'), 'utf8').replace(/\r\n/g, '\n');
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();

function fail(what: string): never {
  throw new Error(`Verification.cs changed shape: ${what}. Update tools/rules.ts.`);
}

/** Returns the index just past the brace that closes the one at `open`, skipping strings, chars and comments. */
function closeBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i);
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i) + 1;
    else if (c === '"') {
      const verbatim = src[i - 1] === '@'; // In @"...", a quote is written "".
      for (i++; i < src.length; i++) {
        if (!verbatim && src[i] === '\\') i++;
        else if (src[i] === '"') {
          if (verbatim && src[i + 1] === '"') i++;
          else break;
        }
      }
    } else if (c === "'") i = src.indexOf("'", i + (src[i + 1] === '\\' ? 3 : 2));
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  fail('unbalanced braces');
}

/** The text of a block that starts at the first `{` after `start`. */
function block(src: string, start: string, from = 0): { text: string; at: number; end: number } {
  const at = src.indexOf(start, from);
  if (at < 0) fail(`can't find "${start}"`);
  const open = src.indexOf('{', at + start.length);
  const end = closeBrace(src, open);
  return { text: src.slice(open + 1, end - 1), at, end };
}

const strings = (text: string) => [...text.matchAll(/"([^"\\]*)"/g)].map(m => m[1]);

/** Parses a block that may only hold the given pattern (plus commas, whitespace and comments). */
function only(text: string, pattern: RegExp, what: string): RegExpMatchArray[] {
  const matches = [...text.matchAll(pattern)];
  const rest = text.replace(pattern, '').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').replace(/[\s,]/g, '');
  if (rest) fail(`unexpected text in ${what}: ${rest.slice(0, 80)}`);
  return matches;
}

const pairs = (text: string, what: string) =>
  Object.fromEntries(only(text, /\{\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\}/g, what).map(m => [m[1], m[2]]));

const parse = block(verification, 'public void ParseBxtData(');
const autojump = block(verification, 'private static bool FirstDemoHasAutojump(');
const body = parse.text;
if (!body.trimEnd().endsWith('AddDemoTree(info.Key, info.Value);')) fail('ParseBxtData no longer ends with AddDemoTree');
const removed: string[] = []; // Extracted text, cut out of the logic fingerprint.
const take = (text: string) => (removed.push(text), text);

const bxtVersion = /const string bxtVersion = "([^"]+)";/.exec(body)?.[1] ?? fail('bxtVersion');
take(bxtVersion);

const cvars = pairs(take(block(body, 'var cvarRules = new Dictionary<string, string>()').text), 'cvarRules');
const scriptless = block(body, 'if (isScriptlessMode)');
const scriptlessCvars = Object.fromEntries(
  only(take(scriptless.text), /cvarRules\.Add\("([^"]+)", "([^"]*)"\);/g, 'scriptless cvars').map(m => [m[1], m[2]]),
);
const skillCvars = pairs(take(block(body, 'var skillCvarRules = new Dictionary<string, string>()').text), 'skillCvarRules');
const blueShift = block(body, 'if(info.Value.GsDemoInfo.Header.MapName.StartsWith("ba_"))');
const blueShiftSkillCvars = Object.fromEntries(
  only(take(blueShift.text), /skillCvarRules\["([^"]+)"\] = "([^"]*)";/g, 'Blue Shift cvars').map(m => [m[1], m[2]]),
);
const trilogy = /bool gameLooksLikeTrilogy = (.*);/.exec(body)?.[1] ?? fail('gameLooksLikeTrilogy');
const skillGameDirs = only(take(trilogy), /gamedir\.StartsWith\("([^"]+)"\)|\|\|/g, 'game dirs').map(m => m[1]).filter(Boolean);

const steam = /if \(cvars\.Any\(item\s*=>\s*item\s*\.Key == "([^"]+)"\)\)[^{]*\{([^}]*)\}/.exec(body) ?? fail('Steam detection');
take(steam[0]);
const steamCvar = steam[1];
const steamCvars = Object.fromEntries([...steam[2].matchAll(/cvarRules\["([^"]+)"\] = "([^"]*)";/g)].map(m => [m[1], m[2]]));
const steamRemoves = [...steam[2].matchAll(/cvarRules\.Remove\("([^"]+)"\);/g)].map(m => m[1]);
if (!Object.keys(steamCvars).length && !steamRemoves.length) fail('Steam rules');

const allowedBxtCommands = strings(take(block(body, 'var allowedBxtCommands = new HashSet<string>').text));
const scriptedBlock = block(body, 'if (!isScriptlessMode)', body.indexOf('var allowedBxtCommands'));
const scriptedBxtCommands = only(take(scriptedBlock.text), /allowedBxtCommands\.Add\("([^"]+)"\);/g, 'scripted BXT commands').map(m => m[1]);
const allowedCust = strings(take(block(body, 'var allowedCust = new HashSet<string>').text));

// GoldSourceParser.cs flags these movevars when they differ from the default.
const physics = Object.fromEntries(
  [...parser.matchAll(/if\s*\(\s*nf\.MVars\.(\w+) != (\d+)\)/g)].map(m => [m[1].toLowerCase(), Number(m[2])]),
);
if (Object.keys(physics).length < 5) fail('physics checks in GoldSourceParser.cs');

// The rest is logic. Strip the extracted tables, comments and whitespace, then hash it.
let logic = body + autojump.text;
for (const r of removed) logic = logic.replace(r, '');
logic = logic.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
const logicHash = createHash('sha256').update(logic).digest('hex').slice(0, 16);

// VolvoWrench upper-cases the demo's value but not the rule's, so a lower-case rule could never match.
const all = { ...cvars, ...scriptlessCvars, ...skillCvars, ...blueShiftSkillCvars, ...steamCvars };
const lower = Object.entries(all).filter(([, v]) => v !== v.toUpperCase());
if (lower.length) console.warn('Rules VolvoWrench can never match (lower-case values):', lower);

const rules = {
  source: { repo: 'hobokenn/VolvoWrench', commit: git('rev-parse', 'HEAD'), date: git('log', '-1', '--format=%cs') },
  bxtVersion,
  cvars,
  scriptlessCvars,
  skillCvars,
  skillGameDirs,
  blueShiftSkillCvars,
  steamCvar,
  steamCvars,
  steamRemoves,
  allowedBxtCommands,
  scriptedBxtCommands,
  allowedCust,
  physics,
  logicHash,
};
writeFileSync(new URL('../src/rules.json', import.meta.url), JSON.stringify(rules, null, 2) + '\n');
console.log(
  `src/rules.json from ${rules.source.commit.slice(0, 7)} (${rules.source.date}): ${Object.keys(cvars).length} cvars, ` +
    `${Object.keys(scriptlessCvars).length} Scriptless, ${Object.keys(skillCvars).length} skill, ` +
    `${allowedBxtCommands.length}+${scriptedBxtCommands.length} BXT commands, ${allowedCust.length} cust, ` +
    `${Object.keys(physics).length} physics. Logic ${logicHash}.`,
);
