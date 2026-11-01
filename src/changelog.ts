import type { Message } from "./i18n";

/** What a release changed for users, in English with French in src/locales/fr.ts.
 *  `commit` is the last dev commit it covers. A value that changed, such as a
 *  limit, reads "Thing: before → after". */
export type Release = {
  date: string;
  commit: string;
  added?: Message[];
  changed?: Message[];
  fixed?: Message[];
};

/** Newest first. */
export const changelog: Release[] = [
  {
    date: "2026-11-01",
    commit: "33409c4",
    added: [
      "Getting started and animated tutorials show where to tap, on a real map.",
      "An example map, Val Moulin, to try the app without importing anything.",
      "A “Need help?” box above the bottom bar.",
    ],
    changed: [
      "Map size limit: 300 → 600 megapixels.",
      "Larger images, up to 1,000 megapixels, are shrunk instead of refused.",
      "The app asks before running text detection.",
      "Route names open as balloons, like place names.",
      "Settings shows the time of each version, not just the day.",
    ],
    fixed: [
      "Map previews in the main menu are square.",
    ],
  },
];
