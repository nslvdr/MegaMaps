import { t } from "../i18n";
import { OCR_VERSION, type OcrIndex } from "../ocr/index";
import { importMap } from "../processing/import";
import { saveNavigation } from "../storage/navigation";
import { saveOcr } from "../storage/ocr";
import type { ImportProgress } from "../types";
import type { Point } from "../viewer/camera";
import { defaultNavigation, type MapMarker, type NavigationState } from "../viewer/navigation";
import { crossing, features, METRES_PER_UNIT, PLAN_HEIGHT, PLAN_WIDTH, planMarkup, planTexts, textWidth } from "./plan";

// New users get the example plan as a real map: its image, places of every
// kind, a route, the scale, and its printed names already searchable.

/** Image pixels per plan unit: sharp when zoomed in, and under the 16 MP phones can draw at once. */
export const EXAMPLE_SCALE = 3;
const pixel = ({ x, y }: Point) => ({ x: x * EXAMPLE_SCALE, y: y * EXAMPLE_SCALE });

type Place = Pick<MapMarker, "kind" | "label" | "water" | "danger"> & { at: Point; description?: string };
const places = (): Place[] => [
  { kind: "entrance", label: "Escalier des carriers", at: features.stairs, description: t("The way in. Tap Edit to change a place, or hold the map anywhere to add your own.") },
  { kind: "shaft", label: "Puits d’extraction", at: features.well, description: t("Stone went up here. It’s capped at the top.") },
  { kind: "tools", label: "Wagonnet", at: crossing(-2.5, -9), description: t("An old cart left on the rails of the Grande Voie.") },
  { kind: "graffiti", label: "Fresque du chat", at: crossing(2, -6), description: t("A big black cat painted on a pillar.") },
  { kind: "passage", label: "Chatière", at: features.chatiere, description: t("A tight crawl through the dry-stone wall.") },
  { kind: "sculpture", label: "Le gardien", at: features.sculpture, description: t("A soldier carved into the quarry wall, just past the junction.") },
  { kind: "flooded", label: "Lac", at: features.lake, water: 2 },
  { kind: "room", label: "Salle Z", at: features.salleZ },
  { kind: "room", label: "Salle des fêtes", at: features.festival, description: t("A big room with benches cut in the rock.") },
  { kind: "unstable", label: "Effondrement de 1931", at: features.collapse, danger: 2, description: t("The ceiling came down. Go round it.") },
  { kind: "squat", label: "Salle basse", at: features.lowRoom, description: t("A dry spot to sit and eat.") },
];
/** From the old quarry along the Grande Voie, then down to Salle Z. */
const walk = [{ x: 330, y: 470 }, crossing(-1, -9), crossing(-1, 1), crossing(2, 1)];

/** The example's places, route and scale, on a map with this id. */
export function exampleNavigation(mapId: string, now = Date.now()): NavigationState {
  return {
    ...defaultNavigation(mapId),
    metresPerPixel: METRES_PER_UNIT / EXAMPLE_SCALE,
    markers: places().map(({ at, description = "", ...place }, i) => ({ ...place, id: `example-${i}`, point: pixel(at), description, created: now })),
    routes: [{ id: "example-walk", name: t("Discovery walk"), points: walk.map(pixel), created: now, draft: false }],
  };
}

/** The names printed on the plan, where they are on the map's image, as text detection would find them. */
export function exampleOcr(mapId: string, now = Date.now()): OcrIndex {
  const lines = planTexts.map(({ text, at, angle, size }) => {
    const turn = (angle * Math.PI) / 180, letter = textWidth({ text: "x", size });
    const place = (x: number, y: number) => pixel({ x: at.x + x * Math.cos(turn) - y * Math.sin(turn), y: at.y + x * Math.sin(turn) + y * Math.cos(turn) });
    let start = -textWidth({ text, size }) / 2;
    const words = text.split(" ").map((word) => {
      const left = start, right = start + word.length * letter;
      start = right + letter;
      return { text: word, polygon: [place(left, -size / 2), place(right, -size / 2), place(right, size / 2), place(left, size / 2)] };
    });
    return { text, confidence: 100, words };
  });
  return { mapId, version: OCR_VERSION, completedAt: now, lines };
}

/** Draws the plan into a JPEG, as if it had been scanned. */
async function scan() {
  const width = PLAN_WIDTH * EXAMPLE_SCALE, height = PLAN_HEIGHT * EXAMPLE_SCALE;
  const url = URL.createObjectURL(new Blob([planMarkup(width)], { type: "image/svg+xml" }));
  const canvas = document.createElement("canvas");
  try {
    const image = new Image(width, height);
    image.src = url;
    await image.decode();
    Object.assign(canvas, { width, height });
    canvas.getContext("2d")!.drawImage(image, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(t("Could not prepare the example map.")))), "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(url);
    // Phones hold on to a big canvas's memory until it's shrunk.
    Object.assign(canvas, { width: 0, height: 0 });
  }
}

/** Adds the example map to the library. */
export async function addExampleMap(signal: AbortSignal, onProgress: (progress: ImportProgress) => void = () => {}) {
  const image = await scan();
  const map = await importMap(new File([image], `${t("Val Moulin (example)")}.jpg`, { type: "image/jpeg" }), onProgress, signal);
  await saveNavigation(exampleNavigation(map.id));
  await saveOcr(exampleOcr(map.id));
  return map;
}
