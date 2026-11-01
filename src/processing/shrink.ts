import type { RowConsumer } from "./png";

interface Size {
  width: number;
  height: number;
}

/**
 * Shrinks decoded rows on the way to the tiles, so a map too large to keep
 * never exists at full size in memory. Each map pixel is the average of the
 * source area it covers; only one row of sums is held per output row.
 */
export function shrinkRows(source: Size, target: Size, consume: RowConsumer): RowConsumer {
  if (source.width === target.width && source.height === target.height) return consume;
  const { width: sw, height: sh } = source, { width: tw, height: th } = target;
  // In units where a map pixel spans `sw` (or `sh`), a source pixel spans `tw`
  // (or `th`), so overlaps are whole numbers. A source pixel never spans more
  // than two map pixels.
  const column = new Uint32Array(sw), share = new Float32Array(sw), rest = new Float32Array(sw);
  for (let x = 0; x < sw; x++) {
    const start = x * tw, end = start + tw, i = Math.floor(start / sw), edge = (i + 1) * sw;
    column[x] = i;
    share[x] = (Math.min(end, edge) - start) / sw;
    rest[x] = Math.max(0, end - edge) / sw;
  }
  const line = new Float32Array(tw * 4), output = new Uint8ClampedArray(tw * 4);
  let current = new Float32Array(tw * 4), next = new Float32Array(tw * 4), row = 0;
  return async (rgba, y) => {
    line.fill(0);
    for (let x = 0; x < sw; x++) {
      const at = column[x]! * 4, a = share[x]!, b = rest[x]!, from = x * 4;
      for (let c = 0; c < 4; c++) {
        const value = rgba[from + c]!;
        line[at + c]! += value * a;
        if (b) line[at + 4 + c]! += value * b;
      }
    }
    const start = y * th, end = start + th, edge = (row + 1) * sh;
    const a = (Math.min(end, edge) - start) / sh, b = Math.max(0, end - edge) / sh;
    for (let i = 0; i < line.length; i++) {
      current[i]! += line[i]! * a;
      if (b) next[i]! += line[i]! * b;
    }
    if (end < edge) return;
    output.set(current);
    [current, next] = [next, current.fill(0)];
    await consume(output, row++);
  };
}
