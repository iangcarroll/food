// Streaming CSV parsing for the large LA / Las Vegas files. The parser follows
// Python's csv module defaults: a quote opens a quoted field only at the start of
// a field, "" inside quotes is a literal quote, and \r\n or \n ends a record.

// windows-1252 bytes 0x80-0x9F; every other byte maps to the same code point (latin-1).
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd,
  0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
  0x0153, 0xfffd, 0x017e, 0x0178,
];

export function decodeCp1252(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const buf = new Uint16Array(Math.min(CHUNK, bytes.length));
  let out = "";
  for (let off = 0; off < bytes.length; off += CHUNK) {
    const end = Math.min(off + CHUNK, bytes.length);
    for (let i = off; i < end; i++) {
      const b = bytes[i];
      buf[i - off] = b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] : b;
    }
    out += String.fromCharCode.apply(null, buf.subarray(0, end - off) as unknown as number[]);
  }
  return out;
}

class CsvTokenizer {
  private field = "";
  private row: string[] = [];
  private inQuotes = false;
  private atFieldStart = true;
  private pendingQuote = false; // saw a quote inside a quoted field; next char decides
  private pendingCR = false;

  constructor(private readonly delim: string) {}

  /** Feed text; returns completed rows. */
  push(text: string): string[][] {
    const rows: string[][] = [];
    const d = this.delim;
    let field = this.field;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (this.pendingCR) {
        this.pendingCR = false;
        if (c === "\n") continue;
      }
      if (this.inQuotes) {
        if (this.pendingQuote) {
          this.pendingQuote = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          this.inQuotes = false; // closing quote; fall through to unquoted handling
        } else if (c === '"') {
          this.pendingQuote = true;
          continue;
        } else {
          field += c;
          continue;
        }
      }
      if (c === d) {
        this.row.push(field);
        field = "";
        this.atFieldStart = true;
      } else if (c === "\n" || c === "\r") {
        this.row.push(field);
        field = "";
        rows.push(this.row);
        this.row = [];
        this.atFieldStart = true;
        if (c === "\r") this.pendingCR = true;
      } else if (c === '"' && this.atFieldStart) {
        this.inQuotes = true;
        this.atFieldStart = false;
      } else {
        field += c;
        this.atFieldStart = false;
      }
    }
    this.field = field;
    return rows;
  }

  end(): string[][] {
    if (this.pendingQuote) this.inQuotes = false;
    if (this.field !== "" || this.row.length) {
      this.row.push(this.field);
      const r = [this.row];
      this.row = [];
      this.field = "";
      return r;
    }
    return [];
  }
}

/** Iterate a cp1252 CSV byte stream as header-keyed records. */
export async function* csvRecords(
  stream: ReadableStream<Uint8Array>,
  delim = ",",
): AsyncGenerator<Record<string, string>> {
  const tok = new CsvTokenizer(delim);
  let header: string[] | null = null;
  const emit = function* (rows: string[][]) {
    for (const r of rows) {
      if (!header) {
        header = r.map((h) => h.trim());
        continue;
      }
      if (r.length === 1 && r[0] === "") continue; // blank line
      const rec: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) rec[header[i]] = r[i] ?? "";
      yield rec;
    }
  };
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    yield* emit(tok.push(decodeCp1252(value)));
  }
  yield* emit(tok.end());
}

export const bytesStream = (b: Uint8Array): ReadableStream<Uint8Array> => new Response(b).body!;
