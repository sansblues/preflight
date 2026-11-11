// Drives the built site in Chrome: picks demos the way a person would and reads the report.
// Usage: node tools/e2e.ts <screenshot folder> <fixture folder> <demos folder> <gauntlet folder>
// Fixtures: run.zip (a real run, zipped) and notes.rar. Run `vite build` and tools/write-gauntlet.ts first.

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';

const [shots, fixtures, demos, gauntlet] = process.argv.slice(2);
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--port', '4173', '--strictPort'], { stdio: 'pipe' });
await new Promise<void>((ok, fail) => {
  server.stdout.on('data', d => String(d).includes('4173') && ok());
  server.stderr.on('data', d => fail(new Error(String(d))));
});
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome' });

let failed = 0;
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failed++;
};

async function pick(page: Page, button: string, files: string | string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: button }).click();
  await (await chooser).setFiles(files);
}

async function check(name: string, scheme: 'light' | 'dark', run: (page: Page) => Promise<void>, width = 900) {
  const page = await browser.newPage({ colorScheme: scheme, viewport: { width, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:4173/');
  await run(page);
  await page.screenshot({ path: join(shots, `${name}-${scheme}.png`), fullPage: true });
  expect(errors.length === 0, `${name}: no errors ${errors.join(' ')}`);
  await page.close();
}

const text = (page: Page, selector: string) => page.locator(selector).first().innerText();

// A real file drag, as the OS would deliver it.
async function drop(page: Page, files: string[]) {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files, dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) await cdp.send('Input.dispatchDragEvent', { type, x: 400, y: 300, data });
}

await check('idle', 'light', async page => {
  expect(await page.getByText('Drop your run\'s demos here').isVisible(), 'idle: drop zone shows');
});
await check('idle', 'dark', async () => {});

for (const scheme of ['light', 'dark'] as const) {
  await check('gauntlet', scheme, async page => {
    await pick(page, 'Choose a folder', join(gauntlet, 'scriptless'));
    await page.locator('.verdict').waitFor();
    expect((await text(page, '.verdict')) === '28 problems and 15 things to check', `gauntlet: verdict "${await text(page, '.verdict')}"`);
    expect((await text(page, '.time')) === '2:00.000', 'gauntlet: time');
    expect((await page.locator('.items > li').count()) === 52, 'gauntlet: 52 findings');
  });
}

await check('drop', 'light', async page => {
  await drop(page, [join(gauntlet, 'scripted'), join(fixtures, 'run.zip')]);
  await page.locator('.verdict').waitFor();
  expect((await text(page, '.facts')).startsWith('14 demos'), `drop: a folder and a zip, ${await text(page, '.facts')}`);
});

await check('phone', 'light', async page => {
  await pick(page, 'Choose a folder', join(gauntlet, 'scriptless'));
  await page.locator('.verdict').waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: no sideways scroll');
}, 375);

await check('individual-level', 'dark', async page => {
  await pick(page, 'Choose a folder', join(gauntlet, 'individual-level'));
  await page.locator('.verdict').waitFor();
  expect((await text(page, '.verdict')) === 'Individual-level run', 'individual level: neutral verdict');
  expect(!(await page.locator('.findings').first().isVisible()), 'individual level: full-game findings collapsed');
});

await check('zip', 'light', async page => {
  await pick(page, 'Choose files', join(fixtures, 'run.zip'));
  await page.locator('.verdict').waitFor();
  const facts = await text(page, '.facts');
  expect(facts.startsWith('12 demos · c1a0 to'), `zip: ${facts}`);
  expect((await text(page, '.time')) === '5:28.936', `zip: time ${await text(page, '.time')}`);
});

await check('big', 'dark', async page => {
  const t0 = Date.now();
  await pick(page, 'Choose a folder', join(demos, '2026-11-09 18.22.45 run'));
  await page.locator('.verdict').waitFor({ timeout: 60_000 });
  const seconds = (Date.now() - t0) / 1000;
  expect((await text(page, '.facts')).startsWith('448 demos'), `big: 448 demos in ${seconds.toFixed(1)} s`);
  await page.getByRole('button', { name: 'Check as scripted' }).click();
  await page.getByText('checked as scripted (detected Scriptless)').waitFor();
  expect(true, 'big: mode switch');
});

await check('rar', 'light', async page => {
  await pick(page, 'Choose files', join(fixtures, 'notes.rar'));
  await page.getByRole('alert').waitFor();
  expect((await text(page, '[role=alert]')) === 'Preflight can\'t open notes.rar. Extract it and drop the folder instead.', 'rar: clear error');
});

await browser.close();
server.kill();
console.log(failed ? `${failed} failed` : 'All passed');
process.exit(failed ? 1 : 0);
