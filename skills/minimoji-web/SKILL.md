---
name: minimoji-web
description: Add Minimoji 3D avatar heads to a React or Next.js web app with @minimoji/react — use when asked to "add Minimoji" to a web page, show a Mini avatar head or a character (D.A.S.H., an alien, an animal, the penguin, the ghost), make a head talk with lip-sync and emotes from audio or a recorded line, cue a mood or gesture, show the head's loader, or get a Minimoji key for a web app.
---

# @minimoji/react: Minimoji heads in a web app

`@minimoji/react` draws **live Minimoji heads in the browser**: one
`<MinimojiStage>` per page (a WebGL canvas), and `<MinimojiHead>`s placed
over ordinary DOM elements (their **anchors**). A head is built on the page
from its avatar JSON or a character id: drawing one fetches nothing and needs
no key. The head already blinks, breathes, glances, emotes on a mood change,
lip-syncs what you feed it and talks naturally while it does; build on that,
never redraw it.

This file is the rules and the smallest snippets. Every `tsx` snippet here is
typechecked against the package's `src/index.d.ts` by a test in the Minimoji
repo, so it compiles against the version you have. The full API is
`src/index.d.ts` and `README.md` in the package. The minimoji.com homepage is
the reference integration: its hello row and cast conversation are built
exactly as section 4 shows.

## 1. Install

`@minimoji/react` is **not on npm yet**: ask Minimoji for access. In the
Minimoji monorepo it is `"@minimoji/react": "workspace:*"`. Its peers:

```sh
npm install react@19 react-dom@19 three@0.160 @react-three/fiber@9
```

- It is plain ESM with types, no build step. In Next.js it renders on the
  client only: put `'use client'` on the file that mounts the stage.
- WebGL: a stage needs a browser. Server-render the anchors and the poster
  (section 4), never the stage.

## 2. One head

```tsx
'use client';
import { useRef } from 'react';
import { MinimojiStage, MinimojiHead, type AvatarInput } from '@minimoji/react';

// the same JSON the avatar service and the Swift Kit take; the same document is always the same head
const me: AvatarInput = { seed: 4821, head: 'round', skin: 'brown', hair: { style: 'afro', color: 'ink' } };

export function Me() {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} data-minimoji="loading" style={{ position: 'relative', width: 160, height: 160 }} />
      <MinimojiStage>
        <MinimojiHead avatar={me} anchor={anchor} expression="happy" look="mouse" />
      </MinimojiStage>
    </>
  );
}
```

- **The anchor is a DOM element outside the stage.** The stage's children
  render inside its WebGL canvas: only `MinimojiHead` and `MinimojiShadow`
  go there, never a `<div>`. The head is placed in its anchor's rect every
  frame, so the anchor can live anywhere on the page, scroll, move or resize.
- `anchor` is required in the default `mode="overlay"`; without it the head
  is built and never placed.
- A saved avatar is stored by its **avatar key**; keep the document (or
  fetch it by key from the service) to draw it live. `avatarKey(avatar)` is
  the normalized JSON, for React keys and caches.
- `look`: `'mouse'` (follows the pointer anywhere), `'near'` (within
  `reach` px), `'idle'` (glances about on its own), `{ x, y }` in −1…1,
  `null` (the camera), `'manual'` (you call `head.life.lookAt`).

### A character: D.A.S.H., an alien, an animal

```tsx
'use client';
import { useRef } from 'react';
import { MinimojiStage, MinimojiHead } from '@minimoji/react';

export function Dash() {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} data-minimoji="loading" style={{ position: 'relative', width: 160, height: 160 }} />
      <MinimojiStage>
        {/* `avatar` is still required: a character draws instead of it */}
        <MinimojiHead avatar={{}} character={{ id: 'agent' }} anchor={anchor} expression="joy" />
      </MinimojiStage>
    </>
  );
}
```

- Ids: `agent` (D.A.S.H.), its themes (`dashGold`, `dashNeon`, …), the
  aliens (`alien`, `alienMint`, …), `cat`, `kitty`, `rabbit`, `monkey`,
  `dog`, `penguin`, `ghost`. The service's `GET /capabilities` lists them
  (`characters`), and `CHARACTERS` in `@minimoji/react/characters`.
- A dealt one (`dashDealt`, `alienDealt`) takes a `seed`: the same seed is
  the same face. `{ id, pick }` fixes parts of a kit.
- Play a character exactly like a person: expressions, cues, talking,
  listening. No per-species code; D.A.S.H. draws its mouth on its screen.

### The stage

- **One `<MinimojiStage>` per page**, high in the tree, holding every head.
  It is fixed over the page and transparent (`mode="overlay"`, the default).
  `mode="wall"` is the opaque viewer wall: the head sits in the stage's
  own box (give it a size with `style`), no anchor.
- `mode` is fixed for the stage's life: change its `key` to switch.
- `detail` (0.2–1, default 1) is the mesh detail for the page; the
  homepage runs `.8` with about thirty heads.
- `surfaces` (on by default) paints each head into a 2D canvas inside its
  anchor, so heads scroll with the page on the compositor. Mark an ancestor
  `data-minimoji-surface` to have its heads share one canvas: do it for a
  group shot, and wherever the anchor clips its overflow.

## 3. Showing a head while it loads

Do not draw your own placeholder. A head is built a moment after the page
paints; until it lands, `<MinimojiHeadPoster>` inside the anchor shows the
local silhouette immediately, then the head's own still: it comes in soft
and breathes, then gives way with a puff
when the head is ready, stays sharp on an error, and is a plain swap under
reduced motion. The silhouette takes `currentColor` (set `style.color` to a
contrasting tile tint), fades as the still arrives, and stays sharp if the
still fails. The same loader as the homepage and the Swift Kit.

```tsx
'use client';
import { useRef } from 'react';
import { MinimojiStage, MinimojiHead, MinimojiHeadPoster, type AvatarInput } from '@minimoji/react';

export function SavedHead({ avatar, avatarKey, service }: { avatar: AvatarInput; avatarKey: string; service: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={anchor} data-minimoji="loading" style={{ position: 'relative', width: 160, height: 160 }}>
        <MinimojiHeadPoster src={`${service}/avatars/${avatarKey}.png?size=256`} />
      </div>
      <MinimojiStage>
        <MinimojiHead avatar={avatar} anchor={anchor} />
      </MinimojiStage>
    </>
  );
}
```

- It runs off the anchor's `data-minimoji` (`loading` → `ready` |
  `error`, set by the head). Write `data-minimoji="loading"` in your
  markup so it runs from the first paint, server-rendered or not; give the
  anchor `position: relative`.
- The still: a saved avatar's `<service>/avatars/<avatarKey>.png?size=256`
  (drawn at save), or any transparent picture of the head. A character has
  no saved picture until it is saved: ship your own still (the homepage
  ships `.webp` stills), or no poster.
- No app CSS: the sheet is a React 19 hoisted `<style>`. Without React's
  hoisting, add `POSTER_CSS` to a stylesheet. `style` re-places the still
  (`{ inset: 'auto', left, top, width, height }`); `puff={false}` drops
  the puff.

## 4. Making it talk

**Feed the head speech and the rest follows**: the mouth articulates (lips
meet on m/b/p), the breath follows the phrases, and natural talk
(`naturalTalk`, on by default) plans glances aside and lifts the brows on the
pitch. Moods ride on top as emotes. Never hand-draw talking frames or animate
the jaw yourself.

From least to most:

- `talking={2}` (seconds) or `talking={true}`: a generic talking jaw, no
  audio. A changing number (`Date.now()`) re-triggers it.
- `voiceLevel={0…1}` (a call's level meter): drives the optional sound arcs
  or lines (`talkStyle="arcs" | "lines"`; the default `'mouth'` is the jaw
  alone). It does not move the jaw.
- **`performance`**: the real lip-sync. A function the head calls every
  frame, returning the mouth for that moment of the audio. From a recorded
  line, `mouthTrack` turns the clip's samples into one mouth per 1/60 s:

### Say a line: one call

**Hand the head the audio.** `useLine().say({ audio, transcript })` makes
the head lip-sync to it, emote and caption it, with no timeline and no
lip-sync code in your app. The SDK fetches the clip, decodes it with Web
Audio, builds the line with `buildLine` (the analyser the homepage's lines
are made with) and caches it. `prepare(clip)` does that ahead of time, so the
click starts the line at once.

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { MinimojiStage, MinimojiHead, MinimojiCaptions, useLine, type SpeechClip } from '@minimoji/react';

const HEY: SpeechClip = { audio: '/voice/dash-hey.mp3', transcript: 'Hey! I am D.A.S.H.', mood: 'happy' };

export function DashSaysHey() {
  const anchor = useRef<HTMLButtonElement>(null);
  const line = useLine({ onEnd: (_g, reason, error) => { if (reason === 'failed') console.warn(error); } });
  // build it ahead of the click, so the click's play() runs inside the gesture
  useEffect(() => { line.prepare(HEY).catch(() => {}); }, []);
  return (
    <>
      <button ref={anchor} type="button" aria-label="Say hi to D.A.S.H." data-minimoji="loading"
        onClick={() => line.say(HEY)}
        style={{ position: 'relative', width: 160, height: 160 }} />
      <MinimojiCaptions player={line} />
      <MinimojiStage>
        <MinimojiHead avatar={{}} character={{ id: 'agent' }} anchor={anchor} emotes={false}
          expression={line.expression ?? 'neutral'} performance={line.performance} cue={line.cue} />
      </MinimojiStage>
    </>
  );
}
```

- **The clip** is `{ audio, transcript?, words?, letters?, alignment?, captions?, mood?, cues?, transcribe? }`.
  `audio` can be a URL, a `Blob` (a TTS response), an `ArrayBuffer` or an
  `AudioBuffer`. `words` (`[{ text, start, end }]` in seconds, from your TTS
  provider's timestamps) give phrase captions and word cues, such as a nod on
  "yes" or a laugh on "haha". A `transcript`, or a `captions` string, gives
  one caption over the voiced part. With none of these there are no
  captions. Clips are cached by URL (or by the `Blob` or buffer object)
  together with their words and letters, keeping the last 8.
- **Pass your TTS alignment and the lips land on the letters.** A provider's
  per-character timestamps shape the mouth from the words instead of guessing
  from the sound: the lips meet on m, b and p and only there, and a vowel
  never snaps shut. Hand ElevenLabs' `with-timestamps` reply over as it comes,
  `say({ audio, words, alignment: tts.alignment })`, or as `letters`
  (`[{ text, start, end }]`, one character each with the spaces, seconds;
  `lettersFromAlignment` from `@minimoji/react` builds them). Words only (a
  transcriber's) spread into letters with `lettersFromWords`. Without letters the mouth is guessed from the audio, as
  before. A URL that serves new audio
  each time needs a fresh URL per clip, or pass the `Blob`.
- **Any voice, not only ElevenLabs.** Every provider's timings become our
  words (`[{ text, start, end }]`, seconds) with a small reader from
  `@minimoji/react` (also in `/sdk/minimoji-heads.js`); then
  `say({ audio, words, letters: lettersFromWords(words) })`:

  | Provider | What it gives | Reader |
  |---|---|---|
  | ElevenLabs with-timestamps | characters + start/end arrays | `alignment: tts.alignment` (or `lettersFromAlignment`); `wordsFromAlignment(tts.alignment)` for the words |
  | ms words you stored | `{ text, startMs, durationMs }` | `wordsFromMs(words)` |
  | Azure Speech | WordBoundary events: `text`, `audioOffset` + `duration` in 100 ns ticks | `wordsFromAzure(events)` (punctuation boundaries skipped) |
  | Amazon Polly | speech marks: JSON lines `{ time (ms), type: "word", value }` | `wordsFromPolly(marks, clipSeconds)` (a word ends where the next starts; a cut-off line throws) |
  | Cartesia | `word_timestamps: { words, start, end }` (seconds) | `wordsFromCartesia(word_timestamps)` (one or a stream's pieces) |
  | Dictation, Scribe | words only | `lettersFromWords(words)` |
  | OpenAI TTS, any voice with no timings, a human take | nothing | `say({ audio, transcript: 'what it says', transcribe: true })`: the service aligns the text to the audio |

  Spread letters are an estimate (the lips still meet inside the right
  word); a provider's characters, or the service's alignment, are exact.
- **No audio, only words? Say the text.** Give `useLine` a `synthesize`
  (your publishable key and the service) and say `{ text, voice }`: Minimoji's
  `POST /lines/say` speaks it on its own ElevenLabs voice and answers the
  WAV and the line built on it, the letters timed on that very audio, so the
  mouth timings come from the call that made the sound. `voice` is a name from
  `GET /lines/voices` (`dash` is D.A.S.H.: Brian with the robot effect;
  `person`, `alien`, `cat`, `penguin`, `ghost`…), or one of their ids as
  `{ voiceId, effect: 'robot', settings }`; any other ElevenLabs voice id
  needs your own key (below), since Minimoji's account speaks only its
  catalogue. A text past about 60 s of speech (~900 characters at speed 1)
  is refused before anything is spent. `prepare({ text, voice })` ahead
  of the click makes the say start inside it (a repeat is never asked again):

  ```tsx
  'use client';
  import { useEffect } from 'react';
  import { useLine, MinimojiCaptions, type TextClip } from '@minimoji/react';

  const HI: TextClip = { text: "[happy] Hi, I'm D.A.S.H.!", voice: 'dash' };

  export function DashSaysHi() {
    const line = useLine({ synthesize: { key: process.env.NEXT_PUBLIC_MINIMOJI_KEY!, service: process.env.NEXT_PUBLIC_MINIMOJI_SERVICE_URL! } });
    useEffect(() => { line.prepare(HI).catch(() => {}); }, []);
    // wire line.performance / line.cue / line.expression to a <MinimojiHead> as above
    return (
      <>
        <button type="button" onClick={() => line.say(HI)}>Say hi</button>
        <MinimojiCaptions player={line} />
      </>
    );
  }
  ```

  `[tags]` set the face. On Minimoji's voice a key has 5,000
  characters a UTC day (a repeat of the same line costs none: it is served
  from the cache), then a 429 with the reset. **Bring your own ElevenLabs
  key** for no character quota and any voice on your account: `synthesize: { key, service, elevenLabsKey }`
  sends it in the `ElevenLabs-Key` header (never a query string; it is used
  for the one call and never stored or logged); the minute limit stays.
  Calling it yourself: `POST /lines/say` with `Authorization: Bearer mk_pub_…`
  and `{ text, voice, mood? }` answers `{ audio, line, words, letters,
  durationMs, cached, charged }`; play `say(answer.line, { audio:
  answer.audio })`. **Audio you process afterwards** (isolated, mixed, sped
  up) no longer matches those letters: send the final clip with its text to
  `POST /lines` (multipart `{ audio, text }`, below) for letters aligned on it.
  From a terminal: `npx minimoji say kai "Hi" --server` writes the same
  `<name>.wav` + `<name>.json` on your Minimoji key.
- **Clips you already have, in a batch:** `npx minimoji lines ./clips --texts lines.json --timings`
  sends each clip (`.wav`, or `.mp3`/`.m4a` with ffmpeg) with its text to
  `POST /lines` on your Minimoji key and writes `<name>.json` (the playable
  line: `say(line, { audio })`) beside it; `--timings` adds
  `<name>.timings.json` (`{ transcript, words, letters, alignedTo, loss }`)
  for an app that keeps its own line format. The text comes from `--text`,
  `--texts` (`{ "<name>": "text" }` or `{ "<name>": { text } }`) or a
  `<name>.txt` beside the clip; a clip with none is transcribed. `--dry-run`
  sends nothing. Each clip is one of the key's 200 lines a day, at most 30 s.
- **A voice note with no transcript** (a recording a person made, a voice
  chat message): pass your publishable key and the service to `useLine`, and
  say the audio alone. The SDK sends it to Minimoji's `POST /lines`, which
  transcribes it, and the line plays with phrase captions and word cues:

  ```tsx
  'use client';
  import { useLine, MinimojiCaptions } from '@minimoji/react';

  export function VoiceNote({ note }: { note: Blob }) {   // a Blob from MediaRecorder, a URL or bytes
    const line = useLine({ transcribe: { key: process.env.NEXT_PUBLIC_MINIMOJI_KEY!, service: process.env.NEXT_PUBLIC_MINIMOJI_SERVICE_URL! } });
    // wire line.performance / line.cue / line.expression to a <MinimojiHead> as above
    return (
      <>
        <button type="button" onClick={() => line.say({ audio: note, transcribe: true })}>Play</button>
        <MinimojiCaptions player={line} />
      </>
    );
  }
  ```

  With `transcribe` on the hook, a clip with no `words`, `transcript` or
  `captions` is transcribed even without `transcribe: true`, and if that
  fails (over 30 s, offline, the key's 200 a day spent) it plays as the plain
  waveform line with a console warning. With `transcribe: true` a failure
  ends the say `onEnd(…, 'failed', error)` with the service's words.
  `transcribe: false` never sends it. The SDK decodes any audio the browser
  plays and sends it as a 16 kHz WAV; if you call `POST /lines` yourself,
  send a WAV (it refuses mp3, m4a and webm, whose length it cannot check).
  **Know what it says?** Give the clip its `transcript` with
  `transcribe: true` (and no words or letters): the SDK sends the text too,
  the service force-aligns that script to the audio instead of transcribing
  it, and the lips follow the words as written (the answer says
  `alignedTo: 'text'`; a high `loss` means text and audio disagree; a
  transcript with no words outside its `[tags]`, or over 2,000 characters,
  is transcribed as before). Calling
  it yourself: `multipart/form-data` with `audio` (the WAV) and `text`
  (at most 2,000 characters; `[tags]` are kept off the aligner and set the
  face). **Privacy:**
  the audio (and the text, if given) is sent to Minimoji and to ElevenLabs for transcription or alignment and is
  not stored. Tell your people so where they record. The vanilla bundle's
  `createVoicedPerformance({ …, transcribe: { key, service } })` does the same.
- **Not prepared?** `say` still works. The line starts once it has been built
  (about 20 ms per second of audio on a laptop). `line.preparing` is true
  until then, and the head stays as it is.
- **A clip that fails** (it will not load, it is not audio, or it runs past
  60 s) never throws and never hangs. The head stays still,
  `onEnd(generation, 'failed', error)` reports it, and `line.error` holds the
  error until the next `say`.
- **A prebuilt line** is the fast path: a `*.timeline.json` (the public format
  in `docs/speech-line-format.md`: mouth frames at 60 fps, captions,
  optional timed words, mood and gesture cues), played with
  `line.say(timeline, { audio: '/lines/dash-hey.mp3' })`. The homepage's
  hellos run on this. Use it when you build lines ahead of time.
- **No React?** The site serves `/sdk/minimoji-heads.js`
  (`apps/web/public/sdk/`), a single ESM file with three bundled. It provides
  `mountHeadPerformance` and `createVoicedPerformance`, whose
  `select({ audio, transcript })` takes the same plain clip, plus
  `createLineSession` (this hook without React) and `createClipCache`.
- **`emotes={false}` on a talking head**, set once: the line's strong mood
  cues emote through `cue`, quiet ones (k under 0.35) only change
  `expression`, gestures play through `cue`. `expression` is null between
  lines, so yours applies.
- **Never hangs.** If `play()` is refused (autoplay blocked), the audio
  errors or its clock stalls (1.5 s; 4 s before it first moves), the line
  carries on a silent clock: mouth and captions still run, and it ends.
- **The newest `say` wins** (a generation token): it cuts the line before
  it, and a late promise or event from the old one does nothing. `stop()`
  and unmounting end it.
- **`audio`** (with a prebuilt line): a URL (the hook makes and frees the
  element), your own `HTMLAudioElement` (paused, never freed), or none (the
  silent clock).
- **Captions**: phrases by default — at most four words, broken after
  punctuation, the word being said lit (`data-lit`) and staying lit through
  the pause after it; the first phrase shows before the voice starts and the
  last stays a second after it ends; a new phrase moves up. `mode="window"`
  is the Kit 9.44 sliding window (about 7 words / 40 characters). Reduced
  motion shows the whole line, still; `maxLines={1}` keeps it to a subtitle
  slot (then an ellipsis). A screen reader hears the whole line once per
  line (the moving words are hidden from it). Style the box with
  `className` / `style`; it must survive 200% text.
- **Making a line ahead of time** from your own audio and timed words (a
  TTS provider's timestamps, dictation): `buildLine({ pcm, sampleRate, words, mood })` from
  `@minimoji/react/line`, offline (what `say({ audio })` runs for you); `packages/engine/dev/line-from-words.mjs`
  converts ElevenLabs-style `{ text, startMs, durationMs }` words plus the
  clips. Never derive mouth shapes from letters. `mood` sets the opening
  face quietly (no emote burst at the start); audio tags in the words
  (`[excited]`, `[curious]`, `[whispers]`…) leave the captions and become
  quiet face changes at their word (`TAG_MOODS`), `[laughs]` a laugh.

#### Directing the line: your own cues, a look, stage directions

A script can time the head to its words. `clip.cues` are your cues, merged
with the ones the SDK derives (a nod on "yes"…); `at` is seconds or a word
of the clip (`{ word: 7 }`, an index into the timed words from 0, or
`{ word: 'card', nth? }`). The stored line holds seconds. A word the clip
does not say fails the say, naming the word.

```tsx
import type { RefObject } from 'react';
import { lookTargetFor, type LinePlayerApi } from '@minimoji/react';

// `line` is your useLine(); `words` your TTS provider's timed words; the refs your head's anchor and the card
export function present(line: LinePlayerApi, audio: string, words: { text: string; start: number; end: number }[],
                        anchor: RefObject<HTMLDivElement | null>, card: RefObject<HTMLDivElement | null>) {
  line.say({ audio, words, cues: [
    { at: { word: 7 }, gesture: 'knowing-nod' },
    { at: 3.2, look: { x: .6, y: -.2 }, hold: 2 },                            // eyes up-right for 2 s
    { at: { word: 'card' }, look: lookTargetFor(card.current!, anchor.current!) },  // at the card on the page
  ] });
}
```

| cue | does |
| --- | --- |
| `{ at, mood, k? }` | a face (k under 0.35: quietly, no emote) |
| `{ at, gesture }` | one of the engine's tracks (`knowing-nod`, `head-shake`…) |
| `{ at, nod: true }` / `{ at, shake: true }` | the face's own nod / shake |
| `{ at, brow: 'up' \| 'down', k }` | a brow accent |
| `{ at, look, hold? }` | eyes on `{ x, y }` (−1…1, + right / up), `'away'` (aside, alternating sides) or `'viewer'` (back to you), for `hold` s (1.2 by default), then the head's own gaze |

Tags in the words or transcript do the same with no code, and leave the
captions: `[nod]` `[shake]` `[brow]` `[brow down]` `[look away]`
`[look back]` `[smile]` (plus the mood tags, `[surprised]`…). An authored
gesture, brow or look within 0.6 s of a derived one replaces it. The look
rides in `line.performance` (and `line.look`), so the head needs nothing
new. `lookTargetFor(el, anchorEl)` turns two DOM rects into the `{ x, y }`.

**No line at all (a game's NPC, a party host):** `playCues(stage, cues, clock?)`
plays the same cues (seconds from the start) on their own clock, through the
same dispatch. `cueStage(head.life)` is the stage for one head (`onReady`
hands you the head; give that `<MinimojiHead>` `look="manual"` so its own look
setting does not take the eyes back). With no `clock` it runs on timers; with
one (`() => seconds`) call `tick()` from your game loop. It returns
`{ tick, stop, done }`.

### Driving the mouth yourself (your own clock)

For live or decoded audio with no line: `mouthTrack` turns samples into one
mouth per 1/60 s, and a `performance` you write reads your own clock:

```tsx
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MinimojiStage, MinimojiHead, mouthTrack, type GlossFace, type MouthFrame, type PerformanceInput } from '@minimoji/react';

// the clip, and the mood its word lands on (seconds into the clip)
const LINE = { audio: '/lines/dash-hey.mp3', cue: { at: 0.24, mood: 'happy' as GlossFace } };

export function DashSaysHey() {
  const anchor = useRef<HTMLButtonElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const frames = useRef<MouthFrame[] | null>(null);
  const cued = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const [cue, setCue] = useState<{ mood: GlossFace; generation: number } | null>(null);

  // decode the line ahead of the click: the click's play() must run inside the gesture
  useEffect(() => {
    let live = true;
    const ctx = new AudioContext();
    fetch(LINE.audio).then(r => r.arrayBuffer()).then(bytes => ctx.decodeAudioData(bytes))
      .then(clip => { if (live) frames.current = mouthTrack(clip.getChannelData(0), clip.sampleRate); })
      .catch(() => {}).finally(() => void ctx.close());
    return () => { live = false; audio.current?.pause(); };
  }, []);

  // called by the head every frame while it speaks: one stable function, reading the audio's own clock
  const perform = useCallback<PerformanceInput>(() => {
    const a = audio.current, f = frames.current;
    if (!a || !f || a.paused) return { active: false };
    if (!cued.current && a.currentTime >= LINE.cue.at) {
      cued.current = true;
      setCue(c => ({ mood: LINE.cue.mood, generation: (c?.generation ?? 0) + 1 }));
    }
    const m = f[Math.min(f.length - 1, Math.floor(a.currentTime * 60))];
    return { active: true, mouth: { open: m.open, width: m.width, round: m.round } };
  }, []);

  const say = () => {
    if (!frames.current) return;
    const a = (audio.current ??= new Audio(LINE.audio));
    a.onended = () => setSpeaking(false);
    a.currentTime = 0; cued.current = false;
    a.play().then(() => setSpeaking(true), () => setSpeaking(false));
  };

  return (
    <>
      <button ref={anchor} type="button" onClick={say} aria-label="Say hi to D.A.S.H." data-minimoji="loading"
        style={{ position: 'relative', width: 160, height: 160 }} />
      <MinimojiStage>
        <MinimojiHead avatar={{}} character={{ id: 'agent' }} anchor={anchor}
          emotes={false} cue={cue} performance={speaking ? perform : null} />
      </MinimojiStage>
    </>
  );
}
```

- **Keep the source's identity stable** (`useCallback`, a ref, a module
  function) and read your own clock inside it (`audio.currentTime`). While
  set it owns gaze, mouth, beat and blinks; `expression` and `listening`
  stay yours. Set it to `null` when the voice ends: that releases the mouth.
- **Feed every frame while the voice plays**, silences included (the
  track's rest frames); a mouth not refreshed for 0.3 s closes.
- The homepage precomputes the same frames offline (60 fps,
  `[open, width, round, level, pitch]`, plus `captions` and `cues`) so
  nothing decodes on the page; `mouthTrack` in the browser is the same
  mouth. Return `{ active: false }` between lines: natural talk then
  plans the glance back to the visitor.
- Optional snapshot fields: `voiceLevel` (the arcs), `mouth.pitch`
  (semitones off the speaker's median: natural talk's brows), `blink` and
  `drop` (counters: bump to fire once), `beat` (the listening nod's clock).
- **Live audio** (a call, no recording): the engine's
  `createLiveVisemeTimeline` and `createSpeechVoice` (not in this package
  yet: ask Minimoji) are the web twins of the Swift Kit's
  `LiveVisemes` and `SpeechVoice`: PCM in, a viseme and a level out, eased
  into a mouth per head. **Look-ahead** (voice chat): delay the voice's
  playout by 100 ms on your side and pass `lookAhead: .1` to
  `createLiveVisemeTimeline` (settable later as `timeline.lookAhead`): the
  shapes lead the sound by 70 ms and the lips meet on m, b and p before
  they are heard. Not where the speaker hears themselves (their own mic):
  there it is only lag. It adds to `playoutOffset`. Without it a closure
  shows as the voice comes back; a fading vowel never shuts the mouth.

### Emotes with speech

Two ways, pick one per head:

- **The mood as an `expression`**: change `expression` and the head plays
  that mood's emote on the change (one of three, never the same one twice in a row).
- **Cued moods over a held face** (what the homepage does): `emotes={false}`
  so expression changes play nothing, and `cue={{ mood, generation }}` at
  the line's moments. A cue plays once per distinct value: bump
  `generation` to play the same mood again.

### A host that talks (onboarding, tours)

A character that says one line per screen: `useLine` plus a few rules.

- **One line per screen.** Start it on appear after a 250–500 ms lead-in;
  a tap on the head replays it. Pick lines at random, never the same one
  twice in a row.
- **Recorded audio plus its line** (above). Mouth, cues and captions all
  read one clock, the audio's, and `useLine` falls back to its silent clock
  on its own, so a blocked or muted start still moves the screen on.
- **Cancel by generation, not by unmount**: `say` already does. A late
  callback from an older screen's line does nothing, so an old screen's
  cleanup can't cut the new line.
- **Accessibility**: `<MinimojiCaptions>` announces each line once; make
  the head a button labelled "Replay" and hide off-screen duplicate heads
  from assistive tech.
- **The audio's owner and the head can live apart**: pass the `useLine()`
  value down, or hand `{ cue, expression, performance }` to the head through
  a small external store (`useSyncExternalStore`), as the homepage does.
- **Load the host early**, keep it mounted for the session, and show
  `MinimojiHeadPoster` until it lands (section 3).
- A character like D.A.S.H. reads about 10% larger than a person in the
  same anchor: size its anchor down a little.
- **Never break the host.** A missing clip, a line that won't parse, an
  audio error: fall back to the still head or the silent clock
  (`say(line)` with no audio still moves the mouth and captions), log it
  under one prefix, and never block the page on it.
- **Own long-lived things once**: the `useLine()` player in the component
  that stays mounted (or a module-level store), each line's JSON fetched and
  parsed once per page load, not per render.
- **Post-processing the provider's audio** (a robot filter, a pitch shift)
  must keep the exact duration: pad or trim back to the raw recording's
  sample count, or every word timing drifts against the mouth and captions.
- **Screen readers** hear the line once (`<MinimojiCaptions>` announces it),
  never the captions word by word. Skipping the audio while a screen reader
  runs is an option, not the rule.
- **A host on a sign-in page** (before auth): a character builds on the page
  from its id, so it needs no key and no network beyond your own bundle:
  ship its lines and clips with the page, and the form never waits on it.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { MinimojiStage, MinimojiHead, MinimojiCaptions, useLine, type SpeechLine } from '@minimoji/react';

export function OnboardingHost({ clip }: { clip: { audio: string; line: string } }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [data, setData] = useState<SpeechLine | null>(null);
  const line = useLine();
  useEffect(() => { fetch(clip.line).then(r => r.json()).then(setData).catch(() => {}); }, [clip.line]);
  // the screen's line after a short lead-in (blocked autoplay plays it on the silent clock)
  useEffect(() => {
    if (!data) return;
    const id = setTimeout(() => line.say(data, { audio: clip.audio }), 350);
    return () => clearTimeout(id);
  }, [data, clip.audio]);   // eslint-disable-line react-hooks/exhaustive-deps -- say is stable per hook
  return (
    <>
      <button ref={anchor} type="button" aria-label="Replay" data-minimoji="loading"
        onClick={() => data && line.say(data, { audio: clip.audio })} style={{ position: 'relative', width: 120, height: 120 }} />
      <MinimojiCaptions player={line} />
      <MinimojiStage>
        <MinimojiHead avatar={{}} character={{ id: 'agent' }} anchor={anchor} emotes={false}
          expression={line.expression ?? 'happy'} performance={line.performance} cue={line.cue} />
      </MinimojiStage>
    </>
  );
}
```

## 5. Moods and gestures

```tsx
'use client';
import { useRef, useState } from 'react';
import { MinimojiStage, MinimojiHead, GLOSS_FACES, type AvatarInput, type GlossFace } from '@minimoji/react';

export function Reacting({ avatar }: { avatar: AvatarInput }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [face, setFace] = useState<GlossFace>('neutral');
  const [cue, setCue] = useState<{ gesture: string; generation: number } | null>(null);
  return (
    <>
      <div ref={anchor} data-minimoji="loading" style={{ position: 'relative', width: 120, height: 120 }} />
      <select value={face} onChange={e => setFace(e.target.value as GlossFace)}>
        {GLOSS_FACES.map(f => <option key={f}>{f}</option>)}
      </select>
      <button type="button" onClick={() => setCue(c => ({ gesture: 'double-take', generation: (c?.generation ?? 0) + 1 }))}>Double take</button>
      <MinimojiStage>
        <MinimojiHead avatar={avatar} anchor={anchor} expression={face} cue={cue}
          onGestureEnd={(id, { cancelled }) => { if (!cancelled) console.log('done', id); }} />
      </MinimojiStage>
    </>
  );
}
```

- `expression` is one of `GLOSS_FACES` (`idle`, an alias of `neutral`; `neutral`, `happy`, `joy`,
  `laugh`, `sad`, `angry`, `furious`, `surprised`, `worried`, `scared`,
  `dead`, `smug`, `sleeping`, `crying`, `thinking`). A change plays the
  mood's emote unless `emotes={false}`.
- **Stickers**: a change to a mood also pops its comic stickers around the
  head (a "!" for `surprised`, sweat for `worried`, flames for `angry`,
  hearts for `happy`…), as MinimojiKit does. On by default; `bursts={false}`
  turns them off, and reduced motion shows none. Every mood above has them
  but `neutral`/`idle`. They fire on a CHANGE: never the first face, never
  the same face twice in a row, and at any strength (a line's quiet 0.3 cue
  pops them too); a change to `neutral` lets them fade, and so does the end
  of a line. Nothing to wire: a line's mood cues reach `expression`, so
  `useLine` lines pop them at each cue. The PNGs load from
  `https://www.minimoji.com/emote-bursts/` (allow it in `img-src`), or
  `<MinimojiStage burstBase="/your/copy/">`.
- `cue={{ gesture }}` plays one named track over the face as it is (the
  face never changes): `double-take`, `head-shake`, `sunny-nod`,
  `knowing-nod`, `ponder-tilt`, `side-eye-hmm`, `lightbulb`, … (the
  engine's authored tracks). `cue={{ mood }}` picks one of that mood's
  three. One shot only: chain the next from `onGestureEnd`, which always
  comes (cancelled when replaced, the next frame under
  `performances={false}`).
- To time moods, gestures and looks to a script (or play them with no audio
  in a game), see "Directing the line" in § 4: `clip.cues`, the `[nod]`-style
  tags and `playCues`.
- `performances={false}` stills every one-shot, cues included (reduced
  motion). To cue your own gestures over a beat, pass `emotes={false}`,
  not `performances={false}`.
- A mood from text: `POST <service>/expressions/pick` with
  `{ text, gesture: true }` answers `expression` (null: keep the face) and
  a `gesture`. Ask on a typing pause, never per keystroke.

### Poke and drag

```tsx
'use client';
import { useRef } from 'react';
import { MinimojiStage, MinimojiHead, type AvatarInput, type MinimojiHeadHandle } from '@minimoji/react';

export function Pokeable({ avatar }: { avatar: AvatarInput }) {
  const anchor = useRef<HTMLDivElement>(null);
  const head = useRef<MinimojiHeadHandle>(null);
  return (
    <>
      <div ref={anchor} data-minimoji="loading" style={{ position: 'relative', width: 160, height: 160 }} />
      <button type="button" onClick={() => head.current?.react('giggle')}>Tickle</button>
      <MinimojiStage>
        <MinimojiHead ref={head} avatar={avatar} anchor={anchor}
          interactive={{ poke: { reactions: ['oof', 'ah', 'flinch', 'dizzy'] }, drag: { maxPx: 60 }, label: 'Poke Dash' }}
          onPoke={({ reaction }) => console.log('poked:', reaction)}
          onDragEnd={({ distance, flung }) => console.log(distance, flung)} />
      </MinimojiStage>
    </>
  );
}
```

- `interactive` is off by default (no listener is attached); `interactive` alone (true) turns on both
  poke and drag. Only the head's skull counts: a press anywhere else in the anchor goes to the page.
- A poke plays a reaction: `oof` (squash + wince), `ah` (surprised hop back), `flinch` (recoils away from
  the poke), `giggle` (laugh + shake) or `dizzy` (× eyes + wobble). Never the same one twice in a row, one
  at a time with a short cooldown. `poke.reactions` replaces the pool (unknown names warn once, skipped).
- It works idle, paused or mid-line: the face changes for a moment and lip-sync carries on under it. A poke
  never stops a line: pause it yourself from `onPoke` if you want to. No sound ships: play your own there.
- A drag pulls the head on a rubber band (toward `drag.maxPx`, 80 css px, never past), tilted toward the
  pull; it springs back with a wobble. A fast release is a fling and plays `dizzy`. A touch that starts on
  the head drags it instead of scrolling the page; anywhere else the page scrolls as usual. A head painted
  into its own anchor is cut at the anchor's padded box, so its drag stops there; give a group a
  `data-minimoji-surface` frame for more room.
- `ref.current.react(name?)` plays one from code (with no name, one from the pool), interactive or not,
  and answers what played (null for an unknown name). React 19 passes `ref` as a prop.
- Events: `onPoke({ reaction })`, `onDragStart()`, `onDragEnd({ distance, flung })`.
- The anchor becomes a button (`role="button"`, focusable, `label` as its name, default "Poke the
  avatar"): Enter or Space pokes it. Under reduced motion nothing moves; the faces still change.
- The vanilla bundle (`/sdk/minimoji-heads.js`) takes the same `interactive`, `onPoke`, `onDragStart` and
  `onDragEnd` options on `mountHeadPerformance`, and its stage has `react(name?, id?)`.

## 6. Listening, presence and thinking

```tsx
'use client';
import { useEffect, useRef } from 'react';
import { MinimojiStage, MinimojiHead, type AvatarInput, type Head } from '@minimoji/react';

export function Friend({ avatar, online, typing, music }: { avatar: AvatarInput; online: boolean; typing: boolean; music: boolean }) {
  const anchor = useRef<HTMLDivElement>(null);
  const head = useRef<Head | null>(null);
  // presence and thinking are on the head's face api, not props: apply them when the head lands and on each change
  const apply = (h: Head | null) => {
    if (!h) return;
    h.life.setPresence(online ? 'online' : { state: 'asleep', z: true });
    h.life.think(typing);
  };
  useEffect(() => apply(head.current));
  return (
    <>
      <div ref={anchor} data-minimoji="loading" style={{ position: 'relative', width: 96, height: 96 }} />
      <MinimojiStage>
        <MinimojiHead avatar={avatar} anchor={anchor} listening={music ? { tempo: 96, mouth: 'hum' } : null}
          onReady={h => { head.current = h; apply(h); }} />
      </MinimojiStage>
    </>
  );
}
```

- `listening` composes with any expression (a sad head nods sadly): a nod
  on `tempo`, notes rising; `notes: false` keeps the nod alone. A host
  with its own beat feeds `beat` through `performance`; `drop` (a counter)
  fires the bigger nod and a burst of notes.
- `setPresence`: `'online'`, `'asleep'` (eyes shut, slow breath; `z: true`
  lies it down with Zs), `'party'` (a bounce on the beat). Leaving asleep
  plays the wake-up.
- `think(true)`: the typing state, a thinking face with a looping tilt;
  any speech takes the mouth at once.
- `onReady` hands you the `Head` (and again after the avatar changes);
  `head.life` is the whole face api (`FaceApi` in `index.d.ts`).

## 7. Bodies

`@minimoji/react` draws heads only. The homepage's full-body tile is the
engine's own stage, with the site's own assets, and is not a public web API
yet. For bodies in an app use
the Swift Kit's `MinimojiBody`, or ask Minimoji.

## 8. Many heads on a page

- **One stage**, every head in it. Heads build one per animation frame, in
  mount order, and scale in as they land; scrolling holds builds back.
- Lower `detail` (`.8` on the homepage) before anything else.
- Under 48 px a head wears the compact arcs by itself; nothing to do.
- A group sharing a floor: `shadow={false}` on each head and one
  `<MinimojiShadow anchor={…} />` under them.
- Respect `prefers-reduced-motion`: pass `drift={false}`,
  `performances={false}` and `look={null}` (the homepage does). The
  package already drops natural motion and screen effects under it.
- A changed `emotes`, `performances`, `naturalTalk`, `drift` or `character`
  rebuilds the head:
  set them once, not per frame. A changed `avatar` whirls the new head in.
- One voice at a time: stop the other heads' audio when one starts.

## 9. Keys

Drawing a head needs no key. A key is for the service's HTTP API
(`Authorization: Bearer <key>`):

- A **publishable key** (`mk_pub_…`) may ship in the browser: it bakes
  heads, generates avatars from a selfie or a sentence, picks moods.
- A **secret key** (`mk_sec_…`) never reaches the browser: saving an avatar
  (`POST /avatars`) is your server's call with it.
- The service URL is the deployment's `.convex.site` origin, never
  `.convex.cloud`.

### Getting a key with `npx minimoji`

In the app's folder:

```sh
npx minimoji login               # prints a code and a link; the person approves it in the browser
npx minimoji init --with-skill   # mints a publishable key, writes .env.local, installs this skill
```

`init` writes `NEXT_PUBLIC_MINIMOJI_KEY` and `NEXT_PUBLIC_MINIMOJI_SERVICE_URL`
(`VITE_…` in a Vite app) to `.env.local` and never writes a secret key. A
secret key for your server: `npx minimoji keys create --kind secret`.
Without the CLI, mint keys at minimoji.com/developers/keys.

Signed in, `npx minimoji generate "red curls" --name kai` keeps the avatar in
the account's library: `npx minimoji avatars` lists it on any machine, and
`npx minimoji avatars get kai` prints its `avatarKey` for the app to show.
`npx minimoji edit kai "make the hair blue"` (or `--photo me.jpg`) changes
it: the name follows the edit to a new `avatarKey` (the first line it
prints; `--json` gives `avatarKey` and `previousKey`), and `--as kai-blue`
keeps the edit as a new entry instead.
An app showing a hard-coded key keeps the old look until you update the key.

`npx minimoji voice kai 21m00Tcm4TlvDq8ikWAM` gives a library avatar an
ElevenLabs voice (`--effect robot` for D.A.S.H.; `--list` shows your voices),
and `npx minimoji say kai "[excited] Hi, I'm Billie"` makes the line, one
ElevenLabs call on the developer's own key (`ELEVENLABS_API_KEY`, which is
never sent to Minimoji): `minimoji-lines/hi-i-m-billie.json` plus a `.wav`.
That JSON is a prebuilt line, played with `line.say(line, { audio: '/lines/hi-i-m-billie.wav' })`. Never hand-roll TTS timestamps
into a line: `say` already ran `buildLine` on them.

### Use my Minimoji: a person's own avatar

A person with a Minimoji account (minimoji.com/me) can bring their avatar
to your app. You never ask for their email: they pick one on minimoji.com
and your app gets that pick. The host's three lines:

```jsx
import { MinimojiConnectButton, refreshMinimojiGrant } from '@minimoji/react';

// 1. show the button; the popup opens on the click
<MinimojiConnectButton minimojiKey={process.env.NEXT_PUBLIC_MINIMOJI_KEY} service={process.env.NEXT_PUBLIC_MINIMOJI_SERVICE_URL}
  onConnected={({ grantId, avatarKey }) => saveForUser({ grantId, avatarKey })} />   // 2. store both against your user
// 3. on launch, follow their edits and re-picks; null means they disconnected your app
const now = await refreshMinimojiGrant({ service, key, grantId });   // { grantId, avatarKey, status } | null
```

- One live grant per app and person: connecting again (another device, or the person reconnecting) replaces the grant, and the old id answers 410. On a 410, re-read the grant you stored before clearing it; another device may have saved a new one.
- Refresh on the device at launch, not from your server for every user: the grant routes are limited per key and caller address.
- The key is your app's publishable key; its label (set at
  minimoji.com/developers/keys) is the app name the person sees, so name it
  after the app.
- `useMinimojiConnect({ key, service })` gives `{ connect, connecting, error }`
  for your own button. `connect()` resolves null on "Not now", on expiry, or
  when the popup is closed without an answer.
- Show the head with `<MinimojiHeadPoster src={`${service}/avatars/${avatarKey}.png?size=256`} />`
  and fetch `${service}/avatars/${avatarKey}.json` to draw it live.
- An avatar made in your own editor, which your server saves with
  `POST /avatars`: `addToMinimojiLibrary({ service, key, grantId, avatarKey })`
  puts it in their library and picks it for your app (a 403 if they said no
  to that on the sheet).

### Their status: the line beside their head

What the person types or says on the Minimoji app's you screen (or sets with
`npx minimoji status kai "back at 3"`) is their avatar's status, and it comes
with the grant: `refreshMinimojiGrant` answers `status: { text, mood, gesture,
setAt }`, or `status: null` when there is none. The mood was read once, on
Minimoji's side, so every app shows the same face: never send `text` to
`/expressions/pick` again.

```jsx
import { MinimojiStatusBubble, refreshMinimojiGrant } from '@minimoji/react';

// on focus, and every 30 s while the head is on screen (a status changes without a re-pick)
const grant = await refreshMinimojiGrant({ service, key, grantId });
const status = grant?.status;   // { text: 'on a deadline', mood: 'thinking', gesture: 'ponder-tilt', setAt } | null

<div style={{ position: 'relative' }}>
  <div ref={anchor} data-minimoji="loading" style={{ width: 120, height: 120 }} />
  {/* the tail's tip is the bubble's bottom-left: put it just above and right of the head */}
  <MinimojiStatusBubble text={status?.text} size={14} style={{ position: 'absolute', left: '60%', bottom: '85%' }} />
</div>
<MinimojiHead avatar={avatar} anchor={anchor} expression={status?.mood ?? 'neutral'}
  cue={status?.gesture ? { gesture: status.gesture, generation: status.setAt } : null} />
```

- `<MinimojiStatusBubble text size tail>` is Bunch's bubble (cream, Lilita
  One, two lines at most, a 3° tilt); `size` is the text's px (Bunch draws
  11, 14 and 22), `tail={false}` drops the tail. No text draws nothing. Load
  Lilita One yourself (Google Fonts) or it falls back to a rounded system font.
- `mood` is a face name for `expression` (null when the read was unsure:
  keep the face). `gesture` is a track for `cue` (null: none); with
  `generation: status.setAt` it plays once per new status, not on every poll.
- `setAt` is epoch ms: say "2h ago" if you like.
- No React? The heads bundle (`/sdk/minimoji-heads.js`) has
  `mountStatusBubble(element, { text, size, tail })` → `{ update, destroy }`.


A status may carry an optional `voice` (`url`, `durationMs`, `words`, and optional
`letters: {characters, starts, ends}`). Download the clip and play it with the
line player using these timings, without transcription. In Swift use
`try voice.line(audioFile: downloadedURL)`, then `MinimojiLinePlayer.say`;
on the web use `lettersFromAlignment` when building the line. Partner apps
choose their own play control. These clips are public URL media.

## 10. Never do

- Never hand-draw or keyframe talking, blinking or emoting: feed speech
  (section 4), set `expression`, send a `cue`.
- Never put a `<div>` (or any DOM) inside `<MinimojiStage>`; anchors live
  outside it.
- Never mount a second stage for more heads, or one stage per head.
- Never draw your own loading placeholder: `MinimojiHeadPoster`.
- Never pass a new `performance` function every render, and never drive
  the mouth from wall-clock time: read the audio's clock.
- Never send audio to the service; only text goes to `/expressions/pick`.
- Never ship a secret key, or the `.convex.cloud` URL, to the browser.
- Never store an avatar document as the user's identity: store the
  **avatar key** from `POST /avatars`.
- Never reach for the engine itself: it ships bundled and minified inside
  this package, and only `@minimoji/react` and its `/characters`, `/line`
  and `/clip` subpaths are public.

## 11. Swift twin

The same heads, moods, cues, speech and loader exist in Swift: the
`minimoji-swift` skill (`MinimojiKit`). `cue={{ gesture: 'double-take' }}`
is `HeadCue(.gesture(.doubleTake))`; `mouthTrack` is the recorded twin of
`LiveVisemes` + `SpeechVoice`.
