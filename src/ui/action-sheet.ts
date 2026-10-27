import { t } from "../i18n";
import { showDialog } from "./dialog";
import { icons } from "./icons";

export type SheetAction = {
  label: string;
  icon: string;
  danger?: boolean;
  /** Stays open after the tap, as a Delete armed for a second one does. */
  stay?: boolean;
  action: () => void;
};

// A ⋯ opens its item's actions in a small dialog, at the bottom on phones:
// what it acts on first, then the actions, and Delete set apart below them.
export function showActionSheet(
  parent: HTMLElement,
  options: { title: string; detail?: string; icon: string | Node; actions: SheetAction[] },
) {
  const dialog = document.createElement("dialog");
  dialog.className = "action-sheet";
  dialog.setAttribute("aria-label", options.title);
  dialog.innerHTML = `<div class="action-sheet-body"><div class="dialog-header"><span class="action-sheet-icon"></span><div class="action-sheet-title"><h2></h2></div><button type="button" class="dialog-close" aria-label="${t("Close")}" title="${t("Close")}">${icons.close}</button></div><div class="action-sheet-list"></div></div>`;
  const icon = dialog.querySelector(".action-sheet-icon")!;
  if (typeof options.icon === "string") icon.innerHTML = options.icon;
  else icon.append(options.icon);
  dialog.querySelector("h2")!.textContent = options.title;
  if (options.detail) {
    const detail = document.createElement("small");
    detail.textContent = options.detail;
    dialog.querySelector(".action-sheet-title")!.append(detail);
  }
  const list = dialog.querySelector(".action-sheet-list")!;
  for (const item of options.actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = item.danger ? "danger" : "action-sheet-item";
    button.innerHTML = item.icon;
    const label = document.createElement("span");
    label.textContent = item.label;
    button.append(label);
    button.addEventListener("click", () => {
      if (!item.stay) dialog.close();
      item.action();
    });
    (item.danger ? list.parentElement! : list).append(button);
  }
  dialog.querySelector(".dialog-close")!.addEventListener("click", () => dialog.close());
  // The body fills the dialog, so only the backdrop around it hits the dialog itself.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  // Gone once its closing transition has played.
  dialog.addEventListener("close", () => setTimeout(() => dialog.remove(), 300));
  parent.append(dialog);
  showDialog(dialog);
  return dialog;
}
