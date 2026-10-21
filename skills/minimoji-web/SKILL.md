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
  (`characters`), and `CHARACTERS` in `@minimoji/engine/characters`.
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
head's own still: it comes in soft and breathes, then gives way with a puff
when the head is ready, stays sharp on an error, and is a plain swap under
reduced motion. The same loader as the homepage and the Swift Kit.

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

A recorded line is its audio plus a **line** (`*.timeline.json`, the public
format in `docs/speech-line-format.md`: mouth frames at 60 fps, captions,
optional timed words, mood and gesture cues). `useLine()` plays it on a head,
mouth on the recording's own clock, cues on the face, words in
`<MinimojiCaptions>`. This is what the homepage's hellos run on.

```tsx
'use client';
import { useEffect, useRef, useState } from 'react';
import { MinimojiStage, MinimojiHead, MinimojiCaptions, useLine, type SpeechLine } from '@minimoji/react';

export function DashSaysHey() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [hey, setHey] = useState<SpeechLine | null>(null);
  const line = useLine();
  // load the line ahead of the click: the click's play() must run inside the gesture
  useEffect(() => { fetch('/lines/dash-hey.timeline.json').then(r => r.json()).then(setHey).catch(() => {}); }, []);
  return (
    <>
      <button ref={anchor} type="button" aria-label="Say hi to D.A.S.H." data-minimoji="loading"
        onClick={() => hey && line.say(hey, { audio: '/lines/dash-hey.mp3' })}
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
- **`audio`**: a URL (the hook makes and frees the element), your own
  `HTMLAudioElement` (paused, never freed), or none (the silent clock).
- **Captions**: phrases by default — at most four words, broken after
  punctuation, the word being said lit (`data-lit`) and staying lit through
  the pause after it; the first phrase shows before the voice starts and the
  last stays a second after it ends; a new phrase moves up. `mode="window"`
  is the Kit 9.44 sliding window (about 7 words / 40 characters). Reduced
  motion shows the whole line, still; `maxLines={1}` keeps it to a subtitle
  slot (then an ellipsis). A screen reader hears the whole line once per
  line (the moving words are hidden from it). Style the box with
  `className` / `style`; it must survive 200% text.
- **Making a line** from your own audio and timed words (a TTS provider's
  timestamps, dictation): `buildLine({ pcm, sampleRate, words, mood })` from
  `@minimoji/engine/line`, offline; `packages/engine/dev/line-from-words.mjs`
  converts ElevenLabs-style `{ text, startMs, durationMs }` words plus the
  clips. Never derive mouth shapes from letters. `mood` sets the opening
  face quietly (no emote burst at the start); audio tags in the words
  (`[excited]`, `[curious]`, `[whispers]`…) leave the captions and become
  quiet face changes at their word (`TAG_MOODS`), `[laughs]` a laugh.

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
  `createLiveVisemeTimeline` and `createSpeechVoice` (in `@minimoji/engine`,
  not re-exported here yet) are the web twins of the Swift Kit's
  `LiveVisemes` and `SpeechVoice`: PCM in, a viseme and a level out, eased
  into a mouth per head.

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
- `cue={{ gesture }}` plays one named track over the face as it is (the
  face never changes): `double-take`, `head-shake`, `sunny-nod`,
  `knowing-nod`, `ponder-tilt`, `side-eye-hmm`, `lightbulb`, … (the
  engine's authored tracks). `cue={{ mood }}` picks one of that mood's
  three. One shot only: chain the next from `onGestureEnd`, which always
  comes (cancelled when replaced, the next frame under
  `performances={false}`).
- `performances={false}` stills every one-shot, cues included (reduced
  motion). To cue your own gestures over a beat, pass `emotes={false}`,
  not `performances={false}`.
- A mood from text: `POST <service>/expressions/pick` with
  `{ text, gesture: true }` answers `expression` (null: keep the face) and
  a `gesture`. Ask on a typing pause, never per keystroke.

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
engine's own stage (`mountStage` from `@minimoji/engine/stage`, with the
site's own assets) and is not a public web API yet. For bodies in an app use
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
- Never import `@minimoji/engine` internals for what this package already
  does; the engine's own modules are not a stable API.

## 11. Swift twin

The same heads, moods, cues, speech and loader exist in Swift: the
`minimoji-swift` skill (`MinimojiKit`). `cue={{ gesture: 'double-take' }}`
is `HeadCue(.gesture(.doubleTake))`; `mouthTrack` is the recorded twin of
`LiveVisemes` + `SpeechVoice`.
