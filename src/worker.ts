// Reads and checks demos off the main thread. Keeps the last run, so the mode can change without rereading.

import { checkRun, demoNumber, type Input, type Mode, type Report } from './check.ts';
import { parseDemo } from './demo.ts';
import { extract, unzip } from './archive.ts';
import sevenZip from '7z-wasm/7zz.wasm?url';

export type Request = { files: { name: string; file: File }[] } | { mode: Mode };
export type Progress = { text: string; done: number; total: number };
export type Reply = { progress: Progress } | { report: Report } | { error: string };

type Source = { name: string; size: number; read(): Promise<Uint8Array<ArrayBuffer>> };

const post = (reply: Reply) => postMessage(reply);
let inputs: Input[] = [];

onmessage = async ({ data }: MessageEvent<Request>) => {
  try {
    if ('files' in data) inputs = await read(data.files);
    post({ report: checkRun(inputs, 'mode' in data ? { mode: data.mode } : {}) });
  } catch (e) {
    post({ error: (e as Error).message });
  }
};

async function read(files: { name: string; file: File }[]): Promise<Input[]> {
  const sources: Source[] = [];
  const other: string[] = [];
  for (const { name, file } of files) {
    if (/\.dem$/i.test(name)) sources.push({ name, size: file.size, read: async () => new Uint8Array(await file.arrayBuffer()) });
    else if (/\.(zip|7z|rar)$/i.test(name)) {
      post({ progress: { text: `Opening ${name.split('/').pop()}`, done: 0, total: 0 } });
      const entries = /\.zip$/i.test(name) ? await unzip(file) : await extract(file, name, sevenZip);
      sources.push(...entries.filter(e => /\.dem$/i.test(e.name) && !e.name.startsWith('__MACOSX/')));
    }
    else other.push(name);
  }
  if (!sources.length) {
    const archive = other.find(n => /\.(tar|gz|tgz|bz2|xz|zst)$/i.test(n));
    throw new Error(archive
      ? `Preflight can't open ${archive.split('/').pop()}. Extract it and drop the folder instead.`
      : 'No demos found. Drop .dem files, a folder with them, or a .zip, .7z or .rar.');
  }

  // Shorten "runs/any%/run_1.dem" to "run_1.dem" when all demos share the folder.
  const folders = sources.map(s => s.name.split('/').slice(0, -1));
  let shared = 0;
  while (folders.every(f => f.length > shared && f[shared] === folders[0][shared])) shared++;
  for (const s of sources) s.name = s.name.split('/').slice(shared).join('/');

  // Only demos that share a number need a hash, to tell a copy from a conflict.
  const numbers = sources.map(s => demoNumber(s.name)?.n);
  const repeated = new Set(numbers.filter((n, i) => n !== undefined && numbers.indexOf(n) !== i));

  const inputs: Input[] = [];
  for (const [i, s] of sources.entries()) {
    post({ progress: { text: `Reading ${s.name}`, done: i, total: sources.length } });
    try {
      const bytes = await s.read();
      const hash = repeated.has(numbers[i]!) ? hex(await crypto.subtle.digest('SHA-256', bytes)) : undefined;
      inputs.push({ name: s.name, demo: parseDemo(bytes), ...(hash && { hash }) });
    } catch (e) {
      inputs.push({ name: s.name, demo: { ...parseDemo(new Uint8Array()), error: (e as Error).message } });
    }
  }
  return inputs;
}

const hex = (buffer: ArrayBuffer) => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
