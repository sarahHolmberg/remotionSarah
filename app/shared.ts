// app/shared.ts
// NOT NEW: existing file, changed (adds the picture next to the video; no JSON import, DEFAULT_TEXT is empty)

// Shared by the editor tab and the preview tab
export const CHANNEL = "comic-spec"; // tabs of this site talk on this channel: {type: "json", text} | {type: "video"} | {type: "picture"}
export const STORE_KEY = "comic-spec-json"; // last good JSON, so a freshly opened preview tab has something to show
export const DEFAULT_TEXT = ""; // no built-in JSON: the user pastes it in the editor tab

// The files the user picked are kept in the browser (IndexedDB), so the other tab can read them and a reload does not lose them.
const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open("comic-video", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("files");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

type Key = "video" | "picture";

const put = async (key: Key, file: File): Promise<void> => {
  const db = await open();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(file, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  console.log(`[Shared] ${key} saved in the browser: ${file.name}, ${(file.size / 1e6).toFixed(2)} MB`);
};

const get = async (key: Key): Promise<File | null> => {
  const db = await open();
  return new Promise((res, rej) => {
    const r = db.transaction("files").objectStore("files").get(key);
    r.onsuccess = () => {
      console.log(`[Shared] ${key} read from the browser: ${r.result ? (r.result as File).name : "none"}`);
      res((r.result as File | undefined) ?? null);
    };
    r.onerror = () => rej(r.error);
  });
};

export const saveVideo = (file: File) => put("video", file);
export const loadVideo = () => get("video");
export const savePicture = (file: File) => put("picture", file);
export const loadPicture = () => get("picture");