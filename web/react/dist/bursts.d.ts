// @minimoji/react/bursts: the comic stickers <MinimojiHead> pops on a mood change (see `bursts` on MinimojiHeadProps)
export interface BurstPart { sprite: string; layer: 'back' | 'front'; pose: [x: number, y: number, size: number, rotation: number, alpha: number]; time: number; life: number; leave: number }
export interface BurstGlow { rgb: number; radius: number; y: number; alpha: number }
/** a burst at one moment, in skull diameters about the skull's centre */
export interface BurstSample { parts: BurstPart[]; glows: BurstGlow[] }
export interface BurstRect { x: number; y: number; width: number; height: number }
/** one head on a sticker layer: its sample, the slot its stickers stay inside, and its skull's disc (container css px, y down) */
export interface BurstHead { sample: BurstSample; rect: BurstRect; skull: { x: number; y: number; diameter: number } }
/** where the sticker PNGs load from (beside the vanilla bundle, else minimoji.com) */
export const BURST_BASE: string;
/** seconds a burst that lets go takes to fade */
export const BURST_LEAVE: number;
/** the moods that have stickers */
export const BURST_MOODS: readonly string[];
export function burstDuration(mood: string): number;
export function sampleComicBurst(mood: string, age: number, leave?: number): BurstSample;
/** one head's burst by the Kit's rule: fires on a change to a mood with stickers, never the first face or the same one again */
export interface BurstState {
  face(face: string, t: number, fire?: boolean): void;
  letGo(t: number): void;
  clear(): void;
  readonly mood: string | null;
  sample(t: number): BurstSample;
}
export function createBurstState(): BurstState;
export function mountComicBursts(container: HTMLElement, headCanvas: HTMLElement | null, opts?: { base?: string; beside?: boolean }): { draw(heads?: BurstHead[]): void; dispose(): void };
/** `built` is a head's `built` (Head['built']): its skull group and its layout (L.W, the skull's width) */
export function skullDisc(built: { head: import('three').Object3D; L: object }): { x: number; y: number; diameter: number };
export function placeSticker(x: number, y: number, size: number, rotation: number, rect: BurstRect): { x: number; y: number; size: number };
export function stickerScale(sprite: string, time: number, life: number, leave?: number): number;
export function thinkingDots(time: number): { x: number; y: number; r: number; alpha: number }[];
