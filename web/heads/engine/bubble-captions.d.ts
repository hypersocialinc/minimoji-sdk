import type { LineWord, SpeechLine } from './line';

/** One bubble caption: a whole phrase (usually a sentence, split near BUBBLE_CAPTION_CHARS at punctuation),
 *  shown alone in a speech bubble beside the head. Not the 4-word phrases of `captionWindow` /
 *  <MinimojiCaptions>, which suit a caption strip: bubble captions are sentence-sized, for a speech bubble. */
export interface BubbleCaption { start: number; end: number; words: LineWord[] }
/** the longest caption a bubble shows at once (64 characters, about two bubble lines) */
export const BUBBLE_CAPTION_CHARS: number;
/** seconds a word's pill stays lit after the word ends (0.12) */
export const BUBBLE_LIT_HOLD: number;
/** a line's bubble captions: its own phrases one at a time, a long one split at punctuation, never a lone word.
 *  Without timings, `text` is one caption with words 0.3 s apart (none for an empty text) */
export function capsFromLine(line: Pick<SpeechLine, 'captions' | 'words'> | null | undefined, text?: string, opts?: { maxChars?: number }): BubbleCaption[];
/** the caption showing at `t` seconds (the last one holds after the line ends) and its lit word (-1 between words) */
export function captionAt(caps: readonly BubbleCaption[], t: number): { index: number; lit: number };
/** when `word` is first said (seconds), ignoring case and punctuation; `fallback` when it isn't */
export function wordTime(line: Pick<SpeechLine, 'words'> | null | undefined, word: string, fallback: number): number;
