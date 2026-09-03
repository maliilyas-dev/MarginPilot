/**
 * Streaming CSV parsing (spec 5.4 / 21). Never buffers an unbounded file into
 * memory: rows are consumed via an async iterator and the caller batches them
 * into the database.
 */
import { parse } from "csv-parse";
import { Readable } from "node:stream";

export type DelimiterChoice = "auto" | "comma" | "semicolon" | "tab" | "pipe";

const DELIMS: Record<Exclude<DelimiterChoice, "auto">, string> = {
  comma: ",",
  semicolon: ";",
  tab: "\t",
  pipe: "|",
};

/** Sniff a delimiter from the first line by counting candidates. */
export function detectDelimiter(firstLine: string): string {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestCount = -1;
  for (const c of candidates) {
    const count = firstLine.split(c).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = c;
    }
  }
  return best;
}

export function resolveDelimiter(choice: DelimiterChoice, firstLine: string): string {
  if (choice === "auto") return detectDelimiter(firstLine);
  return DELIMS[choice];
}

export interface CsvParseOptions {
  delimiter: DelimiterChoice;
  maxRows: number;
  maxBytes: number;
}

export interface CsvParseResult {
  headers: string[];
  /** async generator of records keyed by header */
  rows: AsyncGenerator<Record<string, string>>;
}

/**
 * Parse a CSV from a Node Readable (file stream or fetched body). Enforces byte
 * and row caps. Throws on malformed CSV or when a cap is exceeded.
 */
export async function parseCsvStream(
  source: Readable,
  opts: CsvParseOptions,
): Promise<CsvParseResult> {
  // Peek the first chunk to sniff the delimiter without consuming the stream.
  let byteCount = 0;
  const capStream = new Readable({
    read() {
      /* pushed manually below */
    },
  });

  let firstLine = "";
  let sawFirstLine = false;

  source.on("data", (chunk: Buffer) => {
    byteCount += chunk.length;
    if (byteCount > opts.maxBytes) {
      const err = new Error("FEED_TOO_LARGE");
      capStream.destroy(err);
      source.destroy(err);
      return;
    }
    if (!sawFirstLine) {
      const text = chunk.toString("utf8");
      const nl = text.indexOf("\n");
      if (nl >= 0) {
        firstLine += text.slice(0, nl);
        sawFirstLine = true;
      } else {
        firstLine += text;
      }
    }
    capStream.push(chunk);
  });
  source.on("end", () => capStream.push(null));
  source.on("error", (e) => capStream.destroy(e));

  // Give the first chunk a tick to arrive so detectDelimiter has data.
  await new Promise((r) => setImmediate(r));
  const delimiter = resolveDelimiter(opts.delimiter, firstLine || "");

  const parser = capStream.pipe(
    parse({
      bom: true,
      columns: (header: string[]) => header.map((h) => h.trim()),
      delimiter,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      max_record_size: 1_000_000,
    }),
  );

  let headers: string[] = [];
  parser.on("readable", () => {
    /* consumed via async iterator */
  });

  async function* rowGen(): AsyncGenerator<Record<string, string>> {
    let count = 0;
    for await (const record of parser as AsyncIterable<Record<string, string>>) {
      if (headers.length === 0) headers = Object.keys(record);
      count += 1;
      if (count > opts.maxRows) {
        throw new Error("FEED_TOO_MANY_ROWS");
      }
      yield record;
    }
  }

  // csv-parse exposes column info after the first record; to give callers
  // headers up-front we read one record eagerly and re-yield it.
  const gen = rowGen();
  const first = await gen.next();

  async function* wrapped(): AsyncGenerator<Record<string, string>> {
    if (!first.done && first.value) {
      headers = headers.length ? headers : Object.keys(first.value);
      yield first.value;
    }
    yield* gen;
  }

  return { headers, rows: wrapped() };
}

/** Helper for tests / small inputs: parse a string fully into records. */
export async function parseCsvString(
  csv: string,
  opts: CsvParseOptions,
): Promise<{ headers: string[]; records: Record<string, string>[] }> {
  const stream = Readable.from([Buffer.from(csv, "utf8")]);
  const { headers, rows } = await parseCsvStream(stream, opts);
  const records: Record<string, string>[] = [];
  for await (const r of rows) records.push(r);
  return { headers: headers.length ? headers : Object.keys(records[0] ?? {}), records };
}
