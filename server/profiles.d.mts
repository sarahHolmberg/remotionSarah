// server/profiles.d.mts
// NEW FILE: types for server/profiles.mjs, so app/vite.config.ts can import it
import type {IncomingMessage, ServerResponse} from "node:http";

export declare const makeProfileHandler: (root: string) => (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
