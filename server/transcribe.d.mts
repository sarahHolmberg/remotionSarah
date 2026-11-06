// server/transcribe.d.mts
// NEW FILE: types for server/transcribe.mjs, so app/vite.config.ts can import it
import type {IncomingMessage, ServerResponse} from "node:http";

export declare const makeTranscribeHandler: () => (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
