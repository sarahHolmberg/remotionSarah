// server/background.d.mts
// NEW FILE: types for server/background.mjs, so app/vite.config.ts can import it
import type {IncomingMessage, ServerResponse} from "node:http";

export declare const BACKGROUND_PATH: string;
export declare const handleBackground: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
