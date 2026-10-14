import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { devDataHandler } from "../scripts/dev-data";

function backup(ids: string[]) {
  const manifest = Buffer.from(JSON.stringify({ format: "megamaps-backup", maps: ids.map((id) => ({ id })) }));
  const header = Buffer.alloc(12);
  header.write("MEGABAK1");
  header.writeUInt32LE(manifest.length, 8);
  return Buffer.concat([header, manifest, Buffer.from("image bytes")]);
}

test("dev data lists backups with their maps and sends nothing else", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "dev-data-"));
  const folder = join(root, "backups");
  writeFileSync(join(root, "secret.megabackup"), backup(["outside"]));
  mkdirSync(folder);
  writeFileSync(join(folder, "quarry.megabackup"), backup(["a", "b"]));
  writeFileSync(join(folder, "notes.txt"), "not a backup");
  const server = createServer(devDataHandler(folder)).listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  assert.deepEqual(await (await fetch(url)).json(), [{ name: "quarry.megabackup", maps: ["a", "b"] }]);
  assert.deepEqual(Buffer.from(await (await fetch(`${url}quarry.megabackup`)).arrayBuffer()), backup(["a", "b"]));
  for (const path of ["notes.txt", "%2e%2e%2fsecret.megabackup"])
    assert.equal((await fetch(url + path)).status, 404, path);
});
