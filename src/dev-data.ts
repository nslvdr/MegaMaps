import { readBackup } from "./storage/backup";

// Served by scripts/dev-data.ts during `npm run dev` only.
export async function devBackups(): Promise<{ name: string; maps: string[] }[]> {
  const response = await fetch("/@dev-data/");
  return response.ok ? response.json() : [];
}

export async function loadDevBackup(name: string) {
  const response = await fetch(`/@dev-data/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error(`Dev backup ${name} is unavailable.`);
  return readBackup(await response.blob());
}
