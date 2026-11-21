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
  /** the head's still until it draws: a `mountHeadPoster` handle (mount it before fetching a bake) or the still's src.
   *  It gives way on the first frame; it stays, sharp, if mounting throws. */
  poster?: HeadPoster | string | null;
  /** a screen face's (D.A.S.H.'s) CRT look, scanlines and glass following the mood: 0 off, 1 (the default), 2 loud. A head of skin ignores it */
  crt?: 0 | 1 | 2;
  /** what the head shows for an agent: 'thinking' | 'working' | 'needsYou' | 'waiting' | 'done' | 'errored' | 'asleep'.
   *  D.A.S.H.'s screen shows it (bake 19); any other head its own face and one held sticker (working: a keyboard).
   *  null (the default) leaves the head as it was */
  agentState?: string | null;
  /** a screen face's glass colour over every mood and agent state, `#rrggbb`; null leaves it */
  screenColor?: string | null;
  /** a packed character's colours by slot for the solo `bakedHead`, `{ trim: '#7a3cff' }` (see `prepared.slots`);
   *  throws on an unknown slot or a head with no slot map */
  colors?: Readonly<Record<string, string>> | null;
  /** RECORD FRAME BY FRAME (video export): a stepped clock from `createManualClock({ seed })`. The stage runs no loop of
   *  its own and reads no wall clock or pointer: nothing advances and nothing draws until `stage.step(dt)`, each step
   *  is one frame advanced by exactly `dt`, and the same seed and calls draw the same frames. `frame`/`idleFrame` only
   *  set what the next step draws. A `poster` stays until `stage.ready` resolves, then leaves at once (no fade, no
   *  puff). Off by default */
  clock?: ManualClock | null;
}

/** A STEPPED CLOCK for recording a head frame by frame. Mount the stage on it, `await stage.ready`, then `stage.step(1 / 30)`
 *  once per video frame: every clock the head has moves by exactly that much and one frame is drawn, however long the
 *  recorder takes between steps. A voiced performance on a stepped stage plays no sound: mux the audio yourself */
export interface ManualClock {
  readonly manual: true;
  readonly seed: number;
  /** seconds: the sum of every step */
  now(): number;
  readonly time: number;
  readonly steps: number;
  /** move every clock by `dt` seconds (finite, ≥ 0) and draw one frame on every stage on this clock; answers the time */
  step(dt: number): number;
  /** resolves once nothing held on this clock is still loading (a stage's sculpted parts and stickers, a voiced
   *  performance's line being loaded or built). Rejects when a held load failed: an Error naming each (`failed` lists
   *  them), reported once, so a retry reads a clean `ready`. Wait for it before every step if a line can be selected
   *  while you record: the line then starts on the same step every run */
  readonly ready: Promise<void>;
  /** a seeded random source of its own for `salt` */
  random(salt?: string): () => number;
  /** run `fn` on every step; answers the unsubscribe */
  onStep(fn: (dt: number, time: number) => void): () => void;
  /** have `ready` wait for a load of yours too (and reject, naming `what`, if it fails); answers the promise as given */
  hold<T>(promise: Promise<T>, what?: string): Promise<T>;
}
/** a stepped clock. `seed` deals the dice of every head on it (default 1): when it blinks, where the eyes glance, which
 *  emote of a mood plays, a poke's reaction. Two recordings match only with the same seed: derive it from a stable id
 *  for the content (a deck's id, a slide's id plus a speaker), never from `location`, a URL or a served path (a server
 *  that serves each run under a fresh prefix gives every run other blinks) */
export function createManualClock(options?: { seed?: number }): ManualClock;

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
  setBakedHead(prepared: PreparedBakedHead, options?: { colors?: Readonly<Record<string, string>> | null }): void;
  /** recolour the solo baked head by colour slot, live (no reload); throws on an unknown slot, a colour that is not
   *  #rrggbb or a head with no slot map. A slot with no parts on this variant changes nothing */
  setColors(colors: Readonly<Record<string, string>>): void;
  /** what an agent is doing, on every head (see `agentState`); `color`/`glass` override the state's own colour */
  setAgentState(state: string | null, opts?: { color?: string; glass?: number }): void;
  /** light a screen face's glass in `hex` over every mood (`glass`: ≈.3 dark, 2.2 flooded); null hands it back */
  setScreenColor(hex: string | null, opts?: { glass?: number }): void;
  /** put a live source on a head (`setPerformance(await liveMic())`): its mouth is the head's while it talks, and the
   *  stage draws its own frames while one is set. null takes it off; `id` picks a tile */
  setPerformance(source: LiveMicSession | { performance(t?: number): unknown } | ((t: number) => unknown) | null, id?: string): void;
  /** resolves (to the stage) once every lazy load a frame depends on is in: the sculpted parts (and the head rebuilt
   *  with them), the sticker scripts (minimoji-heads-bursts.js) and their sprites. A stepped stage's rejects, naming
   *  them, when the sculpted parts failed (the head draws its fallback; the stage's ready and its clock's each report
   *  it once; stickers are decoration and never fail it); a live stage's always resolves. On a stepped stage
   *  the poster then leaves at once and the canvas holds the first frame, with no step (the head as mounted, at time 0);
   *  `step(0)` only redraws the frame as it stands: nothing moves, no line ticks, no dice are dealt */
  readonly ready: Promise<HeadPerformanceStage>;
  /** the stepped clock the stage runs on, or null */
  readonly clock: ManualClock | null;
  /** a stepped stage: move its clock (and every stage on it) by `dt` seconds and draw one frame. Throws on a live stage */
  step(dt: number): void;
  /** the frame just drawn as ImageData (device px): the head's canvas with its stickers behind and in front */
  capture(): ImageData;
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
  /** a packed character's colour slots: slot → the parts wearing it in this file (an empty list: not on this
   *  variant). null on a head with no slot map (another bake, or a pack from before it): its colours are fixed */
  readonly slots: Readonly<Record<string, readonly string[]>> | null;
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
  /** the element a run plays on. Required on a live stage. On a stepped stage it is optional and sets the timebase:
   *  given, the element's currentTime, paused and ended drive the line, as live (give a silent one for a recording,
   *  whose currentTime is your recorder's clock); left out, the line runs on the stage's clock with no element */
  createMedia?: (url: string) => HTMLMediaElement;
  /** a stepped stage's timebase, when you want to say it: 'media' (needs createMedia) or 'clock'. Default: 'media'
   *  when createMedia is given, else 'clock'. A live stage is always 'media'. Made on an object of your own to
   *  `attach` a stepped stage to: say 'clock' here to run on its clock with no element */
  timebase?: 'media' | 'clock';
  loadTimeline: (url: string, signal: AbortSignal) => Promise<unknown>;
  /** the stage the calls go to (frame, reset, setMood, emote, gesture, look, brow): a stage, or an object of your own
   *  that forwards them. A stepped stage's clock and drive are read from it, or given with `attach(stage)` */
  stage: unknown;
  changed?: (state: unknown) => void;
  claimVoice?: () => void;
  clips?: ClipCache;
  /** mute every element a run makes (and the live one); unset leaves the element as `createMedia` made it */
  muted?: boolean;
  /** 0..1 on every element a run makes (and the live one); unset leaves the element as `createMedia` made it */
  volume?: number;
  /** where plain audio with no words is transcribed */
  transcribe?: { key: string; service: string } | null;
}): {
  /** on a stepped stage, timebase 'clock': start the line on the stage's clock, with no media and no sound; each
   *  `stage.step(dt)` moves it by `dt`, and it ends (status `ended`) on the step that reaches its duration. Timebase
   *  'media': as live (play() on your element; its currentTime is the line's time); the steps draw it */
  play(): void;
  /** the line's time now (seconds), on its timebase: drive your own captions or reveals from it */
  readonly time: number;
  /** is the line playing (not loading, paused, buffering, stopped or ended)? */
  readonly playing: boolean;
  /** which clock the line follows: 'media' (the element's currentTime) or 'clock' (a stepped stage's) */
  readonly timebase: 'media' | 'clock';
  pause(): void;
  stop(): void;
  /** load a line (held on a stepped stage's clock until it has landed, so `clock.ready` waits for it) */
  select(next: unknown): Promise<void>;
  prepare(next: unknown): Promise<SpeechLine>;
  /** point the voice at a stepped stage's clock and drive: for a `stage` of your own (it still gets the calls) or a
   *  head mounted again (the line goes on from where it was). Throws unless `stage` is stepped */
  attach(stage: HeadPerformanceStage): void;
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
  /** a stepped clock (createManualClock): the line on its time, no sound */
  clock?: ManualClock | null;
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

/** The head's own loader without React: its still (soft, breathing) in `container`, under the stage's canvas. */
export interface HeadPoster {
  readonly element: HTMLElement;
  /** the head drew: the still fades and leaves the page (`instant`: at once, no fade or puff, as a stepped stage does) */
  ready(options?: { instant?: boolean }): void;
  /** the head will not draw: the still stays, sharp */
  error(): void;
  dispose(): void;
}
/** Show a head's still (GET /avatars/<key>.png?size=256) at once, before a bake is fetched; pass the handle to
 *  mountHeadPerformance's `poster`. Sets `data-minimoji` on the container (loading → ready or error). */
export function mountHeadPoster(container: HTMLElement, options: { src: string; puff?: string | null }): HeadPoster;
/** the loader's style sheet (mountHeadPoster adds it to the page once) */
export const POSTER_CSS: string;
