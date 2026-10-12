import { icons } from "./icons";

// Static dialog headings share a colored icon and an explicitly labeled close button.
export const dialogHeader = (
  titleId: string,
  title: string,
  icon: string,
  closeId: string,
  closeLabel = "Close",
) => `<div class="dialog-header"><span id="${titleId}-icon" class="dialog-title-icon" aria-hidden="true">${icon}</span><h2 id="${titleId}">${title}</h2><button type="button" id="${closeId}" class="dialog-close" aria-label="${closeLabel}" title="${closeLabel}">${icons.close}</button></div>`;

// Open on the heading so native dialog focus never preselects an action or text field.
// A non-modal dialog leaves the page behind it usable.
export function showDialog(dialog: HTMLDialogElement, modal = true) {
  const heading = dialog.querySelector<HTMLElement>("h2")!;
  heading.tabIndex = -1;
  heading.setAttribute("autofocus", "");
  if (modal) dialog.showModal();
  else dialog.show();
}
