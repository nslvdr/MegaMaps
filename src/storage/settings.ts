import { transact } from "./database";
import type { LonLat } from "../viewer/geo";

/** App-wide preferences, stored beside the last opened map. */
export interface Settings {
  /** Shown to people who receive a shared map. */
  "share-name": string;
  /** When a backup was last saved or shared. */
  "last-backup": number;
  /** Where the last map lined up with the streets is, so the next one starts there. */
  "streets-place": LonLat;
  /** The link to a position app is on, so it comes back after the app is reopened. */
  "position-link": boolean;
}
export const loadSetting = <K extends keyof Settings>(key: K) =>
  transact<Settings[K] | undefined>("settings", "readonly", (s) => s.get(key));
export const saveSetting = <K extends keyof Settings>(key: K, value: Settings[K]) =>
  transact("settings", "readwrite", (s) => s.put(value, key));
