// app/vite.parrot.config.ts
// NEW FILE: builds the Parrot site (app/parrot.html + app/parrot.tsx) into dist/parrot, served at /parrot/ by
// server/tasks.mjs with its own password. Run after the editor build (that one empties dist/): npm run app:build does both.
import {defineConfig} from "vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
export default defineConfig({
  root: "app",
  base: "/parrot/",
  publicDir: "parrot-static", // the home-screen icon and manifest
  plugins: [react()],
  define: {__APP_VERSION__: JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version)},
  build: {outDir: "../dist/parrot", emptyOutDir: true, rollupOptions: {input: {parrot: path.resolve(ROOT, "app/parrot.html")}}},
});
