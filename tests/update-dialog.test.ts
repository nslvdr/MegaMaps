import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import type { AppUpdate } from "../src/app-update";
import { initUpdateDialog, updateDialogMarkup, type UpdateActions, type UpdateStep } from "../src/ui/update-dialog";

function setup(actions: Partial<UpdateActions>) {
  const { window, document } = parseHTML(updateDialogMarkup);
  const dialog = document.querySelector<HTMLDialogElement>("dialog")!;
  // Linkedom omits native dialog behavior.
  Object.defineProperties(dialog, {
    open: { get: () => dialog.hasAttribute("open") },
    showModal: { value: () => dialog.setAttribute("open", "") },
    close: { value: () => {
      dialog.removeAttribute("open");
      dialog.dispatchEvent(new window.Event("close"));
    } },
  });
  let restarted = 0;
  const updates = initUpdateDialog(dialog, {
    find: async () => undefined,
    install: async () => true,
    ...actions,
    restart: () => { restarted++; },
  });
  const text = (id: string) => dialog.querySelector(`#${id}`)!.textContent;
  const visible = (id: string) => !dialog.querySelector(`#${id}`)!.hasAttribute("hidden");
  return {
    dialog, updates, text, visible,
    restarted: () => restarted,
    confirm: () => dialog.querySelector("#update-confirm")!.dispatchEvent(new window.Event("click")),
    dismiss: () => dialog.querySelector("#update-dismiss")!.dispatchEvent(new window.Event("click")),
    escape: () => {
      const event = new window.Event("cancel", { cancelable: true });
      dialog.dispatchEvent(event);
      if (!event.defaultPrevented) dialog.close();
    },
  };
}
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const available: AppUpdate = { version: "two", size: 20 * 1024 * 1024, downloaded: false };

test("an available update is described and only downloaded once the user agrees", async () => {
  let installs = 0;
  const app = setup({ find: async () => available, install: async () => { installs++; return true; } });
  app.updates.open();
  assert.equal(app.dialog.dataset.state, "checking");
  assert.ok(app.visible("update-progress"));
  await settle();
  assert.equal(app.dialog.dataset.state, "available");
  assert.equal(app.text("update-title"), "Update available");
  assert.match(app.text("update-facts")!, /About 20\.0 MB to download/);
  assert.match(app.text("update-facts")!, /maps, places and routes stay/);
  assert.match(app.text("update-confirm")!, /Update now/);
  assert.equal(installs, 0);
  app.dismiss();
  assert.equal(app.dialog.open, false);
  assert.equal(installs, 0);
});

test("agreeing shows download, install and save progress, then restarts", async () => {
  let report: (step: UpdateStep) => void = () => {};
  let finish: (installed: boolean) => void = () => {};
  const app = setup({
    find: async () => available,
    install: (progress) => { report = progress; return new Promise((resolve) => { finish = resolve; }); },
  });
  app.updates.open();
  await settle();
  app.confirm();
  assert.equal(app.dialog.dataset.state, "installing");
  assert.equal(app.text("update-step"), "Starting download…");
  report({ step: "download", loaded: 10 * 1024 * 1024, total: available.size });
  assert.equal(app.text("update-step"), "Downloading · 10.0 MB of 20.0 MB");
  assert.equal(app.text("update-percent"), "45%");
  app.escape();
  assert.equal(app.dialog.open, true, "the download cannot be dismissed halfway");
  report({ step: "download", loaded: available.size, total: available.size });
  assert.equal(app.text("update-step"), "Installing update…");
  report({ step: "download", loaded: 1, total: available.size });
  assert.equal(app.text("update-step"), "Installing update…", "late messages don't go backwards");
  report({ step: "save" });
  assert.equal(app.text("update-step"), "Saving your place…");
  finish(true);
  await settle();
  assert.equal(app.dialog.dataset.state, "restarting");
  assert.equal(app.text("update-percent"), "100%");
  assert.equal(app.restarted(), 1);
});

test("being current, an already downloaded update and failures each explain themselves", async () => {
  const current = setup({ currentRelease: new Date("2026-10-01T12:00:00Z") });
  current.updates.open();
  await settle();
  assert.equal(current.text("update-title"), "You’re up to date");
  assert.match(current.text("update-body")!, /released/);

  const ready = setup({ find: async () => ({ ...available, downloaded: true }) });
  ready.updates.open();
  await settle();
  assert.match(ready.text("update-body")!, /already been downloaded/);
  assert.doesNotMatch(ready.text("update-facts")!, /to download/);
  assert.match(ready.text("update-confirm")!, /Restart now/);

  let attempts = 0;
  const failing = setup({
    find: async () => available,
    install: async () => { attempts++; throw new Error("The update stopped downloading."); },
  });
  failing.updates.open();
  await settle();
  failing.confirm();
  await settle();
  assert.equal(failing.dialog.dataset.state, "error");
  assert.match(failing.text("update-body")!, /stopped downloading/);
  assert.equal(failing.restarted(), 0);
  failing.confirm();
  assert.equal(failing.dialog.dataset.state, "checking", "Try again checks afresh");
  await settle();
  assert.equal(attempts, 1);
});
