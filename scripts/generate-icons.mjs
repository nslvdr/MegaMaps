import { readFile, writeFile } from "node:fs/promises";
import { createCanvas, Image } from "@napi-rs/canvas";

// The menu, favicon, and raster icons share the approved SVG as their source.
const directory = new URL("../public/icons/", import.meta.url);
const source = await readFile(new URL("icon.svg", directory));
const outputs = [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["maskable-512.png", 512],
  ["apple-touch-icon.png", 180],
];

for (const [name, size] of outputs) {
  // Rasterize at the output resolution rather than enlarging a smaller bitmap.
  const image = new Image(size, size);
  image.src = source;
  await image.decode();
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  // Platforms apply their own icon masks; raster backgrounds must be opaque.
  context.fillStyle = "#080d10";
  context.fillRect(0, 0, size, size);
  context.drawImage(image, 0, 0, size, size);
  await writeFile(new URL(name, directory), await canvas.encode("png"));
}
