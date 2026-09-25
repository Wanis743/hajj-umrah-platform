/**
 * A zip writer, because `.docx` and `.xlsx` are zips with opinions.
 *
 * Both OOXML formats are a handful of XML parts in a zip container, so the
 * container is the only thing standing between this suite and two more export
 * formats. Every entry is stored uncompressed — method 0, STORE — which Word and
 * Excel both accept and which removes the need for a DEFLATE implementation. The
 * files this produces are a few kilobytes of XML; the compression would save
 * nothing a user would notice and cost a dependency that would weigh more than
 * every export writer put together.
 *
 * What is not optional is CRC-32. A zip with a wrong checksum is not a zip that
 * opens slowly, it is a zip that Excel refuses outright, and the table below is
 * the standard polynomial reversed, built once at module load.
 */
import { utf8 } from './document';

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** Forward-slashed, as the format requires regardless of the host. */
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A part given as text, which is what every OOXML part is. */
export const part = (path: string, xml: string): ZipEntry => ({ path, bytes: utf8(xml) });

/** A growable little-endian byte sink. The whole file is a few kilobytes. */
class Sink {
  private data = new Uint8Array(1024);
  private length = 0;

  private room(extra: number): void {
    if (this.length + extra <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + extra) size *= 2;
    const grown = new Uint8Array(size);
    grown.set(this.data.subarray(0, this.length));
    this.data = grown;
  }

  u16(value: number): void {
    this.room(2);
    this.data[this.length++] = value & 0xff;
    this.data[this.length++] = (value >>> 8) & 0xff;
  }

  u32(value: number): void {
    this.room(4);
    this.data[this.length++] = value & 0xff;
    this.data[this.length++] = (value >>> 8) & 0xff;
    this.data[this.length++] = (value >>> 16) & 0xff;
    this.data[this.length++] = (value >>> 24) & 0xff;
  }

  raw(bytes: Uint8Array): void {
    this.room(bytes.length);
    this.data.set(bytes, this.length);
    this.length += bytes.length;
  }

  get offset(): number {
    return this.length;
  }

  finish(): Uint8Array {
    return this.data.slice(0, this.length);
  }
}

/** MS-DOS packs a timestamp into two 16-bit words, with two-second precision. */
function dosStamp(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | (at.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

/** Bit 11 tells the reader the names are UTF-8 rather than code page 437. */
const UTF8_NAMES = 0x0800;

export function writeZip(entries: readonly ZipEntry[], at: Date): Uint8Array {
  const { time, date } = dosStamp(at);
  const sink = new Sink();
  const placed: { name: Uint8Array; crc: number; size: number; offset: number }[] = [];

  for (const entry of entries) {
    const name = utf8(entry.path);
    const crc = crc32(entry.bytes);
    placed.push({ name, crc, size: entry.bytes.length, offset: sink.offset });

    sink.u32(0x04034b50);
    sink.u16(20); // version needed
    sink.u16(UTF8_NAMES);
    sink.u16(0); // method: stored
    sink.u16(time);
    sink.u16(date);
    sink.u32(crc);
    sink.u32(entry.bytes.length); // compressed
    sink.u32(entry.bytes.length); // uncompressed
    sink.u16(name.length);
    sink.u16(0); // no extra field
    sink.raw(name);
    sink.raw(entry.bytes);
  }

  const directoryAt = sink.offset;
  for (const item of placed) {
    sink.u32(0x02014b50);
    sink.u16(20); // version made by
    sink.u16(20); // version needed
    sink.u16(UTF8_NAMES);
    sink.u16(0);
    sink.u16(time);
    sink.u16(date);
    sink.u32(item.crc);
    sink.u32(item.size);
    sink.u32(item.size);
    sink.u16(item.name.length);
    sink.u16(0); // extra
    sink.u16(0); // comment
    sink.u16(0); // disk
    sink.u16(0); // internal attributes
    sink.u32(0); // external attributes
    sink.u32(item.offset);
    sink.raw(item.name);
  }

  const directorySize = sink.offset - directoryAt;
  sink.u32(0x06054b50);
  sink.u16(0); // this disk
  sink.u16(0); // disk holding the directory
  sink.u16(placed.length);
  sink.u16(placed.length);
  sink.u32(directorySize);
  sink.u32(directoryAt);
  sink.u16(0); // no comment
  return sink.finish();
}

/**
 * XML text escaping, which both OOXML writers need and neither should repeat.
 *
 * Control characters are dropped rather than escaped: XML 1.0 has no way to
 * represent them, and a stray NUL inside a supplier name is the difference
 * between a file Excel opens and one it calls corrupt.
 */
export const xml = (text: string): string =>
  text
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
