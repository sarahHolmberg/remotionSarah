// scripts/build-playground.mjs
// NEW FILE: builds mascot/playground.html (one self-contained page, published as the Claude artifact) from
// mascot/playground.template.html + mascot/playground.src.js + src/mascot/mascot.js. Run: npm run mascot:playground
import {build} from "esbuild";
import fs from "node:fs";

const THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"; // the page loads three from the CDN, it is not bundled in

const out = await build({
  entryPoints: ["mascot/playground.src.js"],
  bundle: true,
  format: "esm",
  write: false,
  plugins: [{name: "three-from-cdn", setup: (b) => b.onResolve({filter: /^three$/}, () => ({path: THREE_URL, external: true}))}],
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script"); // never end the page's script tag early
const page = fs.readFileSync("mascot/playground.template.html", "utf8").replace("/*SCRIPT*/", () => js);
fs.writeFileSync("mascot/playground.html", page);
console.log(`[build-playground] mascot/playground.html written (${(page.length / 1024).toFixed(0)} KB)`);
