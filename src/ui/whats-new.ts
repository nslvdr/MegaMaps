import { changelog, type Release } from "../changelog";
import { dialogHeader, showDialog } from "./dialog";
import { icons } from "./icons";
import { t, type Message } from "../i18n";

export const whatsNewMarkup = `<dialog id="whats-new" aria-labelledby="whats-new-title">${dialogHeader("whats-new-title", t("What’s new"), icons.sparkle, "whats-new-close")}<div id="whats-new-sections"></div><div class="dialog-actions"><button type="button" id="whats-new-done" class="primary">${icons.check}<span>${t("Got it")}</span></button></div></dialog>`;

const SEEN = "megamaps:changelog-seen";

/** Releases this device hasn't shown yet. A device that never stored one is new,
 *  unless it already has maps: then it updated from before the changelog existed. */
export function unseenReleases(releases: Release[], seen: string | null, hasMaps: boolean) {
  if (seen === null) return hasMaps ? releases.slice(0, 1) : [];
  const index = releases.findIndex((release) => release.commit === seen);
  return index === -1 ? [] : releases.slice(0, index);
}

const sections = [
  ["added", "New features", icons.add],
  ["changed", "Changes", icons.changed],
  ["fixed", "Bug fixes", icons.fixed],
] as const satisfies [keyof Release, Message, string][];

// "Before → after" lines get their arrow drawn in the accent color.
function line(document: Document, text: string) {
  const item = document.createElement("li");
  const [before, after] = text.split(" → ");
  if (after === undefined) item.textContent = text;
  else {
    const arrow = document.createElement("span");
    arrow.className = "whats-new-arrow";
    arrow.textContent = " → ";
    item.append(before!, arrow, after);
  }
  return item;
}

export function initWhatsNew(dialog: HTMLDialogElement, releases = changelog) {
  const document = dialog.ownerDocument;
  const close = () => dialog.close();
  dialog.querySelector("#whats-new-close")!.addEventListener("click", close);
  dialog.querySelector("#whats-new-done")!.addEventListener("click", close);

  function show(unseen: Release[]) {
    const parts = sections.flatMap(([key, heading, icon]) => {
      const items = unseen.flatMap((release) => release[key] ?? []);
      if (!items.length) return [];
      const section = document.createElement("section");
      const title = document.createElement("h3");
      const list = document.createElement("ul");
      title.innerHTML = icon;
      title.append(t(heading));
      list.append(...items.map((item) => line(document, t(item))));
      section.append(title, list);
      return [section];
    });
    dialog.querySelector("#whats-new-sections")!.replaceChildren(...parts);
    showDialog(dialog);
  }

  return {
    /** Shows what's new since the last launch. When another dialog has the
     *  screen, it waits for the next launch. */
    atLaunch(hasMaps: boolean, free = true) {
      const latest = releases[0];
      if (!latest) return;
      let seen: string | null = null;
      try {
        seen = localStorage.getItem(SEEN);
      } catch {}
      const unseen = unseenReleases(releases, seen, hasMaps);
      if (unseen.length && !free) return;
      try {
        localStorage.setItem(SEEN, latest.commit);
      } catch {}
      if (unseen.length) show(unseen);
    },
  };
}
