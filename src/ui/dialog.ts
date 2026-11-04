// Open on the heading so native dialog focus never preselects an action or text field.
// A non-modal dialog leaves the page behind it usable.
export function showDialog(dialog: HTMLDialogElement, modal = true) {
  const heading = dialog.querySelector<HTMLElement>("h2")!;
  heading.tabIndex = -1;
  heading.setAttribute("autofocus", "");
  if (modal) dialog.showModal();
  else dialog.show();
}

// A form closes only from its X or Save. A close request (Back, and on some
// phones putting the keyboard away) would otherwise throw away what was just
// typed. Listen for "cancel" with it.
export const keepFormOpen = (event: Event) => event.preventDefault();
