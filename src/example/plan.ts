import { darkMode } from "../viewer/appearance";
import type { Point } from "../viewer/camera";

// The example map: a made-up quarry surveyed like the real plans people
// bring, room-and-pillar sectors on paper with named galleries, a haulage way,
// wells, water, a collapse and the surveyor's labels. It's generated, always
// the same, and drawn as a paper scan; the app darkens it like any other map.
// The tutorials play over it and new users get it as a map to try things on.

export const PLAN_WIDTH = 1200;
export const PLAN_HEIGHT = 1400;
/** The scale bar's 80 plan units are 20 m. */
export const METRES_PER_UNIT = 0.25;
/** How the app darkens a plan on paper like this one. */
export const PLAN_DARK = darkMode({ background: 0.99, ink: 0.12, light: true }).filter;

const INK = "#231f17";
const PAPER = "#f3eedb";
const FLOOR = "#fffcf2";
const ROCK = "#c9bb6b";
const WATER = "#9fcde2";
const FAINT = "#aaa18c";
const SERIF = "Georgia, 'Times New Roman', serif";

/** A seeded random source, so the plan comes out the same everywhere. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const n = (value: number) => Math.round(value * 10) / 10;
const path = (points: Point[], close = true) => `M${points.map((p) => `${n(p.x)} ${n(p.y)}`).join("L")}${close ? "Z" : ""}`;
const add = (a: Point, b: Point, scale = 1): Point => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
const direction = (degrees: number): Point => ({ x: Math.cos((degrees * Math.PI) / 180), y: Math.sin((degrees * Math.PI) / 180) });
const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** A quarry's pillars stand on a grid: galleries cross at whole indices, pillars sit between. */
export interface Grid {
  origin: Point;
  /** The direction rows run in, in degrees clockwise from east. */
  angle: number;
  pitch: [number, number];
  pillar: [number, number];
}
export const gridPoint = ({ origin, angle, pitch }: Grid, i: number, j: number) =>
  add(add(origin, direction(angle), i * pitch[0]), direction(angle + 90), j * pitch[1]);

/** The main sector, where the tutorials play: Allée 25 is column 0, Allée 55 row 0. */
export const mainGrid: Grid = { origin: { x: 627, y: 700 }, angle: -6, pitch: [36, 28], pillar: [24, 16] };
export const crossing = (i: number, j: number) => gridPoint(mainGrid, i, j);
/** The haulage way runs along this row of the main grid. */
const HAULAGE_ROW = -9;

function inside(polygon: Point[], { x, y }: Point) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** Hand-cut walls: each edge is split and nudged so no outline is ruler-straight. */
function rough(points: Point[], seed: number, wobble = 4) {
  const next = random(seed);
  let drift = 0;
  return points.flatMap((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.round(length / 14));
    const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    return Array.from({ length: steps }, (_, s) => {
      drift = Math.max(-wobble, Math.min(wobble, drift + (next() - 0.5) * wobble));
      return add({ x: a.x + ((b.x - a.x) * s) / steps, y: a.y + ((b.y - a.y) * s) / steps }, normal, s ? drift : 0);
    });
  });
}

interface Sector {
  grid: Grid;
  outline: Point[];
  seed: number;
  /** Pillar index ranges [i0, j0, i1, j1] left open: rooms, water, collapses. */
  open?: Range[];
  /** Ranges of rock never quarried. */
  masses?: Range[];
  /** Ranges whose galleries were filled back in. */
  backfill?: Range[];
  /** A row of galleries cut wider, for the haulage way. */
  wide?: number;
}
type Range = [number, number, number, number];

// The seam between the main quarry's two workings, each drawn 14 units off it.
const seam = [{ x: 830, y: 150 }, { x: 812, y: 330 }, { x: 830, y: 520 }, { x: 808, y: 720 }, { x: 836, y: 900 }, { x: 812, y: 1100 }, { x: 842, y: 1284 }];
const beside = (side: number) => seam.map(({ x, y }) => ({ x: x + side * 14, y }));
export const eastGrid: Grid = { origin: { x: 980, y: 700 }, angle: 24, pitch: [30, 30], pillar: [20, 20] };
const oldGrid: Grid = { origin: { x: 190, y: 300 }, angle: 32, pitch: [30, 30], pillar: [19, 19] };
const lowGrid: Grid = { origin: { x: 200, y: 1060 }, angle: 14, pitch: [34, 26], pillar: [22, 15] };

const sectors: Sector[] = [
  {
    grid: mainGrid,
    seed: 11,
    outline: [
      { x: 590, y: 372 }, { x: 604, y: 250 }, { x: 690, y: 182 }, ...beside(-1),
      { x: 650, y: 1300 }, { x: 476, y: 1238 }, { x: 392, y: 1090 }, { x: 338, y: 900 },
      { x: 366, y: 700 }, { x: 440, y: 606 }, { x: 540, y: 520 },
    ],
    open: [[1, 0, 2, 1], [-6, 3, -4, 5], [-2, 12, -1, 14]],
    masses: [[-7, 6, -6, 8], [0, -16, 2, -15], [1, 15, 3, 17], [-5, 13, -4, 16]],
    backfill: [[0, 9, 3, 12], [1, -14, 4, -12], [-6, -4, -5, -1]],
    wide: HAULAGE_ROW,
  },
  {
    grid: eastGrid,
    seed: 17,
    outline: [beside(1)[0]!, { x: 1000, y: 196 }, { x: 1110, y: 310 }, { x: 1150, y: 520 }, { x: 1112, y: 760 },
      { x: 1146, y: 980 }, { x: 1066, y: 1190 }, { x: 930, y: 1262 }, ...beside(1).slice(1).reverse()],
    open: [[-7, -12, -5, -10], [0, 4, 4, 8]],
    masses: [[3, -6, 5, -4], [-1, 13, 1, 15], [5, 4, 6, 7]],
    backfill: [[-2, -2, 1, 1], [-8, 2, -6, 5]],
  },
  {
    grid: oldGrid,
    seed: 23,
    outline: [
      { x: 60, y: 150 }, { x: 170, y: 70 }, { x: 300, y: 100 }, { x: 380, y: 210 }, { x: 352, y: 380 },
      { x: 300, y: 500 }, { x: 170, y: 560 }, { x: 70, y: 470 }, { x: 40, y: 300 },
    ],
    open: [[-1, -1, 0, 0]],
    masses: [[2, -5, 3, -3]],
  },
  {
    grid: lowGrid,
    seed: 37,
    outline: [
      { x: 70, y: 930 }, { x: 190, y: 880 }, { x: 300, y: 920 }, { x: 330, y: 1060 }, { x: 290, y: 1220 },
      { x: 200, y: 1320 }, { x: 90, y: 1290 }, { x: 46, y: 1120 },
    ],
    open: [[0, 1, 1, 2]],
    backfill: [[-3, 4, -1, 7]],
  },
];
const within = (ranges: Range[] | undefined, i: number, j: number) =>
  ranges?.some(([i0, j0, i1, j1]) => i >= i0 && i <= i1 && j >= j0 && j <= j1);
/** The ground a range of pillars covers, galleries round it included. */
const area = (grid: Grid, [i0, j0, i1, j1]: Range, seed: number, wobble = 3) =>
  rough([gridPoint(grid, i0 + 0.15, j0 + 0.15), gridPoint(grid, i1 + 0.85, j0 + 0.15), gridPoint(grid, i1 + 0.85, j1 + 0.85), gridPoint(grid, i0 + 0.15, j1 + 0.85)], seed, wobble);

interface Pillar { points: Point[]; i: number; j: number }

function pillars(sector: Sector, outline: Point[]) {
  const { grid } = sector;
  const next = random(sector.seed);
  const u = direction(grid.angle), v = direction(grid.angle + 90);
  const open = (i: number, j: number) => within(sector.open, i, j) || within(sector.masses, i, j);
  const taken = new Set<string>();
  const found: Pillar[] = [];
  for (let i = -40; i < 40; i++)
    for (let j = -60; j < 60; j++) {
      if (taken.has(`${i},${j}`) || open(i, j)) continue;
      const center = gridPoint(grid, i + 0.5, j + 0.5);
      if (!inside(outline, center)) continue;
      const roll = next();
      // Some pillars were taken out, some were left long.
      if (roll < 0.04) continue;
      const long = roll > 0.9 && !open(i + 1, j) && inside(outline, gridPoint(grid, i + 1.5, j + 0.5));
      if (long) taken.add(`${i + 1},${j}`);
      const half = [(grid.pillar[0] * (0.88 + next() * 0.2) + (long ? grid.pitch[0] : 0)) / 2, (grid.pillar[1] * (0.85 + next() * 0.25)) / 2];
      // Pillars beside the haulage way give up 3 units on its side.
      const widen = j === (sector.wide ?? NaN) - 1 ? -1.5 : j === sector.wide ? 1.5 : 0;
      half[1] = half[1]! - Math.abs(widen);
      const middle = add(long ? gridPoint(grid, i + 1, j + 0.5) : center, v, widen);
      const corner = (a: number, b: number) =>
        add(add(add(middle, u, a * half[0]!), v, b * half[1]!), { x: next() - 0.5, y: next() - 0.5 }, 2.4);
      found.push({ i, j, points: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)] });
    }
  return found;
}

/** Printed words: also what text search finds on the example map. */
export interface PlanText {
  text: string;
  at: Point;
  angle: number;
  size: number;
}
/** How wide printed text runs, near enough for search boxes. */
export const textWidth = ({ text, size }: Pick<PlanText, "text" | "size">) => text.length * size * 0.54;

// Gallery names, printed along their gallery and never upside down.
const along = (text: string, at: Point, angle: number): PlanText =>
  ({ text, at, angle: ((angle + 270) % 180) - 90, size: 10 });
const eastPoint = (i: number, j: number) => gridPoint(eastGrid, i, j);
export const galleryNames: PlanText[] = [
  along("Allée 25", crossing(0, -5), 84),
  along("Allée 25", crossing(0, 3.5), 84),
  along("Allée 55", crossing(-1.4, 0), -6),
  along("Allée 12", crossing(-5, 0.5), 84),
  along("Allée 30", crossing(2.5, -7), -6),
  along("Allée 70", crossing(2.5, 8), -6),
  along("Allée 40", crossing(-6, 11.5), 84),
  along("Galerie de la Croix", eastPoint(2, -3), 114),
  along("Galerie Neuve", eastPoint(-2.5, 3), 24),
  along("Grande Voie", crossing(-1.5, HAULAGE_ROW), -6),
];

// Points the surveyor marked, by their labels.
export const features = {
  /** The haulage way's well, where stone went up. */
  well: crossing(4, HAULAGE_ROW),
  airShaft: crossing(-3, -2),
  salleZ: crossing(2, 1),
  festival: eastPoint(-5.5, -10.5),
  lake: crossing(-4.5, 4.5),
  collapse: eastPoint(2.5, 6.5),
  sculpture: crossing(-3, 2),
  /** The crawl left through the hague across Allée 25. */
  chatiere: crossing(0, -2.5),
  stairs: { x: 76, y: 456 },
  oldWell: gridPoint(oldGrid, 0, 0),
  lowRoom: gridPoint(lowGrid, 1, 2),
};

/** The scale bar's two ends: 80 units, or 20 m. */
export const scaleBar: [Point, Point] = [{ x: 404, y: 404 }, { x: 484, y: 404 }];

/** A label boxed like a surveyor's, with an arrow to what it names. */
function boxed(text: string, at: Point, to: Point, size = 11) {
  const width = textWidth({ text, size }) + 10, height = size + 8;
  const edge = { x: Math.max(at.x - width / 2, Math.min(to.x, at.x + width / 2)), y: to.y < at.y ? at.y - height / 2 : at.y + height / 2 };
  const length = Math.hypot(to.x - edge.x, to.y - edge.y), unit = { x: (to.x - edge.x) / length, y: (to.y - edge.y) / length };
  const back = add(to, unit, -6), side = { x: -unit.y * 2.4, y: unit.x * 2.4 };
  return `<path d="M${n(edge.x)} ${n(edge.y)}L${n(back.x)} ${n(back.y)}" stroke="${INK}" stroke-width="0.9"/><path d="${path([to, add(back, side), add(back, side, -1)])}" fill="${INK}"/>`
    + `<rect x="${n(at.x - width / 2)}" y="${n(at.y - height / 2)}" width="${n(width)}" height="${height}" fill="${FLOOR}" stroke="${INK}" stroke-width="0.9"/>`;
}

export const boxedLabels: (PlanText & { to: Point })[] = [
  { text: "Salle Z", at: add(features.salleZ, { x: 64, y: -48 }), to: features.salleZ, angle: 0, size: 11 },
  { text: "Salle des fêtes", at: add(features.festival, { x: 40, y: -60 }), to: features.festival, angle: 0, size: 11 },
  { text: "Sculpture", at: add(features.sculpture, { x: 60, y: 30 }), to: features.sculpture, angle: 0, size: 11 },
  { text: "Escalier des carriers", at: { x: 120, y: 604 }, to: features.stairs, angle: 0, size: 11 },
  { text: "Salle basse", at: add(features.lowRoom, { x: 80, y: 70 }), to: features.lowRoom, angle: 0, size: 11 },
];
const notes: PlanText[] = [
  { text: "Lac", at: features.lake, angle: -6, size: 11 },
  { text: "Effondrement de 1931", at: add(features.collapse, { x: 0, y: 4 }), angle: 24, size: 11 },
  { text: "Puits d’extraction", at: add(features.well, { x: 0, y: -22 }), angle: -6, size: 9 },
  { text: "Puits d’aérage", at: add(features.airShaft, { x: 0, y: -14 }), angle: -6, size: 9 },
  { text: "Ancienne carrière", at: { x: 210, y: 46 }, angle: -6, size: 14 },
  { text: "Carrière basse", at: { x: 186, y: 860 }, angle: 8, size: 14 },
  { text: "Rails", at: { x: 480, y: 444 }, angle: -6, size: 9 },
];
/** Every name printed on the plan, for text search. */
export const planTexts: PlanText[] = [...galleryNames, ...boxedLabels, ...notes];

const printed = ({ text, at, angle, size }: PlanText, extra = "") =>
  `<text transform="translate(${n(at.x)} ${n(at.y)}) rotate(${angle})" y="${n(size * 0.35)}" font-size="${size}" text-anchor="middle"${extra}>${escape(text)}</text>`;

/** A gallery cut straight through rock to join two workings, from a crossing to a crossing. */
export interface Way { points: Point[]; width: number }
export const ways: Way[] = [
  // The haulage way: out of the old quarry, then along a widened row to the extraction well.
  { points: [gridPoint(oldGrid, 6, 3), crossing(-8, HAULAGE_ROW), crossing(4, HAULAGE_ROW)], width: 12 },
  { points: [gridPoint(lowGrid, 2, -4), crossing(-7, 9)], width: 10 },
  { points: [crossing(5, -4), gridPoint(eastGrid, -5, -2)], width: 9 },
  { points: [crossing(4, 4), gridPoint(eastGrid, -2, 5)], width: 9 },
  { points: [crossing(3, 11), gridPoint(eastGrid, 1, 11)], width: 9 },
];
const distance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const along = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - along * dx, p.y - a.y - along * dy);
};
/** Whether a point is on a way's floor. */
export const onWay = (p: Point, { points, width }: Way) => points.slice(1).some((b, k) => distance(p, points[k]!, b) <= width / 2);
// A pillar a way runs into was cut away: its edges and middle are sampled.
const inWay = ({ points }: Pillar) => points.some((a, k) => {
  const b = points[(k + 1) % points.length]!;
  return [0, 0.25, 0.5, 0.75].some((t) => ways.some((way) => onWay({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, way)));
});

// Hagues: dry-stone walls across galleries. This one shuts three galleries
// but leaves a crawl through Allée 25, the chatière.
const across = (i: number) => [crossing(i - 0.3, -2.5), crossing(i + 0.3, -2.5)] as [Point, Point];
export const hagues: [Point, Point][] = [
  [crossing(-0.3, -2.5), crossing(-0.08, -2.5)], [crossing(0.08, -2.5), crossing(0.3, -2.5)], across(1), across(2),
];
export const HAGUE_WIDTH = 3.4;

/** Where everything stands, worked out once. */
export const layout = (() => {
  let built: ReturnType<typeof build> | undefined;
  function build() {
    const outlines = sectors.map((sector) => rough(sector.outline, sector.seed));
    return {
      outlines,
      pillars: sectors.map((sector, k) => pillars(sector, outlines[k]!).filter((pillar) => !inWay(pillar))),
      masses: sectors.map((sector, k) => (sector.masses ?? []).map((range, m) => area(sector.grid, range, k * 10 + m))),
    };
  }
  return () => (built ??= build());
})();

function rails(points: Point[]) {
  return points.slice(1).map((to, k) => railway(points[k]!, to)).join("");
}
function railway(from: Point, to: Point) {
  const length = Math.hypot(to.x - from.x, to.y - from.y), u = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const side = { x: -u.y * 2.5, y: u.x * 2.5 };
  const ties = Array.from({ length: Math.floor(length / 7) }, (_, k) => {
    const at = add(from, u, k * 7 + 3.5);
    return `M${n(at.x + side.x * 1.6)} ${n(at.y + side.y * 1.6)}L${n(at.x - side.x * 1.6)} ${n(at.y - side.y * 1.6)}`;
  }).join("");
  return `<path d="${ties}" stroke="${INK}" stroke-width="0.6"/><path d="${path([add(from, side), add(to, side)], false)}${path([add(from, side, -1), add(to, side, -1)], false)}" stroke="${INK}" stroke-width="0.8" fill="none"/>`;
}

function well(at: Point, radius = 6) {
  return `<circle cx="${n(at.x)}" cy="${n(at.y)}" r="${radius}" fill="${FLOOR}" stroke="${INK}" stroke-width="1.2"/><path d="M${n(at.x - radius * 0.7)} ${n(at.y - radius * 0.7)}L${n(at.x + radius * 0.7)} ${n(at.y + radius * 0.7)}M${n(at.x + radius * 0.7)} ${n(at.y - radius * 0.7)}L${n(at.x - radius * 0.7)} ${n(at.y + radius * 0.7)}" stroke="${INK}" stroke-width="1"/>`;
}

// Streets above, faint like on the real surveys; only the open ground shows them.
const streets: [string, Point[], Point, number][] = [
  ["RUE DU MOULIN", [{ x: -10, y: 660 }, { x: 330, y: 620 }, { x: 700, y: 560 }, { x: 1210, y: 470 }], { x: 220, y: 625 }, -7],
  ["CHEMIN DES CARRIERS", [{ x: 470, y: -10 }, { x: 520, y: 400 }, { x: 430, y: 820 }, { x: 380, y: 1410 }], { x: 452, y: 760 }, 97],
  ["ROUTE DU VAL", [{ x: -10, y: 1360 }, { x: 600, y: 1340 }, { x: 1210, y: 1240 }], { x: 900, y: 1338 }, -8],
];
function surface() {
  return streets.map(([name, points, at, angle]) =>
    `<path d="${path(points, false)}" fill="none" stroke="${FAINT}" stroke-width="16" stroke-opacity="0.22"/><path d="${path(points, false)}" fill="none" stroke="${FAINT}" stroke-width="0.8" stroke-dasharray="6 4"/>`
    + printed({ text: name, at, angle, size: 9 }, ` fill="${FAINT}" letter-spacing="2"`)).join("");
}

function titleBlock() {
  const x = 770, y = 24;
  return `<g font-family="${SERIF}" fill="${INK}"><rect x="${x}" y="${y}" width="400" height="104" fill="${FLOOR}" stroke="${INK}" stroke-width="1.6"/><rect x="${x + 5}" y="${y + 5}" width="390" height="94" fill="none" stroke="${INK}" stroke-width="0.6"/>
<text x="${x + 200}" y="${y + 38}" font-size="24" text-anchor="middle" letter-spacing="2">CARRIÈRE DU VAL MOULIN</text>
<text x="${x + 200}" y="${y + 60}" font-size="12" text-anchor="middle" font-style="italic">Plan d’ensemble des galeries · relevé 1904, complété 2026</text>
<text x="${x + 200}" y="${y + 84}" font-size="10" text-anchor="middle" fill="#6b6352">Plan d’exemple de Mega Maps : lieux imaginaires</text></g>`;
}

function legend() {
  const x = 942, y = 1296, row = (k: number) => y + 26 + k * 17;
  const pillar = (k: number) => `<rect x="${x + 12}" y="${row(k) - 5}" width="16" height="10" fill="${ROCK}" stroke="${INK}" stroke-width="0.8"/>`;
  const item = (k: number, text: string) => `<text x="${x + 38}" y="${row(k) + 4}" font-size="10">${text}</text>`;
  return `<g font-family="${SERIF}" fill="${INK}"><rect x="${x}" y="${y}" width="230" height="84" fill="${FLOOR}" stroke="${INK}" stroke-width="1"/><text x="${x + 115}" y="${y + 14}" font-size="10" text-anchor="middle" letter-spacing="2">LÉGENDE</text>
${pillar(0)}${item(0, "Pilier tourné")}${well({ x: x + 20, y: row(1) })}${item(1, "Puits")}<rect x="${x + 12}" y="${row(2) - 5}" width="16" height="10" fill="${WATER}"/>${item(2, "Eau")}
<rect x="${x + 125}" y="${row(0) - 5}" width="16" height="10" fill="${FLOOR}" stroke="${INK}" stroke-width="0.6"/><path d="M${x + 125} ${row(0) + 5}l10-10M${x + 131} ${row(0) + 5}l10-10" stroke="${INK}" stroke-width="0.6"/><text x="${x + 150}" y="${row(0) + 4}" font-size="10">Effondrement</text>
<path d="M${x + 125} ${row(1)}h16" stroke="${INK}" stroke-width="3"/><text x="${x + 150}" y="${row(1) + 4}" font-size="10">Hague</text></g>`;
}

function compass([left, right]: [Point, Point]) {
  const x = 556, y = 420;
  return `<g fill="${INK}" font-family="${SERIF}"><path d="M${x} ${y - 26}l6 22-6-5-6 5z"/><text x="${x}" y="${y + 8}" font-size="12" text-anchor="middle">N</text>
<path d="M${left.x} ${left.y - 5}v5h${right.x - left.x}v-5M${(left.x + right.x) / 2} ${left.y}v-3" fill="none" stroke="${INK}" stroke-width="1.2"/><rect x="${left.x}" y="${left.y - 2}" width="${(right.x - left.x) / 2}" height="2"/>
<text x="${left.x}" y="${left.y - 9}" font-size="10" text-anchor="middle">0</text><text x="${right.x}" y="${right.y - 9}" font-size="10" text-anchor="middle">20 m</text></g>`;
}

// Printed text sits on a halo of floor, so it reads over pillars.
const inked = (texts: string) =>
  `<g fill="${FLOOR}" stroke="${FLOOR}" stroke-width="3" stroke-linejoin="round">${texts}</g><g fill="${INK}">${texts}</g>`;

let instances = 0;
/** The plan as SVG markup, `width` wide; `view` frames part of it. */
export function planMarkup(width = PLAN_WIDTH, view = `0 0 ${PLAN_WIDTH} ${PLAN_HEIGHT}`) {
  const id = `plan-${++instances}`;
  const [, , viewWidth, viewHeight] = view.split(" ").map(Number);
  const height = Math.round((width * viewHeight!) / viewWidth!);
  const { outlines, pillars, masses } = layout();
  const walls = outlines.map((outline) => path(outline)).join("");
  const big = `x="-400" y="-400" width="${PLAN_WIDTH + 800}" height="${PLAN_HEIGHT + 800}"`;
  // Ways draw their walls only through the rock between workings, and open
  // the workings' walls where they go in.
  const masks = `<mask id="${id}-rock" maskUnits="userSpaceOnUse" ${big}><rect ${big} fill="#fff"/><path d="${walls}" fill="#000"/></mask>`
    + `<mask id="${id}-entry" maskUnits="userSpaceOnUse" ${big}><rect ${big} fill="#fff"/><path d="${walls}" fill="#000"/><path d="${walls}" fill="none" stroke="#fff" stroke-width="6"/></mask>`;
  const way = (color: string, extra: number) => ways.map(({ points, width }) =>
    `<path d="${path(points, false)}" fill="none" stroke="${color}" stroke-width="${width + extra}" stroke-linejoin="round"/>`).join("");
  const hatch = `<pattern id="${id}-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0v6" stroke="${INK}" stroke-width="0.7"/></pattern>`;
  const stipple = `<pattern id="${id}-fill" width="5" height="5" patternUnits="userSpaceOnUse"><rect width="5" height="5" fill="#d5d0c2"/><circle cx="1.5" cy="1.5" r="0.6" fill="#8f8875"/></pattern>`;
  const collapse = rough([eastPoint(0.2, 4.4), eastPoint(3, 3.8), eastPoint(5.2, 5.6), eastPoint(4.6, 8.8), eastPoint(1.6, 9.4), eastPoint(-0.4, 7.4)], 5, 6);
  const lake = rough([crossing(-6.4, 2.8), crossing(-3.6, 2.8), crossing(-2.6, 4.6), crossing(-3.6, 6.2), crossing(-6.3, 5.8)], 9, 3);
  const pool = rough([crossing(-2, 12.1), crossing(-0.1, 12.1), crossing(0, 15), crossing(-2, 14.9)], 13, 2);
  const backfill = sectors.map((sector, k) => (sector.backfill ?? []).map((range, m) => path(area(sector.grid, range, k * 20 + m, 5))).join(""));
  const numbers = pillars[0]!
    .filter(({ i, j }) => (j === -1 && i % 2 === 0 && i > -6 && i < 4) || (i === 1 && j % 2 === 1 && j > -8 && j < 12 && j !== 1))
    .map(({ i, j }) => printed({ text: `${i === 1 ? 40 + j : 20 + i}′`, at: gridPoint(mainGrid, i + 0.5, j + 0.5), angle: -6, size: 7 }));
  const stairs = features.stairs;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}" width="${width}" height="${height}" font-family="${SERIF}">
<defs>${hatch}${stipple}${masks}${outlines.map((outline, k) => `<clipPath id="${id}-${k}"><path d="${path(outline)}"/></clipPath>`).join("")}</defs>
<rect x="-400" y="-400" width="${PLAN_WIDTH + 800}" height="${PLAN_HEIGHT + 800}" fill="${PAPER}"/>${surface()}
${outlines.map((outline) => `<path d="${path(outline)}" fill="none" stroke="${ROCK}" stroke-width="14" stroke-linejoin="round"/>`).join("")}${way(ROCK, 12)}
${outlines.map((outline) => `<path d="${path(outline)}" fill="${FLOOR}"/>`).join("")}
${backfill.map((d, k) => `<path clip-path="url(#${id}-${k})" d="${d}" fill="url(#${id}-fill)"/>`).join("")}<path d="${path(lake)}${path(pool)}" fill="${WATER}"/>
${pillars.map((found, k) => `<g clip-path="url(#${id}-${k})" fill="${ROCK}" stroke="${INK}" stroke-width="0.9">${found.map(({ points }) => `<path d="${path(points)}"/>`).join("")}<path d="${masses[k]!.map((mass) => path(mass)).join("")}" stroke-width="1.2"/></g>`).join("")}
<path d="${walls}" fill="none" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
<g mask="url(#${id}-rock)">${way(INK, 2)}</g><g mask="url(#${id}-entry)">${way(FLOOR, 0)}</g>${rails(ways[0]!.points)}
<path d="${path(collapse)}" fill="${FLOOR}"/><path d="${path(collapse)}" fill="url(#${id}-hatch)" stroke="${INK}" stroke-width="1" stroke-dasharray="4 2"/><path d="${hagues.map(([a, b]) => path([a, b], false)).join("")}" stroke="${INK}" stroke-width="${HAGUE_WIDTH}"/>
${well(features.well, 8)}${well(features.airShaft)}${well(features.oldWell)}
<path d="M${stairs.x - 9} ${stairs.y - 12}l18 6M${stairs.x - 11} ${stairs.y - 5}l18 6M${stairs.x - 13} ${stairs.y + 2}l18 6" stroke="${INK}" stroke-width="1.2"/>
${inked(numbers.join("") + galleryNames.map((name) => printed(name)).join("") + notes.map((note) => printed(note, note.size >= 14 ? ' font-style="italic" letter-spacing="1"' : ' font-style="italic"')).join(""))}
${boxedLabels.map(({ text, at, to, size }) => boxed(text, at, to, size)).join("")}<g fill="${INK}">${boxedLabels.map((label) => printed(label)).join("")}</g>
${compass(scaleBar)}${titleBlock()}${legend()}</svg>`;
}
