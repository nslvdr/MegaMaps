import { t } from "../i18n";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { MAX_FILE_BYTES, MAX_PIXELS } from "../types";
import { readHeader } from "../processing/headers";
import { readOcrIndex, type OcrIndex } from "../ocr/index";
import { isDangerLevel, isWaterLevel, legacyMarkerKinds, markerKinds, normalizeMarkerKind, NORTH_MAX, NORTH_MIN, visitFromLastSeen, type MapMarker, type PlaceChange, type PlaceLogEntry, type PlannedRoute } from "../viewer/navigation";

export const SHARE_MIME = "application/octet-stream";
export const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAGIC = "MEGAMAP1";
const HEADER_BYTES = 12;
const MAX_ITEMS = 10_000;
const MAX_POINTS = 100_000;
const MAX_PHOTOS = 2_000;
const MAX_PHOTO_BYTES = 16 * 1024 * 1024;
const MAX_PHOTOS_PER_ITEM = 50;
const MAX_LOG_PER_PLACE = 500;
const MAX_OCR_BYTES = 64 * 1024 * 1024;
const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp"];
export interface SharePhoto { id: string; type: string; bytes: number }
export interface ShareManifest {
  format: "megamap";
  version: 6;
  map: { name: string; width: number; height: number; fingerprint: string };
  image?: { name: string; type: string; bytes: number };
  markers: MapMarker[];
  routes: PlannedRoute[];
  /** Place and route photos, stored in this order after the manifest and before the map image. */
  photos?: SharePhoto[];
  /** The sender's text detection as JSON, stored after the photos, so the receiver needn't scan again. */
  ocr?: { bytes: number };
  /** Where north is on the map, in degrees clockwise from its top; absent means unknown. */
  northOffset?: number;
  /** The sender's name from their settings, when they gave one. */
  from?: string;
}
export interface SharedMap {
  manifest: ShareManifest;
  image?: File;
  photos?: Map<string, Blob>;
  ocr?: Omit<OcrIndex, "mapId">;
}

/** Shared files are recognised by their header, whatever their name or picker. */
export async function isShareFile(blob: Blob) {
  return new TextDecoder().decode(await blob.slice(0, MAGIC.length).arrayBuffer()) === MAGIC;
}

/** Hash bounded chunks so a large original never becomes one in-memory buffer. */
export async function fingerprint(blob: Blob, signal?: AbortSignal) {
  const hash = sha256.create();
  try {
    for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
      signal?.throwIfAborted();
      hash.update(new Uint8Array(await blob.slice(offset, offset + 1024 * 1024).arrayBuffer()));
    }
    signal?.throwIfAborted();
    return bytesToHex(hash.digest());
  } finally {
    hash.destroy();
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const name = (value: unknown, max: number): value is string =>
  text(value, max) && !!value.trim() && !/[\u0000-\u001f]/.test(value);
const integer = (value: unknown, min: number, max: number): value is number =>
  finite(value) && Number.isSafeInteger(value) && value >= min && value <= max;
function invalid(): never {
  throw new Error(t("This MegaMaps file contains invalid map or annotation data."));
}

/** Treat shared files as untrusted; construct only the fields this version accepts. */
export function validateManifest(value: unknown): ShareManifest {
  if (!object(value) || value.format !== "megamap") invalid();
  // Version 1 predates photos and named descriptions `note`; version 2 routes have neither;
  // version 3 places have no log; up to version 4 a last seen date sat beside a log of notes;
  // version 5 has no text detection.
  if (value.version !== 1 && value.version !== 2 && value.version !== 3 && value.version !== 4 && value.version !== 5 && value.version !== 6) throw new Error(t("This sharing format is not supported. Update MegaMaps and try again."));
  const map = value.map;
  if (!object(map) || !name(map.name, 1000) ||
      !integer(map.width, 1, 32768) || !integer(map.height, 1, 32768) ||
      map.width * map.height > MAX_PIXELS ||
      typeof map.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(map.fingerprint)) invalid();
  if (!Array.isArray(value.markers) || !Array.isArray(value.routes) ||
      value.markers.length + value.routes.length > MAX_ITEMS) invalid();
  const width = map.width, height = map.height;
  const point = (value: unknown) => {
    if (!object(value) || !finite(value.x) || !finite(value.y) ||
        value.x < 0 || value.y < 0 || value.x > width || value.y > height) invalid();
    return { x: value.x, y: value.y };
  };
  const ids = new Set<string>();
  const identity = (value: Record<string, unknown>, kind: string) => {
    if (!name(value.id, 200) || !integer(value.created, 0, Number.MAX_SAFE_INTEGER)) invalid();
    const key = `${kind}:${value.id}`;
    if (ids.has(key)) invalid();
    ids.add(key);
    return { id: value.id, created: value.created };
  };
  let photos: SharePhoto[] = [];
  if (value.photos !== undefined) {
    if (!Array.isArray(value.photos) || value.photos.length > MAX_PHOTOS) invalid();
    photos = value.photos.map((input: unknown) => {
      if (!object(input) || !name(input.id, 200) || ids.has(`photo:${input.id}`) ||
          !PHOTO_TYPES.includes(String(input.type)) || !integer(input.bytes, 1, MAX_PHOTO_BYTES)) invalid();
      ids.add(`photo:${input.id}`);
      return { id: input.id, type: String(input.type), bytes: input.bytes };
    });
  }
  const unused = new Set(photos.map((photo) => photo.id));
  // Each photo belongs to exactly one place or route and must be in the file.
  const ownPhotos = (value: Record<string, unknown>) => {
    if (value.photos === undefined) return {};
    if (!Array.isArray(value.photos) || value.photos.length > MAX_PHOTOS_PER_ITEM) invalid();
    const own = value.photos.map((id: unknown) => {
      if (typeof id !== "string" || !unused.delete(id)) invalid();
      return id;
    });
    return own.length ? { photos: own } : {};
  };
  const version = value.version;
  const current = version >= 5;
  const time = (value: unknown) => integer(value, 0, Number.MAX_SAFE_INTEGER);
  const kind = (value: unknown) => typeof value === "string" &&
    ((legacyMarkerKinds as readonly string[]).includes(value) || Object.hasOwn(markerKinds, value));
  const photoIds = (value: unknown) => {
    if (!Array.isArray(value) || value.length > MAX_PHOTOS_PER_ITEM * 2 || !value.every((id) => name(id, 200))) invalid();
    return value as string[];
  };
  const level = <T>(value: unknown, valid: (value: unknown) => value is T) => {
    if (value !== undefined && !valid(value)) invalid();
    return value as T | undefined;
  };
  const change = (value: unknown): PlaceChange => {
    if (!object(value)) invalid();
    switch (value.field) {
      case "name":
        if (!name(value.from, 100) || !name(value.to, 100)) invalid();
        return { field: "name", from: value.from, to: value.to };
      case "kind":
        if (!kind(value.from) || !kind(value.to)) invalid();
        return { field: "kind", from: normalizeMarkerKind(value.from as Parameters<typeof normalizeMarkerKind>[0]),
          to: normalizeMarkerKind(value.to as Parameters<typeof normalizeMarkerKind>[0]) };
      case "water": {
        const from = level(value.from, isWaterLevel), to = level(value.to, isWaterLevel);
        return { field: "water", ...(from ? { from } : {}), ...(to ? { to } : {}) };
      }
      case "danger":
        if (!isDangerLevel(value.from) || !isDangerLevel(value.to)) invalid();
        return { field: "danger", from: value.from, to: value.to };
      case "photos":
        return { field: "photos", added: photoIds(value.added), removed: photoIds(value.removed) };
      case "description":
      case "point":
        return { field: value.field };
      default:
        invalid();
    }
  };
  // Since version 5 entries are notes, edits, or neither: visits.
  const log = (value: unknown) => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > MAX_LOG_PER_PLACE) invalid();
    const entryIds = new Set<string>();
    return value.map((entry: unknown): PlaceLogEntry => {
      if (!object(entry) || !name(entry.id, 200) || entryIds.has(entry.id) || !time(entry.date) ||
          (entry.text !== undefined && (!text(entry.text, 2000) || !entry.text.trim())) ||
          (!current && entry.text === undefined) ||
          (entry.changes !== undefined && (!current || !Array.isArray(entry.changes) ||
            !entry.changes.length || entry.changes.length > 10))) invalid();
      entryIds.add(entry.id);
      return { id: entry.id, date: entry.date, ...(typeof entry.text === "string" ? { text: entry.text } : {}),
        ...(Array.isArray(entry.changes) ? { changes: entry.changes.map(change) } : {}) };
    });
  };
  const markers = value.markers.map((value: unknown): MapMarker => {
    if (!object(value)) invalid();
    const description = version === 1 ? value.note : value.description;
    if (!name(value.label, 100) || !text(description, 2000) ||
        !kind(value.kind) ||
        (value.water !== undefined && (value.kind !== "flooded" || !isWaterLevel(value.water))) ||
        (value.danger !== undefined && (value.kind !== "unstable" || !isDangerLevel(value.danger))) ||
        (value.lastSeen !== undefined && (current || !time(value.lastSeen))) ||
        (value.seenAt !== undefined && (current || !time(value.seenAt)))) invalid();
    const place = identity(value, "marker");
    const entries = visitFromLastSeen(log(value.log), place.created, time(value.lastSeen) ? value.lastSeen : undefined);
    return { ...place, label: value.label, description,
      ...ownPhotos(value), ...(entries?.length ? { log: entries } : {}),
      kind: normalizeMarkerKind(value.kind as Parameters<typeof normalizeMarkerKind>[0]),
      ...(isWaterLevel(value.water) ? { water: value.water } : {}),
      ...(isDangerLevel(value.danger) ? { danger: value.danger } : {}), point: point(value.point) };
  });
  let points = 0;
  const routes = value.routes.map((value: unknown): PlannedRoute => {
    if (!object(value) || !name(value.name, 100) || value.draft !== false ||
        (value.description !== undefined && !text(value.description, 2000)) ||
        !Array.isArray(value.points) || value.points.length < 2) invalid();
    points += value.points.length;
    if (points > MAX_POINTS) invalid();
    return { ...identity(value, "route"), name: value.name,
      ...(value.description ? { description: value.description } : {}), ...ownPhotos(value),
      points: value.points.map(point), draft: false };
  });
  if (unused.size) invalid();
  let image: ShareManifest["image"];
  if (value.image !== undefined) {
    const input = value.image;
    if (!object(input) || !name(input.name, 1000) || /[\\/]/.test(input.name) ||
        !["image/png", "image/jpeg", "image/webp"].includes(String(input.type)) ||
        !integer(input.bytes, 1, MAX_FILE_BYTES)) invalid();
    image = { name: input.name, type: String(input.type), bytes: input.bytes };
  }
  const ocr = value.ocr;
  if (ocr !== undefined && (version !== 6 || !object(ocr) || !integer(ocr.bytes, 1, MAX_OCR_BYTES))) invalid();
  const north = value.northOffset;
  if (north !== undefined && !integer(north, NORTH_MIN, NORTH_MAX)) invalid();
  if (value.from !== undefined && !name(value.from, 100)) invalid();
  if (!image && markers.length + routes.length === 0)
    throw new Error(t("Select at least one place or route, or include the map image."));
  return { format: "megamap", version: 6,
    map: { name: map.name, width: map.width, height: map.height, fingerprint: map.fingerprint },
    ...(image ? { image } : {}), markers, routes, ...(photos.length ? { photos } : {}),
    ...(ocr ? { ocr: { bytes: ocr.bytes as number } } : {}),
    ...(north !== undefined ? { northOffset: north } : {}),
    ...(typeof value.from === "string" ? { from: value.from.trim() } : {}) };
}
const photoBytes = (manifest: ShareManifest) =>
  (manifest.photos ?? []).reduce((total, photo) => total + photo.bytes, 0);

/** A small length-prefixed JSON manifest followed by place and route photos, the optional
 * text detection and the optional original bytes. */
export function encodeShare(manifest: ShareManifest, image?: Blob, photos = new Map<string, Blob>(), ocr?: Blob) {
  const valid = validateManifest(manifest);
  if ((valid.image?.bytes ?? 0) !== (image?.size ?? 0) || (valid.ocr?.bytes ?? 0) !== (ocr?.size ?? 0)) invalid();
  const photoParts = (valid.photos ?? []).map((photo) => {
    const blob = photos.get(photo.id);
    if (blob?.size !== photo.bytes) invalid();
    return blob;
  });
  const json = new TextEncoder().encode(JSON.stringify(valid));
  if (json.byteLength > MAX_MANIFEST_BYTES)
    throw new Error(t("Too many annotations for one share. Select fewer items."));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, json.byteLength, true);
  return new Blob([header, json, ...photoParts, ...(ocr ? [ocr] : []), ...(image ? [image] : [])], { type: SHARE_MIME });
}

/** Parse metadata without loading or decoding a potentially large embedded map. */
export async function readShare(file: Blob): Promise<SharedMap> {
  if (file.size < HEADER_BYTES || file.size > HEADER_BYTES + MAX_MANIFEST_BYTES + MAX_PHOTOS * MAX_PHOTO_BYTES + MAX_OCR_BYTES + MAX_FILE_BYTES)
    throw new Error(t("This MegaMaps file is truncated or too large."));
  const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (new TextDecoder().decode(header.subarray(0, 8)) !== MAGIC)
    throw new Error(t("Choose a .megamap file exported by MegaMaps."));
  const size = new DataView(header.buffer).getUint32(8, true);
  if (!size || size > MAX_MANIFEST_BYTES || HEADER_BYTES + size > file.size) invalid();
  let value: unknown;
  try {
    value = JSON.parse(await file.slice(HEADER_BYTES, HEADER_BYTES + size).text());
  } catch {
    throw new Error(t("The annotations in this MegaMaps file could not be read."));
  }
  const manifest = validateManifest(value);
  if (file.size !== HEADER_BYTES + size + photoBytes(manifest) + (manifest.ocr?.bytes ?? 0) + (manifest.image?.bytes ?? 0))
    throw new Error(t("This MegaMaps file is incomplete or contains unexpected data."));
  let offset = HEADER_BYTES + size;
  const photos = new Map<string, Blob>();
  for (const photo of manifest.photos ?? [])
    photos.set(photo.id, file.slice(offset, offset += photo.bytes, photo.type));
  let ocr: SharedMap["ocr"];
  if (manifest.ocr) {
    try {
      ocr = readOcrIndex(JSON.parse(await file.slice(offset, offset += manifest.ocr.bytes).text()));
    } catch { /* Malformed JSON is handled below like a malformed index. */ }
    if (!ocr) invalid();
  }
  const image = manifest.image && new File([file.slice(offset)],
    manifest.image.name, { type: manifest.image.type });
  return { manifest, ...(image ? { image } : {}), photos, ...(ocr ? { ocr } : {}) };
}

/** Verify the source image before placing annotations or creating a new map. */
export async function verifyImage(image: Blob, manifest: ShareManifest, signal?: AbortSignal) {
  const header = await readHeader(image);
  if (header.width !== manifest.map.width || header.height !== manifest.map.height || header.orientation !== 1)
    throw new Error(t("The map image dimensions or orientation do not match this share."));
  if (await fingerprint(image, signal) !== manifest.map.fingerprint)
    throw new Error(t("The map image does not match this share. Choose the exact original image."));
  return header;
}

export function shareFilename(name: string) {
  return `${name.replace(/\.(png|jpe?g|webp)$/i, "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 100) || "map"}.megamap`;
}
