// Minimal CBZ (comic book zip) writer. CBZ is a plain ZIP of page images in
// reading order. Entries are stored uncompressed (method 0) — PNGs are already
// compressed — which keeps this dependency-free: local headers, a central
// directory, and an end-of-central-directory record are all ZIP needs.
import fs from "node:fs";
import path from "node:path";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string; // path inside the archive
  data: Buffer;
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const cdir = Buffer.alloc(46);
    cdir.writeUInt32LE(0x02014b50, 0); // central directory signature
    cdir.writeUInt16LE(20, 4); // version made by
    cdir.writeUInt16LE(20, 6); // version needed
    cdir.writeUInt16LE(0x0800, 8); // flags: UTF-8 names
    cdir.writeUInt16LE(0, 10); // method: store
    cdir.writeUInt16LE(0, 12); // mod time
    cdir.writeUInt16LE(0x21, 14); // mod date
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(size, 20);
    cdir.writeUInt32LE(size, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    // extra, comment, disk, internal attrs, external attrs = 0
    cdir.writeUInt32LE(offset, 42); // local header offset

    chunks.push(local, nameBuf, entry.data);
    central.push(cdir, nameBuf);
    offset += local.length + nameBuf.length + size;
  }

  const centralStart = offset;
  const centralBuf = Buffer.concat(central);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

// Build comic.cbz from the rendered pages, cover first, zero-padded names so
// readers sort them correctly.
export function buildCbz(workDir: string, jobId: string, pageNumbers: number[]): string {
  const entries: ZipEntry[] = [];
  const push = (file: string, archiveName: string) => {
    const p = path.join(workDir, file);
    if (fs.existsSync(p)) entries.push({ name: archiveName, data: fs.readFileSync(p) });
  };

  push("cover.png", "000-cover.png");
  for (const n of pageNumbers) {
    push(`page-${n}.png`, `${String(n).padStart(3, "0")}-page.png`);
  }
  push("endcard.png", "999-end.png");

  const cbzPath = path.join(workDir, "comic.cbz");
  fs.writeFileSync(cbzPath, buildZip(entries));
  return `/comics/${jobId}/comic.cbz`;
}
