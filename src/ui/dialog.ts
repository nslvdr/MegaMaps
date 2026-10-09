// Open on the heading so native dialog focus never preselects an action or text field.
export function showDialog(dialog: HTMLDialogElement) {
  const heading = dialog.querySelector<HTMLElement>("h2")!;
  heading.tabIndex = -1;
  heading.setAttribute("autofocus", "");
  dialog.showModal();
}
