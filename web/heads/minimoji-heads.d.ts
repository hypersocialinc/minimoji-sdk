// @minimoji/heads: Mini avatar heads for a page with no React or bundler of its own, three.js inside.
// The line and clip types are the engine's own (./engine/line, ./engine/clip); the stage's are minimal.
// `mountHeadPerformance(el, { interactive: true, onPoke })` lets a pointer poke a head and drag it; `stage.react(name?)` plays a reaction from code.
import type { SpeechLine, sampleLine } from './engine/line';
import type { ClipCache } from './engine/clip';

export { buildLine, validateLine, sampleLine, captionWindow, lineWords, createLinePlayer, applySpeechCue, LINE_VERSION } from './engine/line';
export type { SpeechLine, LineCue, LineWord, LineCaption, LineAudio, AuthoredCue, CueAt, LookTarget, CueStage } from './engine/line';
/** directing a head: a cue track with no line (a game's NPC, a party host) on its own clock; `cueStage(life)` plays it on one head's life */
export { playCues, cueStage, TAG_CUES, LOOK_HOLD } from './engine/line';
/** a line's captions sized for a speech bubble, one at a time (a presenter deck): sentence-sized, not captionWindow's 4-word phrases */
export { capsFromLine, captionAt, wordTime, BUBBLE_CAPTION_CHARS } from './engine/line';
export type { BubbleCaption } from './engine/line';
/** the share of the viewport's shorter side that turns the eyes all the way in `lookTargetFor` */
export const LOOK_SPAN: number;
/** a look cue's `{ x, y }` (-1..1, + right / up) for an element on the page, from the head's anchor */
export function lookTargetFor(el: Element | { left: number; top: number; width: number; height: number }, anchorEl: Element | { left: number; top: number; width: number; height: number }, opts?: { span?: number }): { x: number; y: number };
export { createClipCache, decodeAudio, isClip, clipSource, audioBufferMedia } from './engine/clip';
export type { SpeechClip, ClipCache } from './engine/clip';

/** a character by id (`agent` is D.A.S.H.; the catalogue is `CHARACTERS` in `@minimoji/react/characters`) */
export interface CharacterChoice { id: string; [option: string]: unknown }

export interface HeadPerformanceOptions {
  /** the avatar document: the same JSON the service and the Swift Kit take */
  avatar?: object;
  character?: CharacterChoice | null;
  /** several heads in one stage, each placed over its element */
  tiles?: Array<{ id: string; avatar?: object; character: CharacterChoice | null; bakedHead?: PreparedBakedHead | null; element: Element }> | null;
  /** draw a baked head (a bake's GLB, see `prepareBakedHead`) instead of building `avatar`/`character` */
  bakedHead?: PreparedBakedHead | null;
  reduceMotion?: boolean;
  /** where the idle gaze hears the pointer: the container by default, `window` to follow it anywhere */
  pointerTarget?: EventTarget | null;
  /** a solo stage reports where its head's top sits at rest (css px from the container's top) */
  onHeadTop?: ((headTop: number) => void) | null;
  /** let a pointer poke the heads and drag them. Off by default (no listener is attached); `true` turns both on.
   *  Only a head's skull counts: a press anywhere else falls through to the page. A poke works idle, paused, before Play
   *  and mid-line (lip-sync carries on under it) and never stops the line itself: do that from `onPoke` */
  interactive?: boolean | Interactive | null;
  /** a poke played a reaction (`id`: the tile's, or 'solo') */
  onPoke?: ((event: { reaction: Reaction; id: string }) => void) | null;
  onDragStart?: ((event: { id: string }) => void) | null;
  /** `distance`: how far the pointer went, css px; `flung`: released fast enough to play `dizzy` */
  onDragEnd?: ((event: { id: string; distance: number; flung: boolean }) => void) | null;
  /** the comic stickers that pop when a head's mood changes (any strength, as `<MinimojiHead bursts>` and the Kit); default true */
  bursts?: boolean;
  /** false: face only. No comic stickers and none of the rig's effect plates (tears, sparkles, steam, sleep Zs, notes,
   *  a screen face's effects); expressions, blush, lip sync (sound arcs and lines too) and head motion are untouched. Default true. Overrides
   *  `bursts`; applies to recipe heads, baked heads and every tile in this stage */
  decorations?: boolean;
  /** a screen face's (D.A.S.H.'s) CRT look, scanlines and glass following the mood: 0 off, 1 (the default), 2 loud. A head of skin ignores it */
  crt?: 0 | 1 | 2;
}

/** a poke's answer: a face held a moment and a short move on the head (no sound: play your own from `onPoke`) */
export type Reaction = 'oof' | 'ah' | 'flinch' | 'giggle' | 'dizzy';
export interface Interactive {
  /** a tap on a head plays a reaction, never the same one twice in a row; `reactions` replaces the pool (unknown names warn once and are skipped) */
  poke?: boolean | { reactions?: Reaction[] };
  /** a head follows a drag on a rubber band (approaching `maxPx`, 80 css px), tilts toward the pull and springs back with a wobble; a fling plays `dizzy` */
  drag?: boolean | { maxPx?: number };
  /** each head's element becomes a button with this accessible name (Enter or Space pokes it). Default "Poke the avatar" */
  label?: string;
}

export interface HeadPerformanceStage {
  /** play a reaction now, cutting in over one already playing: a name, or with none one from the pool; `id` picks a tile.
   *  Works with `interactive` off too. Answers what played, or null (an unknown name warns once and plays nothing) */
  react(name?: Reaction | null, id?: string): Reaction | null;
  /** a look cue on the stage: the eyes on `{ x, y }` (-1..1), aside ('away') or back to the viewer (null) for `hold` seconds; `id` picks a tile */
  look(target: { x: number; y: number } | 'away' | null, hold: number, id?: string): void;
  /** a face set quietly; `id` picks a tile. A change to a mood with stickers pops them (`bursts`), unless `catchUp`:
   *  the face held where a line jumped to (a seek, a stall), put back without its stickers */
  setMood(mood: string, id?: string, catchUp?: boolean): void;
  /** replace the stage's head(s) with one solo baked head (a tiled stage becomes solo) */
  setBakedHead(prepared: PreparedBakedHead): void;
  /** put a live source on a head (`setPerformance(await liveMic())`): its mouth is the head's while it talks, and the
   *  stage draws its own frames while one is set. null takes it off; `id` picks a tile */
  setPerformance(source: LiveMicSession | { performance(t?: number): unknown } | ((t: number) => unknown) | null, id?: string): void;
  dispose(): void;
  [member: string]: any;
}

/** mount a head stage in `container`: media time during playback, one animation frame loop while idle */
export function mountHeadPerformance(container: HTMLElement, options?: HeadPerformanceOptions): HeadPerformanceStage;

/** a bake's binary glTF (`GET /avatars/<key>.glb` on the service, or bytes you hold), checked and parsed once by `prepareBakedHead`;
 *  data only (no images, textures, external buffers or code). A bad file rejects: there is never a stand-in head */
export interface BakedHeadSource {
  format?: 'minimoji-head-glb';
  /** http(s):// or a root-relative /path; relative, blob: and data: URLs are refused (pass bytes instead) */
  url: string;
  /** reject unless the file's SHA-256 is this (hex) */
  sha256?: string;
  /** reject unless this is the bundle's bake version (the file's own must match it too) */
  version?: number;
  bakeVersion?: number;
}
export interface PreparedBakedHead {
  readonly format: 'minimoji-head-glb';
  readonly version: number;
  readonly sha256: string;
  readonly byteLength: number;
  readonly bounds: Readonly<{ w: number; h: number; cy: number; minY: number; maxY: number }>;
  readonly faceNames: readonly string[];
  /** frees the template; heads already mounted from it keep working. Idempotent */
  dispose(): void;
}
export const BAKED_HEAD_FORMAT: 'minimoji-head-glb';
/** 32 MB: the most a baked head may weigh */
export const BAKED_HEAD_MAX_BYTES: number;
/** The oldest bake version a baked head may carry; files from this version up to the current bake load. */
export const BAKED_HEAD_MIN_VERSION: number;
/** fetch (same-origin credentials) or take bytes, validate and parse a baked head; mount it with `bakedHead` */
export function prepareBakedHead(source: string | BakedHeadSource | ArrayBuffer | ArrayBufferView, options?: {
  sha256?: string; version?: number; bakeVersion?: number; maxBytes?: number;
  fetch?: typeof globalThis.fetch; signal?: AbortSignal;
}): Promise<PreparedBakedHead>;
export const loadBakedHead: typeof prepareBakedHead;
/** `mountHeadPerformance` for one prepared baked head; throws (before any canvas) unless `bakedHead` is prepared */
export function mountBakedHeadPerformance(container: HTMLElement, options: Omit<HeadPerformanceOptions, 'avatar' | 'character' | 'tiles'> & { bakedHead: PreparedBakedHead }): HeadPerformanceStage;

/** a voiced performance: one owned media element per run; a selection is a `{ timeline, audio, duration }` or plain audio */
export function createVoicedPerformance(options: {
  createMedia: (url: string) => HTMLMediaElement;
  loadTimeline: (url: string, signal: AbortSignal) => Promise<unknown>;
  stage: unknown;
  changed?: (state: unknown) => void;
  claimVoice?: () => void;
  clips?: ClipCache;
  /** mute every element a run makes (and the live one); unset leaves the element as `createMedia` made it */
  muted?: boolean;
  /** 0..1 on every element a run makes (and the live one); unset leaves the element as `createMedia` made it */
  volume?: number;
}): {
  select(next: unknown): Promise<void>;
  prepare(next: unknown): Promise<SpeechLine>;
  /** mute or unmute the live element at once and every later run's (a muted head still talks: the clock is the element's) */
  setMuted(muted: boolean): void;
  /** the volume (0..1, clamped) of the live element at once and every later run's */
  setVolume(volume: number): void;
  [member: string]: any;
};

/** `sampleLine` under the website's older name */
export const sampleTimeline: typeof sampleLine;

/** the line player without React: what `useLine` in `@minimoji/react` runs */
export function createLineSession(opts?: {
  onState?: (state: unknown) => void;
  createAudio?: (url: string) => HTMLAudioElement;
  onCue?: (cue: unknown, quiet: boolean) => void;
  onEnd?: (generation: number, reason: 'ended' | 'stopped' | 'failed', error?: Error) => void;
  clips?: ClipCache;
  audioContext?: () => AudioContext;
}): { say(line: unknown, opts?: object): number | null; prepare(clip: unknown): Promise<SpeechLine>; stop(): void; dispose(): void; [member: string]: any };

/** why a live mic failed: `denied`, `no-device`, `busy` (another app has it), `unsupported` (an http:// page, an old
 *  browser), `blocked` (audio kept off: not called from a gesture), `ended` (unplugged mid-talk), `failed` */
export interface LiveMicError extends Error { code: 'unsupported' | 'denied' | 'no-device' | 'busy' | 'blocked' | 'ended' | 'failed' }
export type LiveMicState = 'idle' | 'starting' | 'live';
export interface LiveMicOptions {
  /** a mic from `navigator.mediaDevices.enumerateDevices()`; null (default): the system's */
  deviceId?: string | null;
  /** seconds the host delays its own playout of this voice for the mouth's sake (0: the speaker hears themselves) */
  lookAhead?: number;
  onState?: (state: LiveMicState) => void;
  onError?: (error: LiveMicError) => void;
}
/** the mic, live, on a head's mouth: analysed in the page, nothing played, stored or sent */
export interface LiveMicSession {
  /** open the mic (from a click): resolves true once live, false when `stop()` came first; rejects with a LiveMicError */
  start(): Promise<boolean>;
  stop(): void;
  /** a performance snapshot for this frame: the mouth while you talk, inactive in the silences */
  performance(t?: number): unknown;
  /** how loud the voice is now, 0..1: a meter */
  level(): number;
  on(kind: 'state', fn: (state: LiveMicState) => void): () => void;
  on(kind: 'error', fn: (error: LiveMicError) => void): () => void;
  setDevice(deviceId: string | null): void;
  readonly state: LiveMicState;
  readonly live: boolean;
  readonly path: 'worklet' | 'script-processor' | null;
}
/** TALK WITH YOUR VOICE: `const mic = await liveMic(); stage.setPerformance(mic);` from a click. Echo cancelling, noise
 *  suppression and auto gain on; the same live viseme analyser as MinimojiKit */
export function liveMic(opts?: LiveMicOptions): Promise<LiveMicSession>;
/** the session, not started */
export function createLiveMicSession(opts?: LiveMicOptions): LiveMicSession;
export const LIVE_MIC_CONSTRAINTS: Readonly<{ echoCancellation: true; noiseSuppression: true; autoGainControl: true }>;
