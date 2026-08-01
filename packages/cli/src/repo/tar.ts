/**
 * Minimal streaming tar reader (ustar + GNU/pax long-name extensions).
 *
 * Reading the archive in-process rather than shelling out to `tar -xzf -` buys three things this
 * phase needs and a subprocess cannot give:
 *
 * 1. **Validate before writing.** Every entry's path *and* link target are inspected before anything
 *    touches the filesystem, so an archive-escape attempt is rejected rather than mitigated. `tar`
 *    flavors disagree here (bsdtar warns-and-skips where GNU tar errors), and dev is bsdtar while CI
 *    is GNU tar.
 * 2. **A real decompressed-byte count.** Bytes piped into a `tar` subprocess are still gzipped, so the
 *    size cap could only ever be enforced against the compressed stream.
 * 3. **One pass.** The import index is built from the bytes as they stream past. With `tar` doing the
 *    writing, indexing would mean re-reading every file back off disk.
 */

/** Thrown when the decompressed stream exceeds the caller's byte ceiling. */
export class TarSizeCapError extends Error {
  constructor(maxBytes: number) {
    super(`archive exceeds the ${maxBytes}-byte decompressed size cap`);
    this.name = 'TarSizeCapError';
  }
}

export type TarEntryType = 'file' | 'directory' | 'symlink' | 'hardlink' | 'other';

export type TarEntry = {
  /** Path exactly as recorded in the archive, before any component stripping. */
  path: string;
  type: TarEntryType;
  /** Link target for `symlink`/`hardlink` entries; `''` otherwise. */
  linkName: string;
  /** File contents. Empty for every non-`file` type. */
  bytes: Uint8Array;
};

const BLOCK_SIZE = 512;

/** Reads exact byte counts out of a stream, enforcing a running ceiling as it goes. */
class ByteReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array[] = [];
  private pendingLength = 0;
  private streamDone = false;
  private consumed = 0;

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly maxBytes: number,
  ) {
    this.reader = stream.getReader();
  }

  /** Exactly `n` bytes, or `null` at a clean end of stream. Throws if the stream ends mid-read. */
  async read(n: number): Promise<Uint8Array | null> {
    while (this.pendingLength < n && !this.streamDone) {
      const { done, value } = await this.reader.read();
      if (done) {
        this.streamDone = true;
        break;
      }
      if (value && value.byteLength > 0) {
        this.pending.push(value);
        this.pendingLength += value.byteLength;
        this.consumed += value.byteLength;
        if (this.consumed > this.maxBytes) throw new TarSizeCapError(this.maxBytes);
      }
    }
    if (this.pendingLength === 0 && this.streamDone) return null;
    if (this.pendingLength < n) throw new Error(`truncated archive: wanted ${n} bytes, have ${this.pendingLength}`);

    const out = new Uint8Array(n);
    let offset = 0;
    while (offset < n) {
      const chunk = this.pending[0]!;
      const take = Math.min(chunk.byteLength, n - offset);
      out.set(chunk.subarray(0, take), offset);
      offset += take;
      if (take === chunk.byteLength) this.pending.shift();
      else this.pending[0] = chunk.subarray(take);
    }
    this.pendingLength -= n;
    return out;
  }

  async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      // the consumer is already unwinding; a failed cancel must not mask the original error
    }
  }
}

function cstr(buf: Uint8Array, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  let end = slice.indexOf(0);
  if (end === -1) end = slice.length;
  return new TextDecoder().decode(slice.subarray(0, end));
}

function octal(buf: Uint8Array, start: number, length: number): number {
  const field = buf.subarray(start, start + length);
  // GNU base-256 encoding for values that don't fit in the octal field (files > 8 GB).
  if (field.length > 0 && (field[0]! & 0x80) !== 0) {
    let value = field[0]! & 0x7f;
    for (let i = 1; i < field.length; i++) value = value * 256 + field[i]!;
    return value;
  }
  const text = new TextDecoder().decode(field).replace(/\0/g, '').trim();
  if (text === '') return 0;
  const parsed = parseInt(text, 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

/**
 * Verify the header checksum: the sum of all header bytes with the checksum field itself read as
 * spaces. Historic writers disagreed on signed vs unsigned bytes, so either match is accepted. A
 * mismatch means this is not a tar header, which surfaces as a clean extract failure instead of an
 * endless stream of nonsense entries.
 */
function checksumMatches(block: Uint8Array): boolean {
  const expected = octal(block, 148, 8);
  let unsigned = 0;
  let signed = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const byte = i >= 148 && i < 156 ? 0x20 : block[i]!;
    unsigned += byte;
    signed += byte > 127 ? byte - 256 : byte;
  }
  return expected === unsigned || expected === signed;
}

function entryTypeOf(typeflag: string): TarEntryType {
  switch (typeflag) {
    case '0':
    case '\0':
    case '7': // contiguous file — treat as regular
      return 'file';
    case '5':
      return 'directory';
    case '2':
      return 'symlink';
    case '1':
      return 'hardlink';
    default:
      return 'other';
  }
}

const SPACE_BYTE = 0x20;

/**
 * Parse a pax extended-header payload into its records.
 *
 * Records are `"<length> <key>=<value>\n"` and `<length>` counts **bytes**, so the scan walks the raw
 * payload rather than a decoded string: one non-ASCII byte anywhere (an accented filename, a CJK path)
 * makes character offsets and byte offsets disagree, which would desynchronize every following record
 * and truncate the `path` value it is here to read.
 */
function parsePaxRecords(payload: Uint8Array): Map<string, string> {
  const decoder = new TextDecoder();
  const records = new Map<string, string>();
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(SPACE_BYTE, offset);
    if (space === -1) break;
    const length = parseInt(decoder.decode(payload.subarray(offset, space)), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const end = Math.min(offset + length, payload.length);
    if (end <= space) break;
    // Trailing newline is part of the record's byte count; drop it before splitting on `=`.
    const bodyEnd = payload[end - 1] === 0x0a ? end - 1 : end;
    const record = decoder.decode(payload.subarray(space + 1, bodyEnd));
    const eq = record.indexOf('=');
    if (eq > 0) records.set(record.slice(0, eq), record.slice(eq + 1));
    offset = end;
  }
  return records;
}

/**
 * Yield every entry in a tar stream, in archive order, with file contents attached.
 *
 * `maxBytes` bounds the *decompressed* stream: pass the already-gunzipped stream and the reader throws
 * {@link TarSizeCapError} the moment the running total crosses it, so an oversized archive costs a
 * partial download rather than a full one.
 */
export async function* readTarEntries(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): AsyncGenerator<TarEntry, void, undefined> {
  const reader = new ByteReader(stream, maxBytes);
  // Long name/link overrides supplied by a preceding GNU 'L'/'K' or pax 'x' header.
  let overridePath: string | undefined;
  let overrideLinkName: string | undefined;

  try {
    while (true) {
      const header = await reader.read(BLOCK_SIZE);
      if (header === null) return;
      if (isZeroBlock(header)) return; // end-of-archive marker
      if (!checksumMatches(header)) throw new Error('invalid tar header checksum (not a tar stream?)');

      const size = octal(header, 124, 12);
      const typeflag = String.fromCharCode(header[156]!);
      const padded = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
      const payload = padded > 0 ? await reader.read(padded) : new Uint8Array(0);
      if (payload === null) throw new Error('truncated archive: entry payload missing');
      const body = payload.subarray(0, size);

      if (typeflag === 'L') {
        overridePath = cstr(body, 0, body.length);
        continue;
      }
      if (typeflag === 'K') {
        overrideLinkName = cstr(body, 0, body.length);
        continue;
      }
      if (typeflag === 'x' || typeflag === 'X') {
        const records = parsePaxRecords(body);
        overridePath = records.get('path') ?? overridePath;
        overrideLinkName = records.get('linkpath') ?? overrideLinkName;
        continue;
      }
      if (typeflag === 'g') continue; // global pax header — nothing here needs it

      const name = cstr(header, 0, 100);
      const prefix = cstr(header, 345, 155);
      const path = overridePath ?? (prefix ? `${prefix}/${name}` : name);
      const linkName = overrideLinkName ?? cstr(header, 157, 100);
      overridePath = undefined;
      overrideLinkName = undefined;

      const type = entryTypeOf(typeflag);
      yield { path, type, linkName, bytes: type === 'file' ? body : new Uint8Array(0) };
    }
  } finally {
    await reader.cancel();
  }
}
