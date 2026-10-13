import { t } from "../i18n";
import type { ImportProgress, MapRecord } from "../types";
import { MAX_FILE_BYTES } from "../types";
import type { OcrIndex } from "../ocr/index";
import { readHeader } from "../processing/headers";
import { importMap } from "../processing/import";
import { normalizeNavigation, type NavigationState } from "../viewer/navigation";
import { database, listMaps } from "./database";
import { loadNavigation } from "./navigation";
import { loadOcr } from "./ocr";
import { deleteStoredMap, payloadStore } from "./payloads";
import { loadPhotos, putPhotos } from "./photos";
import { loadSetting, saveSetting } from "./settings";

const MAGIC = "MEGABAK1";
const HEADER_BYTES = 12;
const MAX_MANIFEST_BYTES = 256 * 1024 * 1024;
const MAX_PHOTO_BYTES = 16 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface BackupPhoto { id: string; type: string; bytes: number }
/** Everything needed to rebuild a map: its tiles are made again from the original. */
export interface BackupMap {
  id: string;
  name: string;
  created: number;
  opened?: number;
  fingerprint?: string;
  image: { type: string; bytes: number };
  navigation: NavigationState;
  ocr?: OcrIndex;
  /** Stored in this order right after the map's image. */
  photos: BackupPhoto[];
}
export interface BackupManifest {
  format: "megamaps-backup";
  version: 1;
  createdAt: number;
  shareName?: string;
  maps: BackupMap[];
}
export interface Backup {
  manifest: BackupManifest;
  files: Map<string, { image: Blob; photos: Map<string, Blob> }>;
}

/** Backups are recognised by their header, whatever their name or picker. */
export async function isBackupFile(blob: Blob) {
  return new TextDecoder().decode(await blob.slice(0, MAGIC.length).arrayBuffer()) === MAGIC;
}

export function backupSummary(manifest: BackupManifest) {
  const count = (pick: (map: BackupMap) => number) =>
    manifest.maps.reduce((total, map) => total + pick(map), 0);
  return {
    maps: manifest.maps.length,
    places: count((map) => map.navigation.markers.length),
    routes: count((map) => map.navigation.routes.filter((route) => !route.draft).length),
    photos: count((map) => map.photos.length),
  };
}

/** A month after the last backup (or none), once a map was added or opened since. */
export const BACKUP_INTERVAL = 30 * 86_400_000;
export function backupDue(maps: { created: number; opened?: number }[], lastBackup = 0, now = Date.now()) {
  return maps.some((map) => (map.opened ?? map.created) > lastBackup) && now - lastBackup >= BACKUP_INTERVAL;
}

const pad = (value: number) => String(value).padStart(2, "0");
export function backupFilename(date: Date) {
  return t("Mega Maps backup {date}", { date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` }) + ".megabackup";
}

/** One file: a length-prefixed JSON manifest, then each map's original and photos. */
export async function createBackup(now = new Date()) {
  const maps: BackupMap[] = [], parts: Blob[] = [];
  for (const map of await listMaps()) {
    if (map.status !== "ready") continue;
    const original = await payloadStore(map.backend).get(map.id, "original");
    const navigation = await loadNavigation(map.id);
    const ocr = await loadOcr(map.id);
    const photos = await loadPhotos(map.id, [...navigation.markers, ...navigation.routes].flatMap((item) => item.photos ?? []));
    maps.push({
      id: map.id, name: map.name, created: map.created,
      ...(map.opened ? { opened: map.opened } : {}),
      ...(map.fingerprint ? { fingerprint: map.fingerprint } : {}),
      image: { type: `image/${(await readHeader(original)).format}`, bytes: original.size },
      navigation, ...(ocr ? { ocr } : {}),
      photos: [...photos].map(([id, blob]) => ({ id, type: blob.type || "image/jpeg", bytes: blob.size })),
    });
    parts.push(original, ...photos.values());
  }
  const shareName = await loadSetting("share-name");
  const manifest: BackupManifest = { format: "megamaps-backup", version: 1, createdAt: now.getTime(),
    ...(shareName ? { shareName } : {}), maps };
  const json = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(HEADER_BYTES);
  header.set(new TextEncoder().encode(MAGIC));
  new DataView(header.buffer).setUint32(8, json.byteLength, true);
  return {
    manifest,
    file: new File([header, json, ...parts], backupFilename(now), { type: "application/octet-stream" }),
  };
}

const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number =>
  Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length <= max;
const point = (value: unknown) => object(value) && finite(value.x) && finite(value.y);
function invalid(): never {
  throw new Error(t("This backup is damaged or wasn’t made by Mega Maps."));
}

/** Check the shapes the viewer relies on, so a damaged file can't break a map. */
function validateMap(value: unknown): BackupMap {
  if (!object(value) || typeof value.id !== "string" || !/^[\w-]{1,100}$/.test(value.id) ||
      !text(value.name, 1000) || !value.name.trim() || !integer(value.created) ||
      (value.opened !== undefined && !integer(value.opened)) ||
      (value.fingerprint !== undefined && !(typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint))))
    invalid();
  const image = value.image;
  if (!object(image) || !IMAGE_TYPES.includes(String(image.type)) || !integer(image.bytes, 1, MAX_FILE_BYTES)) invalid();
  if (!Array.isArray(value.photos)) invalid();
  const photos = value.photos.map((photo: unknown): BackupPhoto => {
    if (!object(photo) || typeof photo.id !== "string" || !/^[^/]{1,200}$/.test(photo.id) ||
        !IMAGE_TYPES.includes(String(photo.type)) || !integer(photo.bytes, 1, MAX_PHOTO_BYTES)) invalid();
    return { id: photo.id, type: String(photo.type), bytes: photo.bytes };
  });
  const navigation = value.navigation;
  if (!object(navigation) || !Array.isArray(navigation.markers) || !Array.isArray(navigation.routes) ||
      !navigation.markers.every((marker) => object(marker) && typeof marker.id === "string" &&
        typeof marker.label === "string" && point(marker.point)) ||
      !navigation.routes.every((route) => object(route) && typeof route.id === "string" &&
        typeof route.name === "string" && Array.isArray(route.points) && route.points.every(point)))
    invalid();
  const ocr = value.ocr;
  if (ocr !== undefined && (!object(ocr) || !integer(ocr.version) || !integer(ocr.completedAt) ||
      !Array.isArray(ocr.lines) || !ocr.lines.every((line) => object(line) && typeof line.text === "string" &&
        finite(line.confidence) && Array.isArray(line.words) && line.words.every((word) => object(word) &&
          typeof word.text === "string" && Array.isArray(word.polygon) && word.polygon.every(point)))))
    invalid();
  return {
    id: value.id, name: value.name, created: value.created,
    ...(value.opened !== undefined ? { opened: value.opened } : {}),
    ...(value.fingerprint !== undefined ? { fingerprint: value.fingerprint as string } : {}),
    image: { type: String(image.type), bytes: image.bytes },
    navigation: normalizeNavigation({ ...(navigation as unknown as NavigationState), mapId: value.id }),
    ...(ocr ? { ocr: { ...(ocr as unknown as OcrIndex), mapId: value.id } } : {}),
    photos,
  };
}

export function validateBackup(value: unknown): BackupManifest {
  if (!object(value) || value.format !== "megamaps-backup") invalid();
  if (value.version !== 1) throw new Error(t("This backup was made by a newer Mega Maps. Update the app and try again."));
  if (!integer(value.createdAt) || !Array.isArray(value.maps) ||
      (value.shareName !== undefined && !text(value.shareName, 100))) invalid();
  const maps = value.maps.map(validateMap);
  if (new Set(maps.map((map) => map.id)).size !== maps.length) invalid();
  return { format: "megamaps-backup", version: 1, createdAt: value.createdAt,
    ...(value.shareName ? { shareName: value.shareName as string } : {}), maps };
}

/** Parse the manifest and slice each map's files without loading them. */
export async function readBackup(file: Blob): Promise<Backup> {
  if (file.size < HEADER_BYTES || !(await isBackupFile(file)))
    throw new Error(t("Choose a backup file saved by Mega Maps."));
  const size = new DataView(await file.slice(8, HEADER_BYTES).arrayBuffer()).getUint32(0, true);
  if (!size || size > MAX_MANIFEST_BYTES || HEADER_BYTES + size > file.size) invalid();
  let value: unknown;
  try {
    value = JSON.parse(await file.slice(HEADER_BYTES, HEADER_BYTES + size).text());
  } catch {
    invalid();
  }
  const manifest = validateBackup(value);
  let offset = HEADER_BYTES + size;
  const files: Backup["files"] = new Map();
  for (const map of manifest.maps) {
    const image = file.slice(offset, offset += map.image.bytes, map.image.type);
    const photos = new Map<string, Blob>();
    for (const photo of map.photos) photos.set(photo.id, file.slice(offset, offset += photo.bytes, photo.type));
    files.set(map.id, { image, photos });
  }
  if (offset !== file.size) throw new Error(t("This backup is incomplete. Save it again and retry."));
  return { manifest, files };
}

// Places, routes, photos and text detection land together or not at all.
async function commitRestored(map: MapRecord, entry: BackupMap, photos: Map<string, Blob>) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["maps", "navigation", "ocr", "photos"], "readwrite");
    tx.objectStore("maps").put({ ...map, name: entry.name, created: entry.created,
      ...(entry.opened ? { opened: entry.opened } : {}),
      ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}) });
    tx.objectStore("navigation").put({ ...entry.navigation, mapId: map.id });
    if (entry.ocr) tx.objectStore("ocr").put({ ...entry.ocr, mapId: map.id });
    putPhotos(tx, map.id, photos);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error(t("Could not restore this map.")));
  });
}

/** Adds the backup's maps this device doesn't have; maps already here are left as they are. */
export async function restoreBackup(
  backup: Backup, onProgress: (progress: ImportProgress) => void, signal: AbortSignal,
  create: typeof importMap = importMap,
) {
  const present = new Set((await listMaps()).map((map) => map.id));
  const missing = backup.manifest.maps.filter((map) => !present.has(map.id));
  let added = 0;
  for (const entry of missing) {
    signal.throwIfAborted();
    const files = backup.files.get(entry.id)!;
    const step = (progress: ImportProgress) => onProgress({
      fraction: (added + progress.fraction) / missing.length,
      message: missing.length > 1
        ? t("Map {current} of {total} · {step}", { current: added + 1, total: missing.length, step: progress.message })
        : progress.message,
    });
    try {
      const map = await create(new File([files.image], entry.name, { type: entry.image.type }), step, signal, entry.id);
      await commitRestored(map, entry, files.photos).catch(async (error) => {
        await deleteStoredMap(map).catch(() => {});
        throw error;
      });
    } catch (error) {
      if (!added || (error instanceof DOMException && error.name === "AbortError")) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(t("{restored} of {total} maps were restored before this problem: {reason}", { restored: added, total: missing.length, reason }));
    }
    added++;
  }
  if (backup.manifest.shareName && !(await loadSetting("share-name")))
    await saveSetting("share-name", backup.manifest.shareName);
  return { added, kept: backup.manifest.maps.length - added };
}
