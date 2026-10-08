import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { database, listMaps } from "../src/storage/database";
import { payloadStore } from "../src/storage/payloads";
import { loadNavigation } from "../src/storage/navigation";
import { loadOcr } from "../src/storage/ocr";
import { needsOcr } from "../src/ocr/index";

test("version 1 libraries and payloads survive the navigation and OCR upgrade", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("map-viewer", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("maps", { keyPath: "id" });
      request.result.createObjectStore("payloads");
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(["maps", "payloads"], "readwrite");
      tx.objectStore("maps").put({
        id: "legacy",
        name: "existing.png",
        status: "ready",
      });
      tx.objectStore("payloads").put(
        new Blob(["existing bytes"]),
        "legacy/original",
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onabort = () => reject(tx.error);
    };
  });
  const db = await database();
  assert.equal(db.version, 3);
  assert.equal((await listMaps())[0]?.name, "existing.png");
  assert.equal(
    await (await payloadStore("indexeddb").get("legacy", "original")).text(),
    "existing bytes",
  );
  assert.deepEqual((await loadNavigation("legacy")).markers, []);
  assert.equal(needsOcr(await loadOcr("legacy")), true);
});
