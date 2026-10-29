// app/preview.tsx
// NOT NEW: existing file, changed (the preview itself moved to app/previewPanel.tsx so the editor page can show it too;
// this page still shows it on its own, e.g. in a second window)

import {createRoot} from "react-dom/client";
import {Boundary, Preview} from "./previewPanel";

console.log("[Preview] 1. file loaded, all imports resolved");

// Any crash is written on the page, not only in the console
const showCrash = (where: string, msg: string) => {
  console.error(`[Preview] CRASH (${where}):`, msg);
  const root = document.getElementById("root");
  if (root) root.innerHTML = `<pre style="color:#ff7a7a;padding:24px;white-space:pre-wrap">Preview crashed (${where}):\n${msg}</pre>`;
};
window.addEventListener("error", (e) => showCrash("window error", `${e.message}\n${e.error?.stack ?? ""}`));
window.addEventListener("unhandledrejection", (e) => showCrash("unhandled promise", String((e.reason && e.reason.stack) || e.reason)));

const rootEl = document.getElementById("root");
console.log(`[Preview] 2. mounting (root element ${rootEl ? "found" : "MISSING: preview.html has no <div id=root>"})`);
createRoot(rootEl!).render(
  <Boundary>
    <Preview />
  </Boundary>
);
