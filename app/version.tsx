// app/version.tsx
// NEW FILE: the version line at the bottom of both pages, so you can see which build is live.
//   v1.1.0 · built 2026-10-27 14:03 UTC · remotion-render-00004-abc
// version = "version" in package.json (bump it with every change), built = when this page was built (vite build or dev server start),
// last part = the Cloud Run revision serving the page (from the server), or "dev server" in the Codespace.

import {useEffect, useState, type CSSProperties} from "react";

declare const __APP_VERSION__: string; // filled in by app/vite.config.ts
declare const __BUILD_TIME__: string;

const built = __BUILD_TIME__.replace("T", " ").slice(0, 16) + " UTC";

export const VersionTag = ({style}: {style?: CSSProperties}) => {
  const [revision, setRevision] = useState("...");
  useEffect(() => {
    fetch("/api/version")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((v: {revision: string}) => setRevision(v.revision))
      .catch((e) => setRevision(`server unknown (${e.message})`));
  }, []);
  console.log(`[Version] v${__APP_VERSION__}, built ${built}, revision ${revision}`);
  return <span style={{fontSize: 11, whiteSpace: "nowrap", ...style}}>v{__APP_VERSION__} · built {built} · {revision}</span>;
};
