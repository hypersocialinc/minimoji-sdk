'use client';
// THE PRESENTER AS A REACT CLIENT COMPONENT — the starter's engine (../starter/presenter.js) on @minimoji/react: the same
// slides.json, the same lines/, the same rules (../SKILL.md). Copy it into your app and render your slides as children:
//
//   const deck = useRef<PresenterHandle>(null);
//   <PresenterDeck ref={deck} deck={slidesJson} lines="/intro/lines/" onWaiting={…} onEnded={…}
//     slide={(s, i) => <MySlide id={s.id} />} />
//   …later, from your own step UI: deck.current?.done('topic', 'filing')
//
// Differences from the starter: the head is <MinimojiHead> on a <MinimojiStage>, the line plays through useLine (which
// owns play(); a pause stops the line and Play restarts the slide's line), and reveals are a `revealed` set you read.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { MinimojiStage, MinimojiHead, MinimojiHeadPoster, useLine, capsFromLine, captionAt, wordTime, type SpeechLine, type BubbleCaption } from '@minimoji/react';

export interface Beat { at: number; look?: string; mood?: string; gesture?: string; react?: string }
export interface Slide {
  id?: string; say: string; pos?: 'center' | 'left' | 'right'; gesture?: string; mood?: string; wash?: string; dark?: boolean;
  reveals?: { word: string; selector: string }[]; beats?: Beat[];
  wait?: { for: string; prompt?: string; nudge?: string; nudgeAfterMs?: number };
  next?: string | Record<string, string>;
}
export interface Deck { character?: { id: string }; holdMs?: number; slides: Slide[]; ending?: { pos?: string; mood?: string } }
export interface PresenterHandle { done(event: string, value?: string): boolean; skip(): void; start(at?: number): void }
export interface PresenterDeckProps {
  deck: Deck;
  /** where slide<N>.wav + .json live, with a trailing slash */
  lines: string;
  /** a slide's own content; `revealed` holds the reveal selectors its words have said so far */
  slide: (s: Slide, index: number, revealed: ReadonlySet<string>) => ReactNode;
  /** the head's still while it loads (img/agent.webp in the starter) */
  poster: string;
  ending?: ReactNode;
  onStep?: (e: { index: number; id: string }) => void;
  onWaiting?: (e: { index: number; id: string; for: string; prompt: string | null }) => void;
  onDone?: (e: { index: number; id: string; for: string; value?: string }) => void;
  onEnded?: (e: { skipped: boolean }) => void;
}

/** where a slide goes next: `next` by value, `next` as one id, else in order; 'end' ends */
export function nextIndex(deck: Deck, i: number, value?: string): number | 'end' {
  const s = deck.slides[i], pick = s.next == null ? null : typeof s.next === 'string' ? s.next : s.next[String(value)];
  if (pick === 'end') return 'end';
  const at = pick == null ? -1 : deck.slides.findIndex((x) => x.id === pick);
  if (pick != null && at < 0) console.warn(`minimoji-presenter: slide ${s.id ?? i} names no slide "${pick}"; going on in order`);
  return at >= 0 ? at : i + 1 < deck.slides.length ? i + 1 : 'end';
}

type Loaded = { line: SpeechLine | null; audio: string | null };
/** a file, or null with one console line: a slide without its clip still plays, silently on its own clock */
const get = <T,>(url: string, name: string, read: (r: Response) => Promise<T>): Promise<T | null> => fetch(url)
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return read(r); })
  .catch((error) => { console.warn(`minimoji-presenter: no ${url} (${error?.message ?? error}); ${name} plays silently`); return null; });
const load = async (base: string, name: string): Promise<Loaded> => {
  const [line, audio] = await Promise.all([
    get(`${base}${name}.json`, name, (r) => r.json()),
    get(`${base}${name}.wav`, name, async (r) => URL.createObjectURL(await r.blob())),
  ]);
  return { line, audio };
};
const CLIP_WAIT_MS = 8000;
/** silent text in the bubble (a waiting step's prompt or nudge): one caption, no word lit */
const textCaps = (text: string): BubbleCaption[] => capsFromLine(null, text).map((c) => ({ ...c, words: c.words.map((w) => ({ ...w, start: Infinity, end: Infinity })) }));

export const PresenterDeck = forwardRef<PresenterHandle, PresenterDeckProps>(function PresenterDeck(
  { deck, lines, slide, poster, ending, onStep, onWaiting, onDone, onEnded }, ref) {
  const anchor = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [index, setIndex] = useState(-1);          // -1: before Play
  const [ended, setEnded] = useState(false);
  const [waiting, setWaitingState] = useState<string | null>(null);
  const waitingRef = useRef<string | null>(null);   // done() may answer inside onWaiting, before a render
  const setWaiting = (w: string | null) => { waitingRef.current = w; setWaitingState(w); };
  const [caps, setCaps] = useState<BubbleCaption[]>([]);
  const [shown, setShown] = useState({ index: -1, lit: -1 });
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(new Set());
  const clips = useMemo(() => deck.slides.map((_, i) => load(lines, `slide${i}`)), [deck, lines]);   // all in memory first
  const run = useRef<{ i: number; gen: number | null; start: number; line: SpeechLine | null } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const indexRef = useRef(index);
  indexRef.current = index;

  const advance = useCallback((value?: string) => {
    const i = indexRef.current, next = nextIndex(deck, i, value);
    if (next === 'end') { setEnded(true); onEnded?.({ skipped: false }); } else play(next);
  }, [deck]);   // eslint-disable-line react-hooks/exhaustive-deps -- play reads refs
  const lineEnded = useCallback((gen: number | null) => {
    const r = run.current; if (!r || r.gen !== gen) return;
    run.current = null;
    const s = deck.slides[r.i];
    setRevealed(new Set((s.reveals ?? []).map((x) => x.selector)));
    if (s.wait) {
      setWaiting(s.wait.for);
      if (s.wait.prompt) { setCaps(textCaps(s.wait.prompt)); setShown({ index: 0, lit: -1 }); }
      onWaiting?.({ index: r.i, id: s.id ?? `slide${r.i}`, for: s.wait.for, prompt: s.wait.prompt ?? null });
      if (s.wait.nudge) timer.current = setTimeout(() => { setCaps(textCaps(s.wait!.nudge!)); setShown({ index: 0, lit: -1 }); }, s.wait.nudgeAfterMs ?? 8000);
      return;
    }
    timer.current = setTimeout(() => advance(), deck.holdMs ?? 250);   // the line's end, then the hold: never a timer
  }, [deck, advance, onWaiting]);
  const player = useLine({ onEnd: (gen, reason) => { if (reason !== 'stopped') lineEnded(gen); } });

  async function play(i: number) {
    clearTimeout(timer.current); player.stop();
    run.current = null;   // the old slide's run ends here, not when the new clip arrives
    indexRef.current = i;
    setIndex(i); setEnded(false); setWaiting(null); setRevealed(new Set()); setShown({ index: 0, lit: -1 });
    const s = deck.slides[i];
    onStep?.({ index: i, id: s.id ?? `slide${i}` });
    const late = { line: null, audio: null, late: true };
    let clip: Loaded & { late?: boolean } = await Promise.race([clips[i], new Promise<typeof late>((r) => setTimeout(() => r(late), CLIP_WAIT_MS))]);
    if (clip.late) console.warn(`minimoji-presenter: slide${i}'s clip took over ${CLIP_WAIT_MS / 1000} s; it plays silently`);
    if (indexRef.current !== i) return;
    run.current = { i, gen: null, start: performance.now(), line: clip.line };
    try {
      setCaps(capsFromLine(clip.line, s.say));
      if (!audio.current) audio.current = new Audio();
      if (clip.audio) audio.current.src = clip.audio;
      run.current.gen = clip.line ? player.say(clip.line, { audio: clip.audio ? audio.current : null }) : null;
    } catch (error) {   // a line the player refuses plays the slide silently, never stalls it
      console.warn(`minimoji-presenter: slide${i}.json is not a line; it plays silently`, error);
      clip = { line: null, audio: null };
      run.current = { i, gen: null, start: performance.now(), line: null };
      setCaps(capsFromLine(null, s.say));
    }
    if (!clip.line) timer.current = setTimeout(() => run.current && lineEnded(run.current.gen), s.say.split(/\s+/).length * 360 + 400);
  }

  // one frame loop: the caption and its lit word from the audio's clock (or the silent clock), reveals on their word
  useEffect(() => {
    let raf = 0;
    let warned = false;
    const frame = () => {
      raf = requestAnimationFrame(frame);   // first: nothing below can stop the loop
      try { step(); } catch (error) { if (!warned) { warned = true; console.warn('minimoji-presenter: a frame failed; the show goes on', error); } }
    };
    const step = () => {
      const r = run.current;
      if (r) {
        const s = deck.slides[r.i];
        const t = audio.current && !audio.current.paused && !player.silent ? audio.current.currentTime : (performance.now() - r.start) / 1000;
        const at = captionAt(caps, t);
        setShown((p) => (p.index === at.index && p.lit === at.lit ? p : at));
        const due = (s.reveals ?? []).filter((x, k) => t >= wordTime(r.line, x.word, k + 1)).map((x) => x.selector);
        setRevealed((p) => (due.length === p.size ? p : new Set(due)));
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [caps, deck, player.silent]);

  useImperativeHandle(ref, () => ({
    done(event, value) {
      const waiting = waitingRef.current;
      if (waiting !== event) { console.warn(`minimoji-presenter: done("${event}") but the deck waits for ${waiting ?? 'nothing'}`); return false; }
      const i = indexRef.current, s = deck.slides[i];
      clearTimeout(timer.current); setWaiting(null);
      onDone?.({ index: i, id: s.id ?? `slide${i}`, for: event, value });
      advance(value);
      return true;
    },
    skip() { clearTimeout(timer.current); player.stop(); run.current = null; setEnded(true); onEnded?.({ skipped: true }); },
    start(at = 0) { void play(at); },   // call it from a click: browsers allow sound after a person's click only
  }));

  const s = index >= 0 ? deck.slides[index] : deck.slides[0];
  const cap = caps[shown.index < 0 ? caps.length - 1 : shown.index];
  return (
    <section className={`pd-card${waiting ? ' is-waiting' : ''}${ended ? ' is-ended' : ''}${s.dark ? ' is-dark' : ''}`}
      data-pos={ended ? deck.ending?.pos ?? 'left' : s.pos ?? 'center'} style={{ background: s.wash ?? '#fff' }}>
      {ended ? ending : slide(s, Math.max(0, index), revealed)}
      {index < 0 && <button className="pd-play" type="button" onClick={(e) => e.isTrusted && play(0)}>▶ Play</button>}
      <div className="pd-character">
        {!ended && index >= 0 && cap && (
          <div className="pd-bubble" role="status" aria-live="polite">
            <p className="pd-bubble-text">{cap.words.map((w, n) => <span key={n} className={n === shown.lit ? 'is-lit' : undefined}>{n ? ' ' : ''}{w.text}</span>)}</p>
          </div>
        )}
        <div ref={anchor} className="pd-head" data-minimoji="loading"><MinimojiHeadPoster src={poster} /></div>
      </div>
      <MinimojiStage>
        <MinimojiHead avatar={{}} character={deck.character ?? { id: 'agent' }} anchor={anchor} emotes={false} bursts={false}
          expression={ended ? 'joy' : player.expression ?? 'happy'} performance={player.performance} cue={player.cue} />
      </MinimojiStage>
    </section>
  );
});
