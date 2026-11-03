import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { App } from "./browser";
import { prepareFixtures } from "./fixtures";
import { adjustedChances, differenceChance, median, quantile, verdict } from "./stats";

// Times the app on this Mac, in Chrome, on maps cut from the dev backup:
//   npm run bench                         this checkout
//   npm run bench -- --against origin/dev this checkout against another version
// Options: --runs N (8), --only import,text,map, --headed to watch.
// Versions take turns run after run, so heat or a busy Mac weighs on both.

const { values: options } = parseArgs({
  options: {
    against: { type: "string" },
    runs: { type: "string", default: "8" },
    only: { type: "string" },
    headed: { type: "boolean", default: false },
  },
});
const runs = Number(options.runs);
if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs takes a whole number of runs.");
const only = options.only?.split(",");
const cache = process.env.MEGAMAPS_BENCH_CACHE ?? join(homedir(), ".cache", "megamaps-bench");
const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** A checkout of another version, kept between benches with its own packages. */
function checkout(ref: string) {
  const commit = git("rev-parse", "--verify", `${ref}^{commit}`);
  const root = join(cache, "trees", commit.slice(0, 12));
  if (!existsSync(root)) {
    console.log(`Checking out ${ref} (${commit.slice(0, 7)})…`);
    git("worktree", "add", "--detach", root, commit);
  }
  if (!existsSync(join(root, "node_modules"))) {
    console.log("Installing its packages…");
    execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root, stdio: "ignore" });
  }
  return { label: commit.startsWith(ref) ? commit.slice(0, 7) : `${ref} ${commit.slice(0, 7)}`, root };
}

const fixtures = await prepareFixtures(cache);
const versions = [
  ...(options.against ? [checkout(options.against)] : []),
  { label: "this checkout", root: process.cwd() },
];
console.log(`Maps: ${fixtures.source}`);
const apps: App[] = [];
try {
  for (const version of versions) {
    console.log(`Starting ${version.label}…`);
    apps.push(await App.start(version.root, fixtures, options.headed));
  }
  const picked = (app: App) => app.scenarios().filter((scenario) => !only || only.includes(scenario.name));
  const scenarios = apps.map(picked);
  /** Every number of every run, by version and then by what it measures. */
  const samples = apps.map(() => new Map<string, number[]>());
  const steps = new Map<string, number>();
  const crashes = apps.map(() => 0);
  const runAll = async (index: number, record: boolean) => {
    for (const scenario of scenarios[index]!) {
      const app = apps[index]!;
      // A crashed page is reopened and its run repeated, once.
      const sample = await scenario.run().catch(async (error) => {
        if (!app.crashed) throw error;
        crashes[index]!++;
        console.log(`  Chrome crashed the page of ${versions[index]!.label} in "${scenario.name}"; repeating that run.`);
        await app.recover();
        return scenario.run();
      });
      if (record)
        for (const [name, value] of Object.entries(sample)) {
          if (typeof value !== "number") steps.set(name, value.step);
          const ms = typeof value === "number" ? value : value.ms;
          samples[index]!.set(name, [...samples[index]!.get(name) ?? [], ms]);
        }
    }
  };
  // The first run compiles each module and fills the browser's caches.
  console.log("Warming up…");
  for (const index of apps.keys()) await runAll(index, false);
  for (let run = 0; run < runs; run++) {
    console.log(`Run ${run + 1} of ${runs}…`);
    // Alternating which version goes first evens out a Mac that warms up during a run.
    const order = [...apps.keys()];
    if (run % 2) order.reverse();
    for (const index of order) await runAll(index, true);
  }
  report(samples, steps, versions.map((version) => version.label));
  for (const [index, count] of crashes.entries())
    if (count) console.log(`Chrome crashed the page of ${versions[index]!.label} ${count} time${count > 1 ? "s" : ""}; those runs were repeated.`);
} finally {
  for (const app of apps) await app.close();
}

function report(samples: Map<string, number[]>[], steps: Map<string, number>, labels: string[]) {
  const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(1)} ms`);
  const names = [...samples.at(-1)!.keys()];
  const width = Math.max(...names.map((name) => name.length));
  console.log(`\nMedians of ${runs} runs:\n`);
  if (samples.length === 1) {
    for (const name of names) {
      const values = samples[0]!.get(name)!;
      const spread = (quantile(values, 0.75) - quantile(values, 0.25)) / median(values);
      console.log(`${name.padEnd(width)}  ${ms(median(values)).padStart(9)}   ±${(spread * 50).toFixed(0)}%`);
    }
    return;
  }
  console.log(`${"".padEnd(width)}  ${labels[0]!.padStart(18)}   ${labels[1]!.padStart(13)}`);
  const compared = names.filter((name) => samples[0]!.has(name));
  const chances = adjustedChances(compared.map((name) => differenceChance(samples[0]!.get(name)!, samples[1]!.get(name)!)));
  for (const name of names) {
    const base = samples[0]!.get(name), next = samples[1]!.get(name)!;
    if (!base) {
      console.log(`${name.padEnd(width)}  ${"–".padStart(18)}   ${ms(median(next)).padStart(13)}`);
      continue;
    }
    const change = median(next) / median(base) - 1;
    const call = { faster: "✓ faster", slower: "✗ slower", same: "~ noise" }[
      verdict(base, next, chances[compared.indexOf(name)]!, steps.get(name))];
    const sign = change > 0 ? "+" : "";
    console.log(`${name.padEnd(width)}  ${ms(median(base)).padStart(18)} → ${ms(median(next)).padStart(13)}  ${`${sign}${(change * 100).toFixed(0)}%`.padStart(5)}  ${call}`);
  }
  // Even runs that never overlap can be luck when few runs face many numbers.
  const clearest = differenceChance(Array.from({ length: runs }, (_, i) => i), Array.from({ length: runs }, (_, i) => runs + i));
  if (adjustedChances([clearest, ...compared.slice(1).map(() => 1)])[0]! >= 0.05)
    console.log(`\n${runs} runs each are too few to tell a change in ${compared.length} numbers from noise: use --runs 8.`);
}
