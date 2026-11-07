/** Enough of SQLite's file format to read a table start to end. GeoPackages are
 * SQLite files, and walking their pages needs no database engine on the device.
 * The file is untrusted: anything out of bounds throws, and a page that loops back
 * on itself is refused. */
const decoders: Record<number, TextDecoder> = {
  1: new TextDecoder("utf-8"),
  2: new TextDecoder("utf-16le"),
  3: new TextDecoder("utf-16be"),
};
export type SqlValue = null | number | bigint | string | Uint8Array;
export interface SqlTable { name: string; rootPage: number }
export interface SqlRow { rowid: number; values: SqlValue[] }

export const isSqlite = (bytes: Uint8Array) =>
  new TextDecoder().decode(bytes.subarray(0, 16)) === "SQLite format 3\0";

export class SqliteFile {
  private view: DataView;
  private pageSize: number;
  private usable: number;
  private decoder: TextDecoder;
  constructor(private bytes: Uint8Array) {
    if (!isSqlite(bytes) || bytes.length < 100) throw new RangeError("Not a SQLite file");
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const size = this.view.getUint16(16);
    this.pageSize = size === 1 ? 65536 : size;
    this.usable = this.pageSize - bytes[20]!;
    const decoder = decoders[this.view.getUint32(56)];
    if (!decoder || this.usable < 480) throw new RangeError("Unsupported SQLite file");
    this.decoder = decoder;
  }
  tables(): SqlTable[] {
    const tables: SqlTable[] = [];
    // sqlite_master starts on the first page: type, name, tbl_name, rootpage, sql.
    for (const { values: [type, name, , rootPage] } of this.rows(1))
      if (type === "table" && typeof name === "string" && typeof rootPage === "number") tables.push({ name, rootPage });
    return tables;
  }
  /** Each row's stored columns. An INTEGER PRIMARY KEY column is stored as null: it is the rowid. */
  rows(rootPage: number): Generator<SqlRow> {
    return this.walk(rootPage, new Set());
  }
  private *walk(page: number, seen: Set<number>): Generator<SqlRow> {
    if (page < 1 || seen.has(page)) throw new RangeError("Bad SQLite page");
    seen.add(page);
    const start = (page - 1) * this.pageSize, header = page === 1 ? start + 100 : start;
    const kind = this.bytes[header];
    const count = this.view.getUint16(header + 3);
    if (kind === 0x05) {
      for (let i = 0; i < count; i++) {
        const cell = start + this.view.getUint16(header + 12 + i * 2);
        yield* this.walk(this.view.getUint32(cell), seen);
      }
      yield* this.walk(this.view.getUint32(header + 8), seen);
    } else if (kind === 0x0d) {
      for (let i = 0; i < count; i++) yield this.cell(start + this.view.getUint16(header + 8 + i * 2));
    } else throw new RangeError("Unsupported SQLite page");
  }
  /** A varint and the offset just past it. */
  private varint(offset: number): [number, number] {
    let value = 0;
    for (let i = 0; i < 9; i++) {
      const byte = this.at(offset + i);
      if (i === 8) return [value * 256 + byte, offset + 9];
      value = value * 128 + (byte & 0x7f);
      if (byte < 0x80) return [value, offset + i + 1];
    }
    throw new RangeError("Bad varint");
  }
  private at(offset: number) {
    const byte = this.bytes[offset];
    if (byte === undefined) throw new RangeError("Truncated SQLite file");
    return byte;
  }
  /** A table leaf cell, its record gathered from overflow pages if it spills. */
  private cell(cell: number): SqlRow {
    const [size, afterSize] = this.varint(cell);
    const [rowid, body] = this.varint(afterSize);
    return { rowid, values: this.record(this.payload(body, size)) };
  }
  private payload(body: number, size: number) {
    const most = this.usable - 35;
    if (size <= most) return this.slice(body, size);
    const least = Math.floor(((this.usable - 12) * 32) / 255) - 23;
    const spilled = least + ((size - least) % (this.usable - 4));
    const local = spilled <= most ? spilled : least;
    if (size > this.bytes.length) throw new RangeError("Bad SQLite record");
    const out = new Uint8Array(size);
    out.set(this.slice(body, local));
    let filled = local, page = this.view.getUint32(body + local);
    const seen = new Set<number>();
    while (filled < size) {
      if (page < 1 || seen.has(page)) throw new RangeError("Bad overflow page");
      seen.add(page);
      const start = (page - 1) * this.pageSize, part = Math.min(size - filled, this.usable - 4);
      out.set(this.slice(start + 4, part), filled);
      filled += part;
      page = this.view.getUint32(start);
    }
    return out;
  }
  private slice(offset: number, length: number) {
    if (offset < 0 || offset + length > this.bytes.length) throw new RangeError("Truncated SQLite file");
    return this.bytes.subarray(offset, offset + length);
  }
  private record(data: Uint8Array): SqlValue[] {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const varint = (offset: number): [number, number] => {
      let value = 0;
      for (let i = 0; i < 9; i++) {
        const byte = view.getUint8(offset + i);
        if (i === 8) return [value * 256 + byte, offset + 9];
        value = value * 128 + (byte & 0x7f);
        if (byte < 0x80) return [value, offset + i + 1];
      }
      throw new RangeError("Bad varint");
    };
    const [headerSize, first] = varint(0);
    const values: SqlValue[] = [];
    let cursor = first, body = headerSize;
    while (cursor < headerSize) {
      const [type, next] = varint(cursor);
      cursor = next;
      if (type === 0) values.push(null);
      else if (type <= 6) {
        const length = [0, 1, 2, 3, 4, 6, 8][type]!;
        let value = view.getInt8(body) < 0 ? -1n : 0n;
        for (let i = 0; i < length; i++) value = (value << 8n) | BigInt(view.getUint8(body + i));
        const small = BigInt.asIntN(64, value);
        values.push(small >= BigInt(Number.MIN_SAFE_INTEGER) && small <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(small) : small);
        body += length;
      } else if (type === 7) {
        values.push(view.getFloat64(body));
        body += 8;
      } else if (type === 8 || type === 9) values.push(type - 8);
      else if (type >= 12) {
        const length = Math.floor((type - 12) / 2);
        if (body + length > data.length) throw new RangeError("Truncated SQLite record");
        const part = data.subarray(body, body + length);
        values.push(type % 2 ? this.decoder.decode(part) : part);
        body += length;
      } else throw new RangeError("Bad SQLite column");
    }
    return values;
  }
}
