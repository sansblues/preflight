import { clock, formatTime, Kinds, type Finding, type Report, type Severity, type Where } from './check.ts';
import type { Reply, Request } from './worker.ts';

type Child = Node | string | false | null | undefined;
type Picked = { name: string; file: File };

const main = document.querySelector('main')!;
let worker: Worker | undefined;

function h(tag: string, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k, v);
    else if (v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...present(children));
  return el;
}

const present = (children: Child[]) => children.filter((c): c is Node | string => !!c);
const render = (...children: Child[]) => main.replaceChildren(...present(children));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function start(files: Picked[]) {
  worker?.terminate();
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }: MessageEvent<Reply>) => {
    if ('progress' in data) progress(data.progress);
    else if ('report' in data) report(data.report);
    else idle(data.error);
  };
  send({ files });
  progress({ done: 0, total: files.length, name: '' });
}

const send = (request: Request) => worker!.postMessage(request);

function idle(error?: string) {
  const pick = (folder: boolean) => {
    const input = h('input', { type: 'file', multiple: true, ...(folder ? { webkitdirectory: true } : { accept: '.dem,.zip' }) }) as HTMLInputElement;
    input.onchange = () => start([...input.files!].map(file => ({ name: file.webkitRelativePath || file.name, file })));
    input.click();
  };
  render(
    h('section', { class: 'drop' },
      h('p', { class: 'drop-title' }, 'Drop your run\'s demos here'),
      h('p', {}, 'Demo files, a folder or a zip.'),
      h('p', { class: 'actions' },
        h('button', { class: 'primary', click: () => pick(false) }, 'Choose files'),
        h('button', { click: () => pick(true) }, 'Choose a folder')),
      error && h('p', { class: 'error', role: 'alert' }, error)),
  );
}

function progress({ done, total, name }: { done: number; total: number; name: string }) {
  render(
    h('section', { class: 'progress', 'aria-live': 'polite' },
      h('p', {}, name ? `Reading ${name}` : 'Opening files'),
      h('progress', { value: String(done), max: String(total || 1) }),
      h('p', { class: 'muted' }, total ? `${done} of ${plural(total, 'demo')}` : '')),
  );
}

function report(r: Report) {
  const count = (s: Severity) => r.findings.filter(f => f.severity === s).length;
  const problems = count('problem'), checks = count('check');
  const verdict = problems && checks ? `${plural(problems, 'problem')} and ${plural(checks, 'thing')} to check`
    : problems ? plural(problems, 'problem')
    : checks ? `No problems, but ${plural(checks, 'thing')} to check`
    : 'No problems found';
  const last = r.demos[r.demos.length - 1];
  const maps = [...new Set([r.demos[0]?.map, last?.map])].filter(Boolean).join(' to ');
  const other = r.mode === 'scriptless' ? 'scripted' : 'scriptless';
  const name = (m: string) => (m === 'scriptless' ? 'Scriptless' : 'scripted');

  render(
    h('section', { class: 'summary', 'aria-live': 'polite' },
      h('p', { class: 'label' }, 'BXT time'),
      h('p', { class: 'time' }, r.time ? formatTime(r.time) : 'No time'),
      last?.error && r.time && h('p', { class: 'muted' }, 'The last demo is unfinished, so this time is only accurate to the second.'),
      h('p', { class: 'verdict', 'data-severity': problems ? 'problem' : checks ? 'check' : 'good' }, verdict),
      h('p', { class: 'facts' },
        [plural(r.demos.length, 'demo'), maps, `checked as ${name(r.mode)}${r.mode === r.detectedMode ? '' : ` (detected ${name(r.detectedMode)})`}`].filter(Boolean).join(' · '),
        ' ', h('button', { class: 'link', click: () => send({ mode: other }) }, `Check as ${name(other)}`))),
    section('Problems', r.findings.filter(f => f.severity === 'problem')),
    section('To check', r.findings.filter(f => f.severity === 'check')),
    section('Notes', r.findings.filter(f => f.severity === 'info')),
    h('section', {},
      h('h2', {}, 'About this run'),
      h('dl', {},
        h('dt', {}, 'Frame rate'), h('dd', {}, `${r.fps.average.toFixed(1)} fps on average, from ${r.fps.lowest.toFixed(1)} to ${r.fps.highest.toFixed(1)}`),
        h('dt', {}, 'Demo length'), h('dd', {}, clock(r.demoTime, 2)),
        h('dt', {}, 'Required BXT'), h('dd', {}, h('code', {}, r.rules.bxtVersion)),
        h('dt', {}, 'Rules'), h('dd', {}, `VolvoWrench, ${new Date(r.rules.source.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`))),
    h('p', { class: 'actions' }, h('button', { class: 'primary', click: () => idle() }, 'Check another run')),
  );
}

function section(title: string, findings: Finding[]) {
  const kinds = Map.groupBy(findings, f => f.kind);
  return findings.length > 0 && h('section', {},
    h('h2', {}, title, h('span', { class: 'count' }, String(findings.length))),
    h('ul', { class: 'findings' }, ...[...kinds].map(([kind, items]) => h('li', { 'data-severity': items[0].severity },
      h('h3', {}, Kinds[kind].title),
      Kinds[kind].fix && h('p', { class: 'muted' }, Kinds[kind].fix),
      h('ul', { class: 'items' }, ...items.map(f => h('li', {}, subject(f), places(f.where.filter(w => w.demo !== f.subject)))))))));
}

function subject(f: Finding) {
  if (!f.subject) return null;
  return f.kind === 'broken' || f.kind === 'unfinished' ? h('p', {}, f.subject) : h('code', {}, f.subject);
}

function places(where: Where[]) {
  if (!where.length) return null;
  const place = (w: Where) => (w.time === undefined ? w.demo : `${w.demo} at ${clock(w.time, 2)}`);
  if (where.length === 1) return h('p', { class: 'where' }, place(where[0]));
  const shown = where.slice(0, 500);
  return h('details', { class: 'where' },
    h('summary', {}, `${place(where[0])} and ${where.length - 1} more`),
    h('ul', {}, ...shown.map(w => h('li', {}, place(w)))),
    where.length > shown.length && h('p', {}, `and ${where.length - shown.length} more`));
}

// Folders dropped onto the page are walked with the entry API; the entries must be taken before any await.
async function dropped(data: DataTransfer) {
  const files: Picked[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((ok, fail) => (entry as FileSystemFileEntry).file(ok, fail));
      files.push({ name: path + entry.name, file });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    for (let batch: FileSystemEntry[]; (batch = await new Promise((ok, fail) => reader.readEntries(ok, fail))).length; )
      for (const e of batch) await walk(e, `${path}${entry.name}/`);
  };
  const entries = [...data.items].map(i => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return start([...data.files].map(file => ({ name: file.name, file })));
  progress({ done: 0, total: 0, name: '' });
  await Promise.all(entries.map(e => walk(e, '')));
  start(files);
}

addEventListener('dragover', e => {
  e.preventDefault();
  document.body.classList.add('dragging');
});
addEventListener('dragleave', e => {
  if (!e.relatedTarget) document.body.classList.remove('dragging');
});
addEventListener('drop', e => {
  e.preventDefault();
  document.body.classList.remove('dragging');
  if (e.dataTransfer) dropped(e.dataTransfer).catch(err => idle((err as Error).message));
});

idle();
