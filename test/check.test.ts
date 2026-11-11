import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRun, compareCvar, demoNumber, formatTime, PortedLogic, type Input } from '../src/check.ts';
import { parseDemo } from '../src/demo.ts';
import rules from '../src/rules.json' with { type: 'json' };
import { gauntlet } from './gauntlet.ts';

const runs = Object.fromEntries(gauntlet().map(r => [r.name, r.files.map(f => ({ name: f.name, demo: parseDemo(f.bytes) }))]));
const lines = (inputs: Input[], options = {}) =>
  checkRun(inputs, options).findings.map(f => `${f.severity} ${f.kind} ${f.subject} @ ${f.where.map(w => w.demo).join(' ')}`);

test('the port matches the VolvoWrench logic in rules.json', () => {
  // If this fails, Verification.cs changed: port the change to src/check.ts, then update PortedLogic.
  assert.equal(rules.logicHash, PortedLogic);
});

test('scriptless gauntlet', () => {
  // Checked against VolvoWrench itself with tools/check-diff.ts.
  assert.deepEqual(lines(runs.scriptless), [
    'problem missing run_3.dem @ run_3.dem',
    'problem bxt-version cbc496b @ run_1.dem',
    'problem cvar bxt_fire_on_button_command "x" (must be empty) @ run_1.dem',
    'problem cvar fps_override "1" (must be "0") @ run_1.dem',
    'problem cvar sv_cheats "1" (must be "0") @ run_1.dem',
    'problem cvar bxt_autopause "1" (must be "0") @ run_1.dem',
    'problem cvar cl_pitchdown "90" (must be "89") @ run_1.dem',
    'problem cvar sk_battery1 "20" (must be "15") @ run_1.dem',
    'problem edicts 1024 @ run_1.dem',
    'problem big-map bxt_enable_big_map @ run_1.dem',
    'problem report-to-demo report_to_demo 1 @ run_1.dem',
    'problem bxt-command bxt_autojump 1 @ run_1.dem',
    'problem bxt-command bxt_timer_start @ run_1.dem',
    'problem cust cust_99 @ run_1.dem',
    'problem disallowed host_framerate 0.01 @ run_1.dem',
    'problem disallowed wait @ run_1.dem',
    'problem disallowed c_minyaw 0 @ run_1.dem',
    'problem disallowed playdemo x @ run_1.dem',
    'problem disallowed chase_active 1 @ run_1.dem',
    'problem disallowed thirdperson @ run_1.dem',
    'problem disallowed joyadvanced 1 @ run_1.dem',
    'problem disallowed cam_command 1 @ run_1.dem',
    'problem disallowed sk_plr_9mm_bullet1 99 @ run_1.dem',
    'problem disallowed skill 3 @ run_1.dem',
    'problem cvar bxt_bhopcap "0" (must be "1") @ run_2.dem', // Steam
    'problem load-unknown load hard @ run_2.dem',
    'problem no-bxt  @ run_6.dem',
    'check physics gravity is 400 (normally 800) @ run_1.dem run_1.dem',
    'check physics airaccelerate is 100 (normally 10) @ run_1.dem',
    'check autojump -jump @ run_1.dem',
    'check ducktap +duck @ run_1.dem',
    'check bind-script say hi; kill @ run_1.dem',
    'check ducktap -duck @ run_1.dem', // Pressed in another frame.
    'check alias-script combo: +duck;wait;-duck @ run_1.dem',
    'check load-named load mysave @ run_1.dem run_2.dem', // Saves carry across demos.
    'check probably-disallowed sv_gravity 800 @ run_1.dem',
    'check probably-disallowed cl_forwardspeed 400 @ run_1.dem',
    'check probably-disallowed cl_pitchdown 90 @ run_1.dem',
    'check probably-disallowed r_drawviewmodel 0 @ run_1.dem',
    'check probably-disallowed gl_clear 1 @ run_1.dem',
    'check probably-disallowed stats @ run_1.dem',
    'check probably-disallowed mp_timelimit 0 @ run_1.dem',
    'info cvar-format lookstrafe "0" (must be "0.000000") @ run_1.dem',
    'info config userconfig.cfg @ run_1.dem',
    'info load load autosave @ run_1.dem',
    'info game-end c1a0 @ run_1.dem',
    'info trigger bxt_timer_stop at (0, 0, 0) to (1, 2, 3) @ run_1.dem',
    'info split office on c1a1 at (-1, -1, -1) to (1, 1, 1) @ run_1.dem',
    'info load load quick @ run_2.dem',
    'info game-end ba_teleport2 @ run_4.dem',
    'info blue-shift 0:20.250 (1:40.500 minus 1:20.250) @ run_4.dem',
  ]);
});

test('scripted gauntlet', () => {
  const report = checkRun(runs.scripted);
  assert.equal(report.mode, 'scripted');
  assert.deepEqual(lines(runs.scripted), [
    'problem bxt-command bxt_hud_x 1 @ tas_1.dem',
    'check alias-movement strafe: +moveleft;wait;-moveleft @ tas_1.dem',
  ]);
  assert.equal(checkRun(runs['tas-autojump']).mode, 'scripted');
});

test('the mode can be overridden', () => {
  const report = checkRun(runs.scripted, { mode: 'scriptless' });
  assert.equal(report.detectedMode, 'scripted');
  assert.equal(report.mode, 'scriptless');
  assert.ok(lines(runs.scripted, { mode: 'scriptless' }).includes('problem cvar bxt_autojump "1" (must be "0") @ tas_1.dem tas_2.dem'));
});

test('report summary', () => {
  const r = checkRun(runs.scripted);
  assert.deepEqual(r.demos.map(d => [d.name, d.time && formatTime(d.time)]), [['tas_1.dem', '0:00.030'], ['tas_2.dem', '0:05.000']]);
  assert.equal(formatTime(r.time!), '0:05.000');
  assert.equal(Math.round(r.fps.highest), 100);
  assert.equal(r.rules.bxtVersion, rules.bxtVersion);
  assert.deepEqual(checkRun([]).findings, []);
});

test('compares cvar values as numbers, never more loosely', () => {
  assert.equal(compareCvar('0.000000', '0'), 'format');
  assert.equal(compareCvar('89', '89.0'), 'format');
  assert.equal(compareCvar('100.0', ' 1e2 '), 'format');
  assert.equal(compareCvar('VOICE_MILES', 'voice_miles'), 'same');
  assert.equal(compareCvar('', ''), 'same');
  assert.equal(compareCvar('', '0'), 'different');
  assert.equal(compareCvar('0', ''), 'different');
  assert.equal(compareCvar('1', '1abc'), 'different');
  assert.equal(compareCvar('0', '0x0'), 'different');
});

test('checks the demo set', () => {
  const [a, b] = runs.scripted.map(i => i.demo);
  const set = (...names: [string, string?][]) =>
    lines(names.map(([name, hash], i) => ({ name, hash, demo: i % 2 ? b : a }))).filter(l => /missing|conflict|copy|naming/.test(l));
  assert.deepEqual(set(['run_1.dem'], ['run_2.dem'], ['run_3.dem']), []);
  assert.deepEqual(set(['run_2.dem'], ['run_5.dem'], ['run_9.dem']), [
    'problem missing run_1.dem @ run_1.dem',
    'problem missing run_3.dem to run_4.dem (2 demos) @ run_3.dem',
    'problem missing run_6.dem to run_8.dem (3 demos) @ run_6.dem',
  ]);
  assert.deepEqual(set(['run_1.dem', 'x'], ['other/run_1.dem', 'y'], ['run_2.dem', 'z'], ['copy/run_2.dem', 'z']), [
    'problem conflict other/run_1.dem and run_1.dem @ run_1.dem',
    'check copy copy/run_2.dem and run_2.dem @ run_2.dem',
  ]);
  assert.deepEqual(set(['run_1.dem'], ['run_2 (1).dem'], ['other_2.dem']), [
    'check naming run_2 (1).dem @ run_2 (1).dem',
    'check naming run_1.dem (the demos have 2 different names) @ run_1.dem',
    'check naming other_2.dem (the demos have 2 different names) @ other_2.dem',
  ]);
});

test('reports broken and unfinished demos, and keeps checking the rest', () => {
  const good = gauntlet()[1].files[0].bytes;
  const unfinished = good.slice();
  new DataView(unfinished.buffer).setInt32(540, 0, true);
  const r = checkRun([
    { name: 'run_1.dem', demo: parseDemo(unfinished) },
    { name: 'run_2.dem', demo: parseDemo(new Uint8Array(10)) },
  ]);
  assert.deepEqual(r.findings.filter(f => f.severity !== 'info').map(f => `${f.kind} ${f.where[0].demo}`), [
    'bxt-command run_1.dem', // Still checked: the unfinished demo was recovered.
    'broken run_2.dem',
    'unfinished run_1.dem',
    'alias-movement run_1.dem',
  ]);
});

test('demo numbers', () => {
  assert.deepEqual(demoNumber('C:\\runs\\any_12.DEM'), { prefix: 'any', n: 12 });
  assert.deepEqual(demoNumber('my_run_3.dem'), { prefix: 'my_run', n: 3 });
  assert.equal(demoNumber('run_3 (1).dem'), undefined);
  assert.equal(demoNumber('run.dem'), undefined);
});
