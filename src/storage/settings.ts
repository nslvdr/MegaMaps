import { transact } from "./database";
import type { LonLat } from "../viewer/geo";

/** App-wide preferences, stored beside the last opened map. */
export interface Settings {
  /** Shown to people who receive a shared map. */
  "share-name": string;
  /** When a backup was last saved or shared. */
  "last-backup": number;
  /** What the last backup held, to count what changed since. */
  "backup-snapshot": Record<string, string>;
  /** When the backup reminder was last put away, and how many changes it counted then. */
  "backup-dismissed": { at: number; changes: number };
  /** When the user started with Mega Maps, shown under their activity. */
  "joined": number;
  /** Where the last map lined up with the streets is, so the next one starts there. */
  "streets-place": LonLat;
}
export const loadSetting = <K extends keyof Settings>(key: K) =>
  transact<Settings[K] | undefined>("settings", "readonly", (s) => s.get(key));
export const saveSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
  transact("settings", "readwrite", (s) => s.put(value, key));
