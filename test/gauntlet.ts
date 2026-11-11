// Synthetic runs that break every rule, for the unit tests and for comparing with VolvoWrench
// (tools/write-gauntlet.ts writes them to disk for the oracle).

import type { BxtData } from '../src/bxt.ts';
import type { MoveVars } from '../src/demo.ts';
import rules from '../src/rules.json' with { type: 'json' };
import { archive, bxtCommands, demo, type Frame } from './write.ts';

export type Run = { name: string; files: { name: string; bytes: Uint8Array }[] };

const time = (s: number): BxtData => ({ type: 'time', hours: 0, minutes: Math.floor(s / 60), seconds: Math.floor(s % 60), remainder: s % 1 });
const command = (c: string): BxtData => ({ type: 'command', command: c });
const bind = (c: string): BxtData => ({ type: 'bind', command: c });

/** Every cvar at its required value, lower-case like the game, with overrides. */
function cvars(overrides: Record<string, string> = {}): BxtData {
  const values = new Map<string, string>();
  for (const table of [rules.cvars, rules.scriptlessCvars, rules.skillCvars]) for (const [k, v] of Object.entries(table)) values.set(k.toLowerCase(), v);
  for (const [k, v] of Object.entries(overrides)) values.set(k, v);
  return { type: 'cvars', values };
}

const start = (overrides?: Record<string, string>, version = rules.bxtVersion): BxtData[] => [
  { type: 'version', build: 3248, version }, cvars(overrides), { type: 'edicts', edicts: 900 }, { type: 'flags', flags: 0 }, { type: 'health', health: 100 }, time(0.03),
];

/** A demo with one engine frame per group of BXT data, each followed by a network frame. */
function bxtDemo(groups: BxtData[][], opts: { map?: string; gameDir?: string; vars?: Partial<MoveVars>[] } = {}) {
  const playback: Frame[] = [];
  groups.forEach((data, i) => {
    const frame = 10 + i, t = 0.5 + i * 0.01;
    for (const c of bxtCommands(archive(data))) playback.push({ type: 'console', time: t, frame, command: c });
    playback.push({ type: 'net', time: t, frame, vars: opts.vars?.[i] });
  });
  return demo([{ type: 'net', time: 0, frame: 1 }], playback, opts.map ?? 'c1a0', opts.gameDir ?? 'valve');
}

export function gauntlet(): Run[] {
  const scriptless: Run = {
    name: 'scriptless',
    files: [
      {
        name: 'run_1.dem',
        bytes: bxtDemo([
          [...start({ sv_cheats: '1', lookstrafe: '0', fps_override: '1', bxt_autopause: '1', sk_battery1: '20', cl_pitchdown: '90', sv_voicecodec: 'voice_miles', bxt_fire_on_button_command: 'x' }, 'cbc496b')],
          [{ type: 'edicts', edicts: 1024 }, { type: 'flags', flags: 1 }],
          [bind('+jump'), command('+jump'), command('-jump'), command('+duck'), bind('say hi; kill'), bind('report_to_demo 1')],
          // Two presses cover two jumps. A press only counts in its own frame.
          [bind('+jump'), bind('-jump'), bind('+jump'), bind('-jump'), command('+jump'), command('-jump'), command('+jump'), command('-jump'), bind('-duck')],
          [command('-duck')],
          [{ type: 'alias', name: 'combo', command: '+duck;wait;-duck' }, { type: 'script', filename: 'userconfig.cfg', contents: 'bind space +jump\n' }],
          ['bxt_hud_timer 1', 'bxt_autojump 1', 'bxt_timer_start', 'save mysave', 'save quick', 'autosave', 'load autosave', 'load mysave',
            'cust_99', 'cust_11', 'host_framerate 0.01', 'wait', 'c_minyaw 0', 'sv_aim 1', 'sv_gravity 800', 'cl_bob 0.01', 'cl_forwardspeed 400',
            'cl_pitchdown 90', 'r_drawviewmodel 0', 'gl_texturemode gl_linear', 'gl_clear 1', 'stats', 'mp_timelimit 0', 'bind x y', 'alias foo bar',
            'playdemo x', 'chase_active 1', 'thirdperson', 'joyadvanced 1', 'cam_command 1', 'impulse 101', 'sk_plr_9mm_bullet1 99', 'skill 3',
          ].map(command),
          [{ type: 'gameEnd' }, { type: 'gameEnd' }, time(61.5),
            { type: 'trigger', min: [0, 0, 0], max: [1, 2, 3], command: 'bxt_timer_stop' },
            { type: 'split', min: [-1, -1, -1], max: [1, 1, 1], name: 'office', map: 'c1a1' }],
        ], { vars: [{}, { gravity: 400 }, { gravity: 400, airaccelerate: 100 }] }),
      },
      { // Steam: bxt_bhopcap must be 1 and fps_override isn't checked.
        name: 'run_2.dem',
        bytes: bxtDemo([
          [...start({ bxt_bhopcap_prediction: '0', bxt_bhopcap: '0', fps_override: '1' })],
          [command('load mysave'), command('load quick'), command('load hard'), time(70)],
        ]),
      },
      // run_3 is missing.
      { // Blue Shift: battery rules differ, and the run is retimed from the tram.
        name: 'run_4.dem',
        bytes: bxtDemo([
          [...start({ sk_battery1: '20', sk_battery2: '20', sk_battery3: '20' })],
          [command('changelevel2 ba_security1 tram3_security1'), time(80.25)],
          [{ type: 'gameEnd' }, time(100.5)],
        ], { map: 'ba_teleport2', gameDir: 'bshift' }),
      },
      { // Not a trilogy game: skill cvars aren't checked.
        name: 'run_5.dem',
        bytes: bxtDemo([[...start({ sk_battery1: '99' })], [time(120)]], { gameDir: 'cstrike' }),
      },
      { name: 'run_6.dem', bytes: demo([], [{ type: 'net', time: 1, frame: 1 }]) }, // No BXT.
    ],
  };

  const scripted: Run = {
    name: 'scripted',
    files: [
      {
        name: 'tas_1.dem',
        bytes: bxtDemo([
          [...start({ bxt_autojump: '1', cl_pitchdown: '90' })],
          [{ type: 'alias', name: 'strafe', command: '+moveleft;wait;-moveleft' }, { type: 'alias', name: 'two', command: 'slot1;slot2' }, bind('a;b')],
          ['bxt_autojump 1', 'bxt_tas_jumpbug 1', 'bxt_hud_x 1', 'wait', 'cl_pitchup 90', '+jump', 'bxt_append x'].map(command),
        ]),
      },
      { name: 'tas_2.dem', bytes: bxtDemo([[...start({ bxt_autojump: '1' })], [time(5)]]) },
    ],
  };

  const tasAutojump: Run = {
    name: 'tas-autojump',
    files: [{ name: 'auto_1.dem', bytes: bxtDemo([[...start()], [command('+bxt_tas_autojump')]]) }],
  };

  return [scriptless, scripted, tasAutojump];
}
