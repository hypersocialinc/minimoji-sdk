// Types for @minimoji/engine/clip — a plain audio clip → a line (fetch, decode, buildLine, cache).
import type { AuthoredCue, LineAudio, LineCaption, LineLetter, LineWord, ProviderAlignment, SpeechLine } from './line.js';

/** a plain clip: the audio, and whatever the host knows about its words */
export interface SpeechClip {
  /** a URL (fetched), a Blob or bytes (decoded with Web Audio), or an AudioBuffer (its own samples) */
  audio: string | Blob | ArrayBuffer | ArrayBufferView | AudioBuffer;
  /** the line's text: one caption across the voiced part (no timed words) */
  transcript?: string | null;
  /** timed words (seconds): word captions, sentence captions and the word cues (a nod on "yes") */
  words?: LineWord[] | null;
  /** timed letters (seconds, spaces included): the mouth shaped from the words, lips meeting on m/b/p only. Unset with
   *  `words` (and no `alignment`): the words spread into letters (`lettersFromWords`). `false` (or `[]`): no letters,
   *  the mouth guessed from the sound */
  letters?: LineLetter[] | false | null;
  /** or the TTS provider's character alignment as it came (ElevenLabs' `alignment`): read into `letters` */
  alignment?: ProviderAlignment | ProviderAlignment[] | null;
  /** a string: the whole line's caption when there are no words or transcript; an array: the captions, as is (one that
   *  ends past the audio ends with it; one that starts past it is dropped) */
  captions?: string | LineCaption[] | null;
  /** the face the line starts on */
  mood?: string | null;
  /** the app's own direction, merged with the derived cues: `{ at, gesture | mood | brow | look }` with `at` in seconds
   *  or on a word (`{ word: 7 }`, `{ word: 'card', nth? }`); a word the line does not say fails the clip */
  cues?: AuthoredCue[] | null;
  /** a recording with no words: `true` (or `{ key, service }`, or unset when the cache holds a transcriber and the clip
   *  has no words, transcript or captions) sends the decoded audio to Minimoji's POST /lines, whose timed words give the
   *  line its captions and word cues; `false` never sends it. An asked-for transcription that fails fails the clip; one
   *  chosen because the clip had no words falls back to the plain line. The audio goes to Minimoji and ElevenLabs, not stored */
  transcribe?: boolean | ClipTranscriber | null;
}
/** where a recording is transcribed: the app's publishable key (`mk_pub_…`) and the service's `.convex.site` origin */
export interface ClipTranscriber { key: string; service: string }
/** one timed letter inside a word (seconds) */

export const CLIP_SAMPLE_RATE: number;
export const CLIP_CACHE_SIZE: number;
export const CLIP_TIMEOUT: number;
export const TRANSCRIBE_SAMPLE_RATE: number;
export const TRANSCRIBE_MAX_SECONDS: number;
export const TRANSCRIBE_TIMEOUT: number;
/** samples → a 16-bit mono WAV at `rate` (16 kHz) */
export function encodeWav(pcm: Float32Array, sampleRate: number, rate?: number): Uint8Array;
/** samples → the words POST /lines heard in them; throws with the service's words on a refusal */
/** with `text`, the service aligns that script to the audio (`alignedTo: 'text'`, `loss`) instead of transcribing it */
export function transcribeSamples(audio: { pcm: Float32Array; sampleRate: number }, opts: ClipTranscriber & { text?: string | null; fetch?: (url: string, init: RequestInit) => Promise<Response>; signal?: AbortSignal }): Promise<{ words: LineWord[]; letters: LineLetter[]; transcript: string; alignedTo: 'text' | 'transcript'; loss?: number }>;
/** the clip as a cache holding `transcriber` prepares it */
export function withTranscriber(clip: SpeechClip, transcriber: ClipTranscriber | null | undefined): SpeechClip;
export function isClip(x: unknown): x is SpeechClip;
/** a line spoken from text by POST /lines/say: no audio of its own */
export interface TextClip { text: string; voice: string | { voiceId: string; effect?: 'none' | 'robot'; settings?: Record<string, number | boolean> }; mood?: string | null; model?: string;
  /** where it is spoken: the app's publishable key and the service origin (or the session's `synthesize`), and optionally the caller's own ElevenLabs key */
  synthesize?: ClipSynthesizer | null }
export interface ClipSynthesizer { key: string; service: string; elevenLabsKey?: string | null }
export interface SaidLine { audio: string; format: 'wav'; durationMs: number; line: SpeechLine; words: LineWord[]; letters: LineLetter[]; transcript: string; chars: number; charged: number; cached: boolean; voice: { name: string | null; voiceId: string; effect: string } }
export function isTextClip(x: unknown): x is TextClip;
export const SYNTHESIZE_TIMEOUT: number;
export function synthesizeLine(clip: TextClip, opts: ClipSynthesizer & { fetch?: (url: string, init: RequestInit) => Promise<Response>; signal?: AbortSignal }): Promise<SaidLine>;
export function monoPCM(buffer: AudioBuffer): Float32Array;
export function decodeAudio(bytes: ArrayBuffer | ArrayBufferView, sampleRate?: number): Promise<{ pcm: Float32Array; sampleRate: number }>;
export interface ClipCache {
  /** fetch, decode and build a clip (the same promise for one already on its way); rejects on a load or decode failure */
  prepare(clip: SpeechClip): Promise<SpeechLine>;
  /** the built line when the clip is cached, synchronously; null otherwise */
  peek(clip: SpeechClip): SpeechLine | null;
  readonly size: number;
  clear(): void;
}
export function createClipCache(opts?: {
  size?: number;
  sampleRate?: number;
  /** the network: a clip's URL, and POST /lines for a transcribed clip */
  fetch?: (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; arrayBuffer(): Promise<ArrayBuffer>; json(): Promise<any> }>;
  /** the transcriber a clip with no words uses (and one saying `transcribe: true`) */
  transcribe?: ClipTranscriber | null;
  decode?: (bytes: ArrayBuffer | ArrayBufferView, sampleRate: number) => Promise<{ pcm: Float32Array; sampleRate: number }>;
  /** seconds before a clip that has not loaded and built fails (30) */
  timeout?: number;
  build?: (input: { pcm: Float32Array; sampleRate: number; words: LineWord[] | null; letters: LineLetter[] | null; transcript: string | null; mood: string | null; captions: LineCaption[] | null }) => SpeechLine | Promise<SpeechLine>;
}): ClipCache;
export function clipSource(audio: SpeechClip['audio']): { src: string; revoke(): void } | null;
export function audioBufferMedia(buffer: AudioBuffer, context: AudioContext): LineAudio & { readonly paused: boolean };
/** the longest text POST /lines aligns */
export const ALIGN_MAX_TEXT: number;
/** the text a transcribed clip sends to be aligned (its transcript, if the service can align it), or null */
export function scriptOf(clip: { transcript?: string | null; words?: unknown[] | null; letters?: unknown[] | null; alignment?: unknown }): string | null;
