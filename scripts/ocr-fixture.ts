import { createCanvas, loadImage } from "@napi-rs/canvas";

// A synthetic quarry survey sheet with known labels: small, rotated, coloured,
// serif and italic text over galleries, pillars and a grid, saved as a JPEG.
export interface TruthLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
}

const WORDS = [
  "Rue Saint-Jacques", "Boulevard Arago", "Avenue Denfert-Rochereau", "Galerie des Fontaines",
  "Puits n° 12", "Carrefour des Morts", "Escalier", "Ossuaire", "Bassin", "Atelier",
  "Consolidation 1874", "Rue de la Tombe-Issoire", "Galerie technique", "Plan des carrières",
  "Fontis", "Hagues", "Bourrage", "Piliers tournés", "Cloche de fontis", "Regard 37",
  "Inspection Générale", "Rue d'Enfer", "Chapelle", "Sortie de secours", "Porte de Montrouge",
  "Galerie basse", "Niveau inférieur", "Banc de roche", "Calcaire grossier", "Marne",
  "Rue Dareau", "Boulevard Saint-Michel", "Impasse", "Bassin de la Samaritaine", "Crypte",
  "Salle Z", "Rue Hallé", "Passage étroit", "Éboulement", "Danger", "Accès interdit",
  "Cote 52.40", "Puits de service", "Galerie de l'Aqueduc", "Rue Schoelcher", "Musée",
  "Carrière du Val-de-Grâce", "Réservoir", "Montsouris", "Place Denfert", "Chatière",
  "Rue Liancourt", "Rue Froidevaux", "Glacière", "Cimetière", "Halle", "Égout", "Station",
  "Gare", "Pont", "IGC 1856", "N.D. des Champs", "Abbaye", "Gypse", "Fosse", "Pilier 214",
];
const FONTS = [
  "Arial", "Times New Roman", "Georgia", "Helvetica Neue", "Courier New",
  "Futura", "Verdana", "Gill Sans", "Avenir Next Condensed",
];
const COLORS = ["#111", "#1d3f8f", "#a01818", "#6b4a2b", "#2f6b2f", "#444"];
const SIZES = [11, 12, 13, 14, 16, 18, 22, 28, 36];

function random(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

export async function quarryMap(width = 3000, height = 2400, count = 170, seed = 7) {
  const rand = random(seed);
  const pick = <T>(list: T[]) => list[Math.floor(rand() * list.length)]!;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f3eedf";
  ctx.fillRect(0, 0, width, height);
  // Paper grain.
  for (let i = 0; i < width * height * 0.02; i++) {
    ctx.fillStyle = `rgba(90,70,40,${rand() * 0.15})`;
    ctx.fillRect(rand() * width, rand() * height, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.strokeStyle = "#a9c3dd";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 250) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 250) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }
  // Galleries: wide pale corridors with dark walls.
  for (let g = 0; g < 26; g++) {
    let x = rand() * width, y = rand() * height, a = rand() * Math.PI * 2;
    const points: [number, number][] = [[x, y]];
    for (let s = 0; s < 8; s++) {
      a += (rand() - 0.5) * 1.4;
      x += Math.cos(a) * 180; y += Math.sin(a) * 180;
      points.push([x, y]);
    }
    const w = 30 + rand() * 40;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath(); points.forEach(([px, py], i) => i ? ctx.lineTo(px, py) : ctx.moveTo(px, py));
    ctx.strokeStyle = "#2b2b2b"; ctx.lineWidth = w + 4; ctx.stroke();
    ctx.strokeStyle = "#fbf8ef"; ctx.lineWidth = w; ctx.stroke();
  }
  // Pillars and hatching.
  for (let p = 0; p < 260; p++) {
    const x = rand() * width, y = rand() * height, w = 10 + rand() * 40, h = 10 + rand() * 40;
    ctx.fillStyle = "#b9b2a3"; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#333"; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.beginPath();
    for (let k = -h; k < w; k += 5) { ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); }
    ctx.strokeStyle = "rgba(60,60,60,0.5)"; ctx.lineWidth = 0.7; ctx.stroke();
    ctx.restore();
  }
  const labels: TruthLabel[] = [];
  const free = (x: number, y: number, r: number) =>
    labels.every((l) => Math.hypot(l.x - x, l.y - y) > r + Math.hypot(l.width, l.height) / 2 + 6);
  // Grid coordinates along the edges, as surveyed sheets print them.
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (let x = 250; x < width; x += 250) {
    ctx.font = "12px Arial"; ctx.fillStyle = "#335";
    const text = String(x / 5);
    ctx.fillText(text, x, 14);
    const m = ctx.measureText(text);
    labels.push({ text, x, y: 14, width: m.width, height: 12, angle: 0 });
  }
  let tries = 0;
  while (labels.length < count && tries++ < 20000) {
    const text = pick(WORDS);
    const size = pick(SIZES);
    const family = pick(FONTS);
    const style = rand() < 0.2 ? "italic " : "";
    const weight = rand() < 0.35 ? "bold " : "";
    ctx.font = `${style}${weight}${size}px "${family}"`;
    const m = ctx.measureText(text);
    const r = rand();
    const angle = r < 0.4 ? 0 : r < 0.5 ? Math.PI / 2 : r < 0.6 ? -Math.PI / 2 : (rand() - 0.5) * 2 * Math.PI;
    const x = 40 + rand() * (width - 80), y = 40 + rand() * (height - 80);
    const half = m.width / 2;
    const corners = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => [
      x + Math.cos(angle) * sx * half - Math.sin(angle) * sy * size / 2,
      y + Math.sin(angle) * sx * half + Math.cos(angle) * sy * size / 2,
    ]));
    if (corners.some(([cx, cy]) => cx! < 4 || cy! < 4 || cx! > width - 4 || cy! > height - 4)) continue;
    if (!free(x, y, Math.hypot(m.width, size) / 2)) continue;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(angle);
    if (rand() < 0.1) {
      ctx.fillStyle = "#3a3a3a";
      ctx.fillRect(-half - 6, -size * 0.75, m.width + 12, size * 1.5);
      ctx.fillStyle = "#fff";
    } else if (rand() < 0.15) {
      // Halo text over busy linework.
      ctx.strokeStyle = "#f3eedf"; ctx.lineWidth = 3; ctx.strokeText(text, 0, 0);
      ctx.fillStyle = pick(COLORS);
    } else ctx.fillStyle = pick(COLORS);
    ctx.fillText(text, 0, 0);
    ctx.restore();
    labels.push({ text, x, y, width: m.width, height: size, angle });
  }
  // Scanned sheets are JPEG-compressed.
  const jpeg = await canvas.encode("jpeg", 80);
  const image = await loadImage(jpeg);
  const out = createCanvas(width, height);
  out.getContext("2d").drawImage(image, 0, 0);
  return { canvas: out, labels, jpeg };
}
