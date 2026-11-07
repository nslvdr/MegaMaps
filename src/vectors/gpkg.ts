import { t } from "../i18n";
import { linesToMercator, type Crs, type RawLines } from "./layer";
import { SqliteFile, type SqlTable } from "./sqlite";

/** Each ISO WKB type's coordinates after its dimension: 1000 Z, 2000 M, 3000 ZM. */
function wkbLines(view: DataView, start: number, out: RawLines): number {
  let offset = start;
  const little = view.getUint8(offset) === 1;
  const code = view.getUint32(offset + 1, little);
  offset += 5;
  const kind = code % 1000, dimension = Math.floor(code / 1000);
  if (dimension > 3) throw new RangeError("Unsupported WKB geometry");
  const stride = (2 + (dimension === 1 || dimension === 2 ? 1 : dimension === 3 ? 2 : 0)) * 8;
  const count = () => {
    const value = view.getUint32(offset, little);
    offset += 4;
    return value;
  };
  const line = () => {
    const points = count();
    if (offset + points * stride > view.byteLength) throw new RangeError("Truncated WKB geometry");
    const coordinates = new Array<number>(points * 2);
    for (let i = 0; i < points; i++, offset += stride) {
      coordinates[i * 2] = view.getFloat64(offset, little);
      coordinates[i * 2 + 1] = view.getFloat64(offset + 8, little);
    }
    if (points > 1) out.push(coordinates);
  };
  switch (kind) {
    case 1:
      return offset + stride;
    case 2:
      line();
      return offset;
    case 3:
      for (let rings = count(); rings > 0; rings--) line();
      return offset;
    case 4: case 5: case 6: case 7:
      for (let parts = count(); parts > 0; parts--) offset = wkbLines(view, offset, out);
      return offset;
    default:
      throw new RangeError("Unsupported WKB geometry");
  }
}
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];
/** A GeoPackage geometry: "GP", its flags and size of envelope, then standard WKB. */
function geometryLines(blob: Uint8Array, out: RawLines) {
  const flags = blob[3]!;
  if (flags & 0x10) return; // Empty.
  const envelope = ENVELOPE_BYTES[(flags >> 1) & 7];
  if (envelope === undefined) throw new RangeError("Bad GeoPackage envelope");
  wkbLines(new DataView(blob.buffer, blob.byteOffset, blob.byteLength), 8 + envelope, out);
}
const isGeometry = (value: unknown): value is Uint8Array =>
  value instanceof Uint8Array && value.length > 8 && value[0] === 0x47 && value[1] === 0x50;

function crsOf(organization: string, code: number): Crs | undefined {
  if (organization.toUpperCase() !== "EPSG") return undefined;
  return code === 4326 ? "lonlat" : code === 3857 || code === 3785 || code === 900913 ? "mercator" : undefined;
}
/** All the lines in a GeoPackage's feature tables, in Web Mercator. */
export function readGeoPackage(bytes: Uint8Array) {
  const out: number[][] = [];
  let unreadable: string | undefined, sawFeatures = false;
  try {
    const file = new SqliteFile(bytes), tables = new Map(file.tables().map((table): [string, SqlTable] => [table.name, table]));
    const system = (name: string) => {
      const table = tables.get(name);
      if (!table) throw new Error(t("Choose a GeoPackage (.gpkg) or GeoJSON file."));
      return [...file.rows(table.rootPage)];
    };
    // Columns by the order the GeoPackage standard fixes for these tables.
    const systems = new Map(system("gpkg_spatial_ref_sys").map(({ rowid, values }) => [values[1] ?? rowid, values]));
    for (const { values: [name, , , srs] } of system("gpkg_geometry_columns")) {
      const table = typeof name === "string" ? tables.get(name) : undefined;
      if (!table) continue;
      sawFeatures = true;
      const reference = systems.get(srs ?? -1);
      const crs = crsOf(String(reference?.[2] ?? ""), Number(reference?.[3]));
      const lines: RawLines = [];
      for (const { values } of file.rows(table.rootPage)) {
        const geometry = values.find(isGeometry);
        if (geometry) geometryLines(geometry, lines);
      }
      if (!lines.length) continue;
      if (!crs) {
        unreadable = reference ? `${reference[2]}:${reference[3]}` : String(srs);
        continue;
      }
      out.push(...linesToMercator(lines, crs));
    }
  } catch (error) {
    if (error instanceof RangeError) throw new Error(t("This GeoPackage could not be read. Save it again from QGIS and try again."));
    throw error;
  }
  if (!sawFeatures) throw new Error(t("This file has no lines to draw."));
  if (!out.length && unreadable)
    throw new Error(t("This file uses the coordinate system {system}. Export it in WGS 84 or Web Mercator from QGIS.", { system: unreadable }));
  return out;
}
