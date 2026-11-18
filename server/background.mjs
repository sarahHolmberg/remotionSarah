// server/background.mjs
// NEW FILE: the password in front of the editor's full view ("See background", app/simple.tsx).
// The browser's own login box asks for it: any username, the password is BACKGROUND_PASSWORD (a Cloud Run setting;
// "password" when it is not set). Change it in Cloud Run: Edit & deploy new revision -> Variables & Secrets.
//
//   GET /background-auth/check -> 200 with the right password, otherwise 401 (the browser shows its login box)
// It has its own path (not under /api/) so the browser keeps this login apart from the website's own password,
// and the website's password check lets it through (it checks its own password).

import crypto from "node:crypto";

export const BACKGROUND_PATH = "/background-auth/check";
const PASSWORD = process.env.BACKGROUND_PASSWORD || "password";
const hash = (s) => crypto.createHash("sha256").update(s).digest();

export const handleBackground = (req, res, url) => {
  if (url.pathname !== BACKGROUND_PATH) return false;
  const m = /^Basic (.+)$/.exec(req.headers.authorization ?? "");
  const pass = m ? Buffer.from(m[1], "base64").toString().split(":").slice(1).join(":") : null;
  const ok = pass !== null && crypto.timingSafeEqual(hash(pass), hash(PASSWORD));
  console.log(`[Background] login ${ok ? "ok" : pass === null ? "asked" : "wrong password"}`);
  res.writeHead(ok ? 200 : 401, {"Content-Type": "application/json", "Cache-Control": "no-store", ...(ok ? {} : {"WWW-Authenticate": 'Basic realm="Background"'})});
  res.end(JSON.stringify({ok}));
  return true;
};
