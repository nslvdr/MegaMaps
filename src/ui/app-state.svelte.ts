import type { MapRecord } from "../types";
import type { SheetAction, SheetIcon } from "./ActionSheet.svelte";
import type { ViewerControls } from "./viewer-controls.svelte";

/** Which page fills the screen; none while the app is starting. */
export type Page = "" | "home" | "settings" | "viewer" | "install";

/** What the app shows: main.ts changes it, the components only show it. */
export const app = $state({
  page: "" as Page,
  /** Ready maps, the most recently used first. */
  maps: [] as MapRecord[],
  /** A dot on Settings while a backup is due. */
  backupDue: false,
  /** Once there's a map of one's own, the example offers to go. */
  exampleOffer: false,
  /** The long task the progress dialog follows: an import, a restore, the example map. */
  progress: { title: "", icon: "", note: "", name: "", percent: 0, message: "", left: "" },
  /** A message, and for a problem the address that reports it. */
  message: { title: "", body: "", report: "" },
  /** The map the delete dialog asks about, and what goes with it. */
  deleting: undefined as MapRecord | undefined,
  deleteNote: "",
  /** A map's Advanced settings: its text detection. */
  advanced: { map: undefined as MapRecord | undefined, status: "", scanned: false, running: false, blocked: false },
  /** Whether the text detection offer is for a map scanned before detection improved. */
  ocrOfferUpdate: false,
  /** A map's ⋯ actions. */
  /** The open map's controls, while one is open. */
  controls: undefined as ViewerControls | undefined,
  sheet: { open: false, title: "", detail: "", icon: "" as SheetIcon, actions: [] as SheetAction[] },
});
