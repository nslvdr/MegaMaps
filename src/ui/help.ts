import { language, t } from "../i18n";
import { track } from "../stats";

const REPOSITORY = "https://github.com/nslvdr/MegaMaps";
/** GitHub turns away very long addresses; the start of an error says the most. */
const MAX_ERROR = 1500;

export type Topic = "question" | "idea" | "problem";

/** What an error dialog knows about the problem being reported. */
export interface Problem {
  title?: string;
  error?: string;
}

/** Questions and ideas go to Discussions, where others can find and vote on them.
 *  A problem opens the issue form with the app and device already filled in. */
export function helpUrl(topic: Topic, app = "", problem: Problem = {}) {
  if (topic !== "problem") return `${REPOSITORY}/discussions/new?category=${topic === "idea" ? "ideas" : "q-a"}`;
  const query = new URLSearchParams({ template: "problem.yml" });
  if (problem.title) query.set("title", problem.title);
  if (problem.error) query.set("error", problem.error.slice(0, MAX_ERROR));
  if (app) query.set("app", app);
  return `${REPOSITORY}/issues/new?${query}`;
}

/** The app's details for a problem report: nothing the person wrote, nothing about their maps. */
export const describeApp = (version: string, installed: boolean) => [
  `Version: ${version || "unknown"}`,
  `Installed: ${installed ? "yes" : "no"}`,
  `Language: ${language}`,
  `Device: ${navigator.userAgent}`,
].join("\n");

/** The app's details, filled into every problem report once the app knows them. */
let details = "";
export const appDetails = () => details;

export const githubNote = t("Opens GitHub. Reading is free; writing needs a free account.");

/** Remembers the app's details for problem reports and counts which topics people open. */
export function initHelp(root: HTMLElement, app: string) {
  details = app;
  root.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-help]");
    if (link) track("help_opened", { topic: link.dataset.help!, from: link.closest("[id]")?.id ?? "" });
  });
}
