import { closeSync, createReadStream, openSync, readdirSync, readSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "vite";

// Each dev port is its own origin with empty storage, so every dev server
// restores the backups kept in one shared folder outside the worktrees.
export const DEV_DATA_FOLDER = process.env.MEGAMAPS_DEV_DATA ?? join(homedir(), ".megamaps-dev");

/** The map ids in a backup's manifest, read without loading its images. */
function backupMaps(path: string): string[] {
  const file = openSync(path, "r");
  try {
    const header = Buffer.alloc(12);
    readSync(file, header, 0, 12, 0);
    const manifest = Buffer.alloc(header.readUInt32LE(8));
    readSync(file, manifest, 0, manifest.length, 12);
    return (JSON.parse(manifest.toString()) as { maps: { id: string }[] }).maps.map((map) => map.id);
  } finally {
    closeSync(file);
  }
}

function devBackups(folder: string) {
  let names: string[] = [];
  try {
    names = readdirSync(folder).filter((name) => name.endsWith(".megabackup")).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    try {
      return [{ name, maps: backupMaps(join(folder, name)) }];
    } catch {
      console.warn(`Skipping unreadable dev backup ${name}`);
      return [];
    }
  });
}

/** `/` lists the folder's backups and their map ids; `/<name>` sends one of them. */
export function devDataHandler(folder: string) {
  return (request: IncomingMessage, response: ServerResponse) => {
    const backups = devBackups(folder);
    const wanted = decodeURIComponent(request.url?.slice(1).split("?")[0] ?? "");
    if (!wanted) {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(backups));
      return;
    }
    // Only a listed backup is sent, never another path in or outside the folder.
    if (!backups.some((backup) => backup.name === wanted)) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader("Content-Type", "application/octet-stream");
    createReadStream(join(folder, wanted)).pipe(response);
  };
}

export function devData(): Plugin {
  return {
    name: "megamaps-dev-data",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/@dev-data", devDataHandler(DEV_DATA_FOLDER));
    },
  };
}
