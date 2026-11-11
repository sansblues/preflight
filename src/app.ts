import { clock, formatTime, Kinds, recorded, title, type Finding, type Report, type Where } from './check.ts';
import type { Progress, Reply, Request } from './worker.ts';

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
  progress({ text: 'Opening files', done: 0, total: 0 });
}

const send = (request: Request) => worker!.postMessage(request);

// The λ in Half-Life orange, drawn as two strokes.
const Lambda = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3.5h3l10.5 17M12.4 10.6L5.5 20.5" fill="none" stroke="#f68c1e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const Title = 'Review your Half-Life run';

function mark() {
  const span = h('span', { class: 'mark' });
  span.innerHTML = Lambda;
  return span;
}

function idle(error?: string) {
  const pick = (folder: boolean) => {
    const input = h('input', { type: 'file', multiple: true, ...(folder ? { webkitdirectory: true } : { accept: '.dem,.zip,.7z,.rar' }) }) as HTMLInputElement;
    input.onchange = () => start([...input.files!].map(file => ({ name: file.webkitRelativePath || file.name, file })));
    input.click();
  };
  render(
    h('h1', { class: 'title' }, mark(), Title),
    h('p', { class: 'lede' }, 'Catch what the moderators look for before you submit. Your demos stay on your computer.'),
    h('section', { class: 'drop' },
      h('p', { class: 'drop-title' }, 'Drop your demos here'),
      h('p', {}, 'Files, a folder, or a .zip, .7z or .rar'),
      h('div', { class: 'actions' },
        h('button', { class: 'primary', click: () => pick(false) }, 'Choose files'),
        h('button', { click: () => pick(true) }, 'Choose folder'))),
    error && h('p', { class: 'error', role: 'alert' }, error),
  );
}

function progress({ text, done, total }: Progress) {
  render(
    bar(false),
    h('section', { class: 'progress', 'aria-live': 'polite' },
      h('p', {}, text),
      h('progress', total ? { value: String(done), max: String(total) } : {}),
      h('p', { class: 'count' }, total ? `${done} of ${total}` : '')),
  );
}

function bar(newRun: boolean) {
  return h('header', { class: 'bar' },
    h('button', { class: 'home', click: () => idle() }, mark(), Title),
    newRun && h('button', { click: () => idle() }, 'New run'));
}

const Modes = { scriptless: 'Scriptless', scripted: 'Scripted' } as const;

function report(r: Report) {
  const findings = r.findings.filter(f => f.severity !== 'info');
  const [verdict, tone] = findings.some(f => recorded(f.kind)) ? ['Invalid run', 'problem']
    : findings.some(f => f.severity === 'problem') ? ['Not ready to submit', 'problem']
    : ['Ready to submit', 'good'];
  const last = r.demos[r.demos.length - 1];
  const covers = r.individualLevel ? r.individualLevel.chapter ?? 'Individual level' : [...new Set([r.demos[0]?.map, last?.map])].filter(Boolean).join(' to ');
  const retime = r.findings.find(f => f.kind === 'blue-shift')?.subject.split(' (')[0];

  render(
    bar(true),
    h('div', { class: 'report' },
      h('h1', { class: 'verdict', 'data-severity': tone, 'aria-live': 'polite' }, verdict),
      h('div', { class: 'summary' },
        h('p', {}, [r.time && formatTime(r.time), plural(r.demos.length, 'demo'), covers, retime && `retimed ${retime}`, r.fps.highest && `${Math.round(r.fps.highest)} fps`].filter(Boolean).join(' · ')),
        h('div', { class: 'toggle', role: 'group', 'aria-label': 'Rules' }, ...(['scriptless', 'scripted'] as const).map(m =>
          h('button', { 'aria-pressed': String(r.mode === m), click: () => r.mode !== m && send({ mode: m }) }, Modes[m])))),
      cards(findings)),
  );
}

// Missing demos come as ranges; everything else counts its items.
const count = (items: Finding[]) =>
  items.reduce((n, f) => n + (f.kind === 'missing' ? Number(/\((\d+) demos\)/.exec(f.subject)?.[1] ?? 1) : 1), 0);

function cards(list: Finding[]) {
  // Problems recorded in the demos come first: they're why a run is invalid.
  const groups = [...Map.groupBy(list, f => f.kind)].sort(([a], [b]) => Number(recorded(b)) - Number(recorded(a)));
  return list.length > 0 && h('ul', { class: 'cards' }, ...groups.map(([kind, items]) =>
    h('li', { class: 'card', 'data-severity': items[0].severity },
      h('h2', {}, title(kind, count(items))),
      Kinds[kind].fix && h('p', { class: 'fix' }, Kinds[kind].fix),
      ...listed(items))));
}

// Long lists show their first few items; the rest are one click away.
function listed(items: Finding[]) {
  const item = (f: Finding) => h('li', {}, subject(f), places(f.where.filter(w => !f.subject.includes(w.demo))));
  const [first, rest] = items.length > 6 ? [items.slice(0, 5), items.slice(5)] : [items, []];
  return [
    h('ul', { class: 'items' }, ...first.map(item)),
    rest.length > 0 && h('details', { class: 'more' }, h('summary', {}, `Show ${rest.length} more`), h('ul', { class: 'items' }, ...rest.map(item))),
  ];
}

const Sentences = ['broken', 'timer-start', 'timer-jump', 'setup'];

function subject(f: Finding) {
  if (!f.subject) return null;
  return Sentences.includes(f.kind) ? h('p', { class: 'subject' }, f.subject) : h('code', {}, f.subject);
}

function places(where: Where[]) {
  if (!where.length) return null;
  // A time at the very start of a demo adds nothing.
  const place = (w: Where) => (w.time === undefined || w.time < 0.01 ? w.demo : `${w.demo} at ${clock(w.time, 2)}`);
  if (where.length === 1) return h('p', { class: 'where' }, place(where[0]));
  const demos = new Set(where.map(w => w.demo));
  return h('details', { class: 'where' },
    h('summary', {}, demos.size === 1 ? `In ${where[0].demo}` : `In ${demos.size} demos`),
    h('ul', {}, ...where.map(w => h('li', {}, place(w)))));
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
  progress({ text: 'Opening files', done: 0, total: 0 });
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
