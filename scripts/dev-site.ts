import { copyFileSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Plugin } from "vite";

// The dev site (`npm run build:dev`) installs beside the released app, so it gets
// its own name and orange icons to tell the two apart on a home screen.
const NAME = "Mega Maps Dev", SHORT_NAME = "Dev Maps";
const ICONS = "assets/dev-icons";

export function devSite(): Plugin {
  return {
    name: "dev-site",
    apply: (_, { command, mode }) => command === "build" && mode === "dev",
    transformIndexHtml: (html) =>
      html
        .replace("<title>Mega Maps</title>", `<title>${NAME}</title>`)
        .replace('name="apple-mobile-web-app-title" content="Mega Maps"', `name="apple-mobile-web-app-title" content="${SHORT_NAME}"`),
    // After the public folder is copied, so these replace the released icons and manifest.
    closeBundle() {
      for (const name of readdirSync(ICONS)) copyFileSync(`${ICONS}/${name}`, `dist/icons/${name}`);
      const manifest = JSON.parse(readFileSync("dist/manifest.webmanifest", "utf8"));
      writeFileSync("dist/manifest.webmanifest", JSON.stringify({ ...manifest, name: NAME, short_name: SHORT_NAME }, null, 2));
    },
  };
}
