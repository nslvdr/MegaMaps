/** The value below which this share of the samples falls, between neighbours. */
export function quantile(samples: number[], share: number) {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (sorted.length - 1) * share, below = Math.floor(at);
  return sorted[below]! + (sorted[Math.min(below + 1, sorted.length - 1)]! - sorted[below]!) * (at - below);
}
export const median = (samples: number[]) => quantile(samples, 0.5);

/** How many ways each Mann–Whitney U can arise from samples of these sizes. */
function uCounts(n: number, m: number): number[] {
  let row = Array.from({ length: m + 1 }, () => [1]);
  for (let i = 1; i <= n; i++) {
    const next: number[][] = [[1]];
    for (let j = 1; j <= m; j++) {
      // The largest value is in the first sample, adding j to U, or in the second.
      const a = row[j]!, b = next[j - 1]!;
      next[j] = Array.from({ length: i * j + 1 }, (_, u) => (u >= j ? a[u - j] ?? 0 : 0) + (b[u] ?? 0));
    }
    row = next;
  }
  return row[m]!;
}

/** The chance of samples this far apart when both come from the same
 * distribution: an exact two-sided Mann–Whitney test, ties ranked midway. */
export function differenceChance(a: number[], b: number[]) {
  const all = [...a.map((value) => ({ value, first: true })), ...b.map((value) => ({ value, first: false }))]
    .sort((x, y) => x.value - y.value);
  let rankSum = 0;
  for (let i = 0; i < all.length; ) {
    let j = i;
    while (j < all.length && all[j]!.value === all[i]!.value) j++;
    const rank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (all[k]!.first) rankSum += rank;
    i = j;
  }
  const u = Math.round(rankSum - (a.length * (a.length + 1)) / 2);
  const counts = uCounts(a.length, b.length), total = counts.reduce((sum, count) => sum + count, 0);
  const atMost = counts.slice(0, u + 1).reduce((sum, count) => sum + count, 0);
  const atLeast = counts.slice(u).reduce((sum, count) => sum + count, 0);
  return Math.min(1, (2 * Math.min(atMost, atLeast)) / total);
}

/** Each chance made fit for testing these many numbers at once
 * (Benjamini–Hochberg), so one comparison of a dozen numbers rarely calls a
 * change in any of them by luck. */
export function adjustedChances(chances: number[]) {
  const order = chances.map((chance, index) => ({ chance, index })).sort((a, b) => b.chance - a.chance);
  const adjusted = [...chances];
  let lowest = 1;
  order.forEach(({ chance, index }, i) => {
    lowest = Math.min(lowest, (chance * chances.length) / (chances.length - i));
    adjusted[index] = lowest;
  });
  return adjusted;
}

export type Verdict = "faster" | "slower" | "same";
/** Lower is better. A change counts when it is unlikely to be chance and big
 * enough to matter: over 1%, and over the smallest step the number moves in,
 * such as a frame. Otherwise it is the noise between runs. */
export function verdict(base: number[], next: number[], chance: number, step = 0): Verdict {
  const change = median(next) - median(base);
  if (Math.abs(change) <= Math.max(0.01 * median(base), step) || chance >= 0.05) return "same";
  return change < 0 ? "faster" : "slower";
}
