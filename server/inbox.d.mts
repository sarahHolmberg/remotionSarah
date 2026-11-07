// server/inbox.d.mts
// NEW FILE: types for server/inbox.mjs, so app/vite.config.ts can import it
import type {IncomingMessage, ServerResponse} from "node:http";

export declare const makeInboxHandler: (root: string) => (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
