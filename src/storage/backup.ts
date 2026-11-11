import { errorMessage, t } from "../i18n";
import type { ImportProgress, MapRecord } from "../types";
import { MAX_FILE_BYTES } from "../types";
import { preference, type Preferences } from "../preferences";
import { readOcrIndex, type OcrIndex } from "../ocr/index";
import { readHeader } from "../processing/headers";
import { importMap } from "../processing/import";
import { normalizeNavigation, type NavigationState } from "../viewer/navigation";
import { database, listMaps } from "./database";
import { loadNavigation } from "./navigation";
import { loadOcr } from "./ocr";
import { deleteStoredMap, payloadStore } from "./payloads";
import { copyPhotos, loadPhotos, putPhotos } from "./photos";
import { storageProtected } from "./protection";
import { loadSetting, saveSetting, type Settings } from "./settings";

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
  /** The example map stays the example on the device it is restored to. */
  example?: true;
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

/** A month after the last backup (or none), or the Backup reminder's interval; at most a week
 * when the browser may clear the library to free space, whatever the reminder says. */
export const BACKUP_INTERVAL = 30 * 86_400_000;
export const UNPROTECTED_BACKUP_INTERVAL = 7 * 86_400_000;
const intervals: Record<Preferences["backup-reminder"], number> = { month: BACKUP_INTERVAL, week: UNPROTECTED_BACKUP_INTERVAL, off: Infinity };
export const backupInterval = (kept = true, reminder: Preferences["backup-reminder"] = "month") =>
  kept ? intervals[reminder] : Math.min(intervals[reminder], UNPROTECTED_BACKUP_INTERVAL);
/** Due once something isn't backed up and the interval has passed since the last backup. */
export function backupDue(changes: number, lastBackup = 0, now = Date.now(), kept = true,
  reminder: Preferences["backup-reminder"] = "month") {
  return changes > 0 && now - lastBackup >= backupInterval(kept, reminder);
}

/** What a backup holds, one key per map, place, route, trip and photo, each with a hash
 * of its content, so what changed since can be counted. */
export type BackupSnapshot = Record<string, string>;
type Snapshotted = { id: string; created: number; example?: true; navigation: NavigationState };
function hash(text: string) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 0x01000193);
  return (value >>> 0).toString(36);
}
// The example map is the app's, so nothing in it asks for a backup.
function snapshotItems(maps: Snapshotted[]) {
  return maps.filter((map) => !map.example).flatMap((map) => {
    const { markers, routes, trips } = map.navigation;
    const items = [...markers, ...routes.filter((route) => !route.draft)];
    return [
      { key: map.id, hash: "", created: map.created },
      ...items.map((item) => ({ key: `${map.id}/${item.id}`, hash: hash(JSON.stringify(item)), created: item.created })),
      ...trips.map((trip) => ({ key: `${map.id}/trip/${trip.id}`, hash: hash(JSON.stringify(trip)), created: trip.ended })),
      ...items.flatMap((item) => item.photos ?? []).map((id) => ({ key: `${map.id}/photo/${id}`, hash: "", created: undefined })),
    ];
  });
}
export const backupSnapshot = (maps: Snapshotted[]): BackupSnapshot =>
  Object.fromEntries(snapshotItems(maps).map((item) => [item.key, item.hash]));
/** Maps, places, routes, trips and photos added or changed since the last backup. Backups
 * from before snapshots were kept count what was created since, and no photos. */
export function unsavedChanges(maps: Snapshotted[], snapshot?: BackupSnapshot, lastBackup?: number) {
  return snapshotItems(maps).filter((item) => snapshot
    ? snapshot[item.key] !== item.hash
    : !lastBackup || (item.created !== undefined && item.created > lastBackup)).length;
}
/** Remembers a saved backup: when, and what it holds. */
export async function recordBackup(manifest: BackupManifest) {
  await saveSetting("backup-snapshot", backupSnapshot(manifest.maps));
  await saveSetting("last-backup", manifest.createdAt);
}

/** A dismissed reminder stays away until this many more changes, or another interval. */
export const DISMISSED_CHANGES = 10;
export function backupBannerShown(changes: number, lastBackup: number | undefined, dismissed: Settings["backup-dismissed"] | undefined,
  now = Date.now(), kept = true, reminder: Preferences["backup-reminder"] = "month") {
  if (!backupDue(changes, lastBackup, now, kept, reminder)) return false;
  return !dismissed || dismissed.at < (lastBackup ?? 0) || changes >= dismissed.changes + DISMISSED_CHANGES ||
    now - dismissed.at >= backupInterval(kept, reminder);
}

/** Where backups stand now: what isn't backed up, and whether to ask for a backup. */
export async function backupStatus(now = Date.now()) {
  const [records, snapshot, lastBackup, dismissed, kept] = await Promise.all([
    listMaps(), loadSetting("backup-snapshot").catch(() => undefined), loadSetting("last-backup").catch(() => undefined),
    loadSetting("backup-dismissed").catch(() => undefined), storageProtected().then((kept) => kept !== false),
  ]);
  const own = records.filter((map) => map.status === "ready" && !map.example);
  const maps = await Promise.all(own.map(async (map) => ({ ...map, navigation: await loadNavigation(map.id) })));
  const changes = unsavedChanges(maps, snapshot, lastBackup), reminder = preference("backup-reminder");
  return { changes, lastBackup, kept, due: backupDue(changes, lastBackup, now, kept, reminder),
    banner: backupBannerShown(changes, lastBackup, dismissed, now, kept, reminder) };
}

const pad = (value: number) => String(value).padStart(2, "0");
/** Sortable local date and time with filename-safe ASCII separators. */
export function backupFilename(date: Date) {
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}`;
  return `Backup ${day} ${time}.megabackup`;
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
      ...(map.example ? { example: true as const } : {}),
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
  const ocr = value.ocr === undefined ? undefined : readOcrIndex(value.ocr) ?? invalid();
  return {
    id: value.id, name: value.name, created: value.created,
    ...(value.opened !== undefined ? { opened: value.opened } : {}),
    ...(value.fingerprint !== undefined ? { fingerprint: value.fingerprint as string } : {}),
    ...(value.example === true ? { example: true as const } : {}),
    image: { type: String(image.type), bytes: image.bytes },
    navigation: normalizeNavigation({ ...(navigation as unknown as NavigationState), mapId: value.id }),
    ...(ocr ? { ocr: { ...ocr, mapId: value.id } } : {}),
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
  const copies = await copyPhotos(photos);
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["maps", "navigation", "ocr", "photos"], "readwrite");
    tx.objectStore("maps").put({ ...map, name: entry.name, created: entry.created,
      ...(entry.opened ? { opened: entry.opened } : {}),
      ...(entry.fingerprint ? { fingerprint: entry.fingerprint } : {}),
      ...(entry.example ? { example: true } : {}) });
    tx.objectStore("navigation").put({ ...entry.navigation, mapId: map.id });
    if (entry.ocr) tx.objectStore("ocr").put({ ...entry.ocr, mapId: map.id });
    putPhotos(tx, map.id, copies);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error(t("Could not restore this map.")));
  });
}

/** The backup's maps this device doesn't have. A device holds one example map,
 * so the backup's is left out where there is one. */
export function missingMaps(manifest: BackupManifest, maps: { id: string; example?: true }[]) {
  const present = new Set(maps.map((map) => map.id)), hasExample = maps.some((map) => map.example);
  return manifest.maps.filter((map) => !present.has(map.id) && !(map.example && hasExample));
}

/** Adds the backup's maps this device doesn't have; maps already here are left as they are. */
export async function restoreBackup(
  backup: Backup, onProgress: (progress: ImportProgress) => void, signal: AbortSignal,
  create: typeof importMap = importMap,
) {
  const missing = missingMaps(backup.manifest, await listMaps());
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
      // Many photos take a while to save once the tiles are done.
      step({ fraction: 0.99, message: t("Saving places and photos…") });
      await commitRestored(map, entry, files.photos).catch(async (error) => {
        await deleteStoredMap(map).catch(() => {});
        throw error;
      });
    } catch (error) {
      if (!added || (error instanceof DOMException && error.name === "AbortError")) throw error;
      const reason = errorMessage(error);
      throw new Error(t("{restored} of {total} maps were restored before this problem: {reason}", { restored: added, total: missing.length, reason }));
    }
    added++;
  }
  if (backup.manifest.shareName && !(await loadSetting("share-name")))
    await saveSetting("share-name", backup.manifest.shareName);
  return { added, kept: backup.manifest.maps.length - added };
}
