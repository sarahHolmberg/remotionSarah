// src/mascot/mascot.d.ts
// NEW FILE: types for src/mascot/mascot.js (plain JavaScript, so the playground can use the very same file)
import type * as THREE_NS from "three";

export type MascotSettings = Record<string, number>;
export type MascotMove = {x: number; y: number; t: number; text: string; name?: boolean};
export type Mascot = {
  world: THREE_NS.Group;
  setSize(width: number, height: number, gridSize: number): void;
  rebuild(): void;
  setMoves(moves: MascotMove[], start?: {x: number; y: number} | null): void;
  frame(t: number): string;
  refreshText(): void;
  readonly plan: unknown[];
};
export declare const DEFAULTS: MascotSettings;
export declare function createMascot(three: typeof THREE_NS, settings: MascotSettings): Mascot;
