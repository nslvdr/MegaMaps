import { icons } from "./icons";
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

export const helpLink = (topic: Topic, icon: string, color: string, text: string, hint: string) =>
  `<a class="share-row help-link" data-help="${topic}" href="${helpUrl(topic)}" target="_blank" rel="noopener"><span class="share-row-icon" style="--k:${color}">${icon}</span><span class="share-row-label">${text}<small>${hint}</small></span>${icons.externalLink}</a>`;

/** The three ways to reach out, in Settings. */
export const helpLinksMarkup = `<div class="share-summary">${
  helpLink("question", icons.question, "var(--neon-view)", t("Ask a question"), t("Others may have asked already"))}${
  helpLink("idea", icons.idea, "var(--neon-add)", t("Suggest a feature"), t("Vote on ideas or add yours"))}${
  helpLink("problem", icons.bug, "var(--neon-lock)", t("Report a problem"), t("Your app version is included"))}</div>`;

export const githubNote = t("Opens GitHub. Reading is free; writing needs a free account.");

/** Fills in the app's details on every problem link and counts which topics people open. */
export function initHelp(root: HTMLElement, app: string) {
  for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-help="problem"]'))
    link.href = helpUrl("problem", app);
  root.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-help]");
    if (link) track("help_opened", { topic: link.dataset.help!, from: link.closest("[id]")?.id ?? "" });
  });
  return {
    /** An error dialog's link that reports this very problem. */
    report: (link: HTMLAnchorElement, problem: Problem) => { link.href = helpUrl("problem", app, problem); },
  };
}
