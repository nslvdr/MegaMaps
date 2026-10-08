import type { MapRecord } from "../types";
import { icons } from "./icons";

export const mapRenameMarkup = `<dialog id="rename-map-dialog" aria-labelledby="rename-map-title"><form id="rename-map-form"><h2 id="rename-map-title">Rename map</h2><label>Name<input id="rename-map-name" required autocomplete="off" enterkeyhint="done" aria-describedby="rename-map-error"></label><p id="rename-map-error" class="dialog-error" role="alert" hidden></p><div class="dialog-actions"><button type="submit" class="primary">${icons.check}<span>Save</span></button><button type="button" id="rename-map-cancel" class="quiet">${icons.close}<span>Cancel</span></button></div></form></dialog>`;

// Keep the dialog open on save failure so the name can be retried.
export function initMapRename(
  dialog: HTMLDialogElement,
  save: (id: string, name: string) => Promise<void>,
) {
  const form = dialog.querySelector<HTMLFormElement>("form")!;
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  const error = dialog.querySelector<HTMLElement>(".dialog-error")!;
  const cancel = dialog.querySelector<HTMLButtonElement>("#rename-map-cancel")!;
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
  let mapId: string | undefined;
  let saving = false;

  cancel.addEventListener("click", () => dialog.close());
  dialog.addEventListener("cancel", (event) => {
    if (saving) event.preventDefault();
  });
  dialog.addEventListener("close", () => { mapId = undefined; });
  input.addEventListener("input", () => { error.hidden = true; });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!mapId || saving) return;
    const name = input.value.trim();
    if (!name) {
      error.textContent = "Enter a map name.";
      error.hidden = false;
      input.focus();
      return;
    }
    saving = true;
    input.disabled = true;
    for (const button of buttons) button.disabled = true;
    error.hidden = true;
    try {
      await save(mapId, name);
      dialog.close();
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : String(cause);
      error.hidden = false;
    } finally {
      saving = false;
      input.disabled = false;
      for (const button of buttons) button.disabled = false;
      if (dialog.open) input.focus();
    }
  });

  return (map: Pick<MapRecord, "id" | "name">) => {
    mapId = map.id;
    input.value = map.name;
    error.hidden = true;
    dialog.showModal();
    input.focus();
    input.select();
  };
}
