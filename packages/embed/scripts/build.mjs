/** Bundles the <script> build as a minified IIFE and copies it to the app's public/embed.js. */
import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const outfile = `${packageDir}dist/embed.js`;
const appPublicDir = `${packageDir}../../public/`;

await build({
  entryPoints: [`${packageDir}src/embed.ts`],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: ["es2020"],
  legalComments: "none",
});

await mkdir(appPublicDir, { recursive: true });
await copyFile(outfile, `${appPublicDir}embed.js`);
