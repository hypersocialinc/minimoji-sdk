// Types for @minimoji/engine/line — the talking-line format (docs/speech-line-format.md) and its builder/player.

export type LineFrame = [open: number, width: number, round: number, level: number, pitch?: number | null];
export interface LineCaption { text: string; start: number; end: number; kind?: string }
export interface LineWord { text: string; start: number; end: number }
/** one timed character (seconds) of what was said, spaces included: what shapes a line's mouth from the words */
export interface LineLetter { text: string; start: number; end: number }
export type LineCue =
  | { at: number; mood: string; k?: number }
  | { at: number; gesture: string }
  | { at: number; brow: 'up' | 'down'; k: number }
  /** the eyes turned to `{ x, y }` (each -1..1), aside ('away') or back to the camera ('viewer' / null), for `hold` seconds */
  | { at: number; look: LookTarget; hold?: number };
export type LookTarget = { x: number; y: number } | 'away' | 'viewer' | null;
/** where an app's cue lands: seconds, or a word of the line (`{ word: index }` from 0, or `{ word: 'text', nth? }`) */
export type CueAt = number | { word: number } | { word: string; nth?: number };
/** a cue an app hands `buildLine` (or `say(clip)` as `clip.cues`): any kind, `at` in seconds or on a word; a nod or
 *  shake (`{ at, nod: true }`) plays the face's own track */
export type AuthoredCue =
  | (Omit<Extract<LineCue, { mood: string }>, 'at'> & { at: CueAt })
  | (Omit<Extract<LineCue, { gesture: string }>, 'at'> & { at: CueAt })
  | (Omit<Extract<LineCue, { brow: 'up' | 'down' }>, 'at'> & { at: CueAt })
  | (Omit<Extract<LineCue, { look: LookTarget }>, 'at'> & { at: CueAt })
  | { at: CueAt; nod: true }
  | { at: CueAt; shake: true };
export interface SpeechLine {
  version: 1;
  fps: 60;
  duration: number;
  frames: LineFrame[];
  captions: LineCaption[];
  words?: LineWord[];
  cues: LineCue[];
}
export interface LineSample {
  time: number;
  mouth: { open: number; width: number; round: number; energy: number; bliss: number; pitch?: number };
  level: number;
  caption: string;
}
export type CaptionStyle = 'phrases' | 'window';
export interface CaptionWindow {
  text: string;
  /** `lit`: the word being said (phrases only) */
  words: { text: string; opacity: number; lit?: boolean }[];
  /** the phrase's index in the line (phrases only): a view moves a new one in */
  phrase?: number;
}

export const LINE_VERSION: 1;
export const LINE_FPS: 60;
export const MAX_LINE_SECONDS: number;
export const MAX_CAPTIONS: number;
export const MAX_WORDS: number;
export const MAX_LETTERS: number;
/** letter (lower case) → the mouth shape it takes, or null (the sound's own shape, never shut); two-letter rules too */
export const LETTER_SHAPES: Readonly<Record<string, 'rest' | 'open' | 'round' | 'wide' | 'shut' | null>>;
/** a TTS provider's character alignment (ElevenLabs': one object or an array of chunks) → timed letters, `[tags]` dropped */
export function lettersFromAlignment(alignment: ProviderAlignment | ProviderAlignment[] | null | undefined): LineLetter[];
/** timed words only (a transcriber's) → timed letters, each word's spread evenly over its span */
export function lettersFromWords(words: { text: string; start: number; end: number }[]): LineLetter[];
export interface ProviderAlignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export const CAPTION_TEXT: number;
export const CAPTION_WORDS: number;
export const CAPTION_CHARS: number;
export const CAPTION_FADE: number;
export const CAPTION_PHRASE_WORDS: number;
export const CAPTION_SAID: number;
export const CAPTION_AHEAD: number;
/** a line's words in phrases, as `[from, to)` index ranges */
export function linePhrases(words: { text: string }[], opts?: { maxWords?: number; maxChars?: number }): [number, number][];
export const MAX_CUES: number;
export const QUIET_K: number;
/** the intensity of a face the builder sets on its own (a line's `mood`, a tag): under QUIET_K, no emote burst */
export const SET_K: number;
/** audio tag (lower case, no brackets) → the face it sets */
export const TAG_MOODS: Readonly<Record<string, string>>;
/** directing tag (lower case, no brackets: `nod`, `shake`, `brow`, `brow down`, `look away`, `look back`) → its cue */
export const TAG_CUES: Readonly<Record<string, object>>;
/** seconds a look cue holds when it names no `hold`, and the longest it may ask for */
export const LOOK_HOLD: number;
export const MAX_LOOK_HOLD: number;
/** seconds around an authored accent where a word rule's accent is dropped */
export const GAP: number;
/** where an 'away' look turns the eyes (x mirrored on alternate looks) */
export const LOOK_AWAY: Readonly<{ x: number; y: number }>;
/** timed words with `[tags]` → the words without them, what the word rules read, the faces the tags set and the directing tags' cues */
export function splitTags<W extends { text: string; start: number; end: number }>(words: W[]): { words: W[]; said: W[]; moods: LineCue[]; directed: AuthoredCue[] };
/** a directed nod / shake → the gesture the face held then plays for it (knowing-nod / head-shake on a neutral face) */
export function directedCues(cues: ({ at: number } & Record<string, unknown>)[], arc?: LineCue[]): LineCue[];
/** a look cue's target → the point for `life.lookAt`, or null for the viewer */
export function lookPoint(target: LookTarget, side?: 1 | -1): { x: number; y: number } | null;
/** holds a look cue for a stage that draws frames: `tick(dt)` lets it go after its hold */
export function createLookHold(lookAt?: (x: number | null, y?: number) => void): {
  look(target: LookTarget, hold?: number): void; tick(dt: number): void; release(): void; readonly current: { x: number; y: number } | null;
};
/** the stage interface a cue plays on */
export interface CueStage {
  setMood(mood: string, id?: unknown): void;
  emote(mood: string, id?: unknown, at?: number): void;
  gesture?(gesture: string, id?: unknown): void;
  brow?(brow: 'up' | 'down', k: number, id?: unknown): void;
  look?(target: { x: number; y: number } | 'away' | null, hold: number, id?: unknown): void;
}
/** a stage for `playCues` on one head's life (`head.life`); on a <MinimojiHead> give it `look="manual"` */
export function cueStage(life: { setFace(mood: string): void; perform(what: string | { mood: string }): unknown; lookAt(x: number | null, y?: number): void }): CueStage & { release(): void };
/** a cue track with no line, on its own clock (a function answering seconds, ticked by the host; or none: timers).
 *  `done` resolves 'ended' with the last cue (a look it turned may still be held for its hold), 'stopped' on `stop()`
 *  (which also calls `stage.release()`, letting a held look go), or 'failed' when the stage threw on a timer */
export function playCues(stage: CueStage & { release?(): void }, cues: LineCue[], clock?: (() => number) | null): {
  tick(): boolean; stop(): void; readonly done: Promise<'ended' | 'stopped' | 'failed'>; readonly playing: boolean;
};

export function buildLine(input: {
  pcm: Float32Array;
  sampleRate?: number;
  words?: { text: string; start: number; end: number }[] | null;
  /** timed letters (`lettersFromAlignment(tts.alignment)`, or `lettersFromWords(words)` for word timings only): the mouth
   *  shaped from the words, lips meeting on m/b/p. buildLine never derives them itself (a clip does) */
  letters?: LineLetter[] | null;
  transcript?: string | null;
  mood?: string | null;
  /** used instead of the derived captions; one that ends past the audio ends with it, one that starts past it is dropped */
  captions?: LineCaption[] | ((duration: number) => LineCaption[]) | null;
  /** an array: the app's direction, merged with the derived cues (`at` on seconds or a word); a function: the whole track */
  cues?: AuthoredCue[] | ((duration: number, captions: LineCaption[]) => LineCue[]) | null;
  turns?: { id: string; start: number; end: number }[] | null;
}): SpeechLine;
export function frameCount(duration: number): number;
export function validateLine(data: unknown): SpeechLine;
export function sampleLine(line: SpeechLine, time: number): LineSample;
export function sentenceCaptions(words: LineWord[]): LineCaption[];
export function lineWords(line: SpeechLine): (LineWord & { estimated?: true })[];
export function captionWindow(line: SpeechLine, time: number, opts?: { style?: CaptionStyle; reduceMotion?: boolean; maxWords?: number; maxChars?: number; words?: LineWord[] }): CaptionWindow;
export function applySpeechCue(stage: CueStage, cue: LineCue, id?: unknown, quiet?: boolean): void;

/** something with an audio clock: an HTMLAudioElement fits */
export interface LineAudio { currentTime: number; ended?: boolean; play(): Promise<void> | void; pause(): void }
export interface LineTick { generation: number; time: number; sample: LineSample; silent: boolean }
export interface LinePlayer {
  say(line: SpeechLine, opts?: { audio?: LineAudio | null }): number;
  stop(): void;
  readonly generation: number | null;
  readonly silent: boolean;
  tick(): LineTick | null;
}
export function createLinePlayer(opts?: {
  onCue?(cue: LineCue, quiet: boolean): void;
  onEnd?(generation: number, reason: 'ended' | 'stopped'): void;
  now?(): number;
}): LinePlayer;

export function cueKind(cue: unknown): 'mood' | 'gesture' | 'brow' | 'look' | null;
export function validateCues(cues: unknown, duration: number): void;
export function moodAt(cues: LineCue[], time: number): string;
export function buildCues(moods: LineCue[], words: { word: string; start: number; end: number }[], extra?: LineCue[], duration?: number): LineCue[];
export function wordsFromAlignment(alignment: ProviderAlignment | ProviderAlignment[] | null | undefined): { word: string; text: string; start: number; end: number }[];
/** words in milliseconds (`{ text, startMs, durationMs }`) → timed words, seconds */
export function wordsFromMs(words: { text: string; startMs: number; durationMs: number }[]): LineWord[];
export const AZURE_TICKS: number;
/** Azure Speech WordBoundary events (offset and duration in 100 ns ticks) → timed words; punctuation and sentence boundaries skipped */
export function wordsFromAzure(events: { text: string; audioOffset: number; duration: number; boundaryType?: string | number }[]): LineWord[];
/** Amazon Polly speech marks (JSON lines, or their objects) → timed words; each ends where the next starts, the last at `duration` (seconds) */
export function wordsFromPolly(marks: string | { time: number; type: string; value?: string }[], duration: number): LineWord[];
/** Cartesia `word_timestamps` (`{ words, start, end }`, seconds; one or a stream's pieces) → timed words */
export function wordsFromCartesia(timestamps: { words: string[]; start: number[]; end: number[] } | { words: string[]; start: number[]; end: number[] }[]): LineWord[];
export function analyzePCM(pcm: Float32Array, sampleRate?: number, turns?: { id: string; start: number; end: number }[] | null): { fps: 60; duration: number; frames: LineFrame[] };
export function analyzePitch(pcm: Float32Array, sampleRate: number, turns?: { id: string; start: number; end: number }[] | null): (number | null)[];
export function round(n: number): number;
/** a line's captions sized for a speech bubble (a presenter deck): sentence-sized, beside captionWindow's 4-word phrases */
export { capsFromLine, captionAt, wordTime, BUBBLE_CAPTION_CHARS, BUBBLE_LIT_HOLD } from './bubble-captions';
export type { BubbleCaption } from './bubble-captions';
