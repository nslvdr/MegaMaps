import test from "node:test";
import assert from "node:assert/strict";
import { $, cancel, click, flushSync, render, settle } from "./dom";
import type { AppUpdate } from "../src/app-update";
import UpdateDialog, { type UpdateActions, type UpdateStep } from "../src/ui/UpdateDialog.svelte";

function setup(actions: Partial<UpdateActions>) {
  let restarted = 0;
  const { instance } = render(UpdateDialog, {
    find: async () => undefined,
    install: async () => true,
    ...actions,
    restart: () => { restarted++; },
  });
  const dialog = $<HTMLDialogElement>("update-dialog");
  const updates = { ...instance, open: () => { instance.open(); flushSync(); }, start: (update: AppUpdate) => { instance.start(update); flushSync(); } };
  return {
    dialog, updates,
    text: (id: string) => $(id).textContent,
    visible: (id: string) => !$(id).hasAttribute("hidden"),
    restarted: () => restarted,
    confirm: () => click("update-confirm"),
    dismiss: () => click("update-dismiss"),
    escape: () => { if (cancel(dialog)) dialog.close(); },
  };
}
const available: AppUpdate = { version: "two", size: 20 * 1024 * 1024, downloaded: false };

test("an available update is described and only downloaded once the user agrees", async () => {
  let installs = 0;
  const app = setup({ find: async () => available, install: async () => { installs++; return true; } });
  app.updates.open();
  assert.equal(app.dialog.dataset.state, "checking");
  assert.equal($("update-actions").querySelector("#update-dismiss"), null, "the cross lives beside the title");
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
    install: (progress) => { report = (step) => { progress(step); flushSync(); }; return new Promise((resolve) => { finish = resolve; }); },
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
  assert.equal(app.dialog.querySelector<HTMLButtonElement>("#update-dismiss")!.disabled, true);
  app.dismiss();
  assert.equal(app.dialog.open, true, "the header cross also waits for installation to finish");
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

test("an automatic update installs without asking and restarts once ready", async () => {
  let finish: (installed: boolean) => void = () => {};
  let finds = 0;
  const app = setup({
    find: async () => { finds++; return available; },
    install: () => new Promise((resolve) => { finish = resolve; }),
  });
  app.updates.start(available);
  assert.equal(app.dialog.open, true, "the steps stay visible");
  assert.equal(app.dialog.dataset.state, "installing");
  assert.equal(finds, 0, "the found update is used as is");
  assert.equal(app.visible("update-actions"), false, "nothing to agree to");
  assert.equal(app.updates.isBusy(), true);
  finish(true);
  await settle();
  assert.equal(app.dialog.dataset.state, "restarting");
  assert.equal(app.restarted(), 1);
});
