// Opens archives: zip with the browser's own inflate, .7z and .rar with 7-Zip compiled to WebAssembly.

import type { SevenZipModuleFactory } from '7z-wasm';

export type Entry = { name: string; size: number; read(): Promise<Uint8Array<ArrayBuffer>> };

export async function unzip(zip: Blob): Promise<Entry[]> {
  const tail = await bytes(zip.slice(Math.max(0, zip.size - 65_557)));
  const view = new DataView(tail.buffer);
  let end = tail.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This isn\'t a zip, or it\'s damaged.');

  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (offset === 0xffffffff || count === 0xffff) throw new Error('This zip is too big to open here. Extract it and drop the folder.');

  const dir = await bytes(zip.slice(offset, offset + size));
  const d = new DataView(dir.buffer);
  const entries: Entry[] = [];
  for (let at = 0, i = 0; i < count; i++) {
    if (d.getUint32(at, true) !== 0x02014b50) throw new Error('This zip is damaged.');
    const flags = d.getUint16(at + 8, true);
    const method = d.getUint16(at + 10, true);
    const packed = d.getUint32(at + 20, true);
    const size = d.getUint32(at + 24, true);
    const nameLength = d.getUint16(at + 28, true);
    const local = d.getUint32(at + 42, true);
    const raw = dir.subarray(at + 46, at + 46 + nameLength);
    const name = new TextDecoder().decode(raw);
    at += 46 + nameLength + d.getUint16(at + 30, true) + d.getUint16(at + 32, true);

    if (name.endsWith('/')) continue;
    entries.push({
      name,
      size,
      async read() {
        if (flags & 1) throw new Error(`${name} has a password. Extract the zip and drop the folder.`);
        if (method !== 0 && method !== 8) throw new Error(`${name} uses an unusual compression. Extract the zip and drop the folder.`);
        const header = new DataView((await bytes(zip.slice(local, local + 30))).buffer);
        const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const data = zip.slice(start, start + packed);
        return method === 0 ? bytes(data) : bytes(await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob());
      },
    });
  }
  return entries;
}

/** Extracts a .7z or .rar. 7-Zip loads only when needed; `wasm` is its file's URL, where it isn't next to the module. */
export async function extract(archive: Blob, name: string, wasm?: string): Promise<Entry[]> {
  // Its types say CommonJS, but both builds export the factory as default.
  const SevenZip = (await import('7z-wasm')).default as unknown as SevenZipModuleFactory;
  const errors: string[] = [];
  // A fresh instance each time: 7-Zip's state doesn't survive a run.
  const sz = await SevenZip({ print: () => {}, printErr: e => errors.push(e), ...(wasm && { locateFile: () => wasm }) });
  sz.FS.writeFile('/archive', await bytes(archive));
  sz.FS.mkdir('/x');
  // An empty password makes encrypted archives fail at once instead of asking for one.
  sz.callMain(['x', '/archive', '-o/x', '-y', '-p', '-bso0', '-bsp0']);

  const entries: Entry[] = [];
  const walk = (dir: string) => {
    for (const n of sz.FS.readdir(dir)) {
      if (n === '.' || n === '..') continue;
      const path = `${dir}/${n}`;
      const stat = sz.FS.stat(path);
      if (sz.FS.isDir(stat.mode)) walk(path);
      else entries.push({ name: path.slice(3), size: stat.size, read: async () => sz.FS.readFile(path) as Uint8Array<ArrayBuffer> });
    }
  };
  walk('/x');
  if (!entries.length && errors.some(e => e.includes('Wrong password'))) throw new Error(`${name} has a password. Extract it and drop the folder.`);
  if (!entries.length && errors.length) throw new Error(`Can't open ${name}. It may be damaged.`);
  return entries;
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
