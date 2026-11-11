// Reads zip files with the browser's own inflate, one entry at a time.

export type Entry = { name: string; size: number; read(): Promise<Uint8Array<ArrayBuffer>> };

export async function unzip(zip: Blob): Promise<Entry[]> {
  const tail = await bytes(zip.slice(Math.max(0, zip.size - 65_557)));
  const view = new DataView(tail.buffer);
  let end = tail.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('This isn\'t a zip file, or it\'s damaged.');

  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const offset = view.getUint32(end + 16, true);
  if (offset === 0xffffffff || count === 0xffff) throw new Error('This zip is too large to open. Extract it and drop the folder instead.');

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
        if (flags & 1) throw new Error(`${name} is encrypted. Extract the zip and drop the folder instead.`);
        if (method !== 0 && method !== 8) throw new Error(`${name} uses a compression Preflight can't read. Extract the zip and drop the folder instead.`);
        const header = new DataView((await bytes(zip.slice(local, local + 30))).buffer);
        const start = local + 30 + header.getUint16(26, true) + header.getUint16(28, true);
        const data = zip.slice(start, start + packed);
        return method === 0 ? bytes(data) : bytes(await new Response(data.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob());
      },
    });
  }
  return entries;
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
