---
name: minimoji-presenter
description: Build an onboarding or product intro that a Mini avatar presents — one voiced line per slide, one speech-bubble caption at a time with the word being said lit, content revealed on its word, the next slide when the line ends, and steps that wait for the person (pick a topic, a permission, a sign-in) with a choice that picks the next slide. Use when asked for a narrated deck, a presenter, a talking onboarding, a splash or intro where a character walks someone through a product, on the web (plain HTML or React) or in a SwiftUI app.
---

# minimoji-presenter

## 1. What it is and when to use it

A **presenter deck**: a Mini avatar (D.A.S.H., a person, any species) walks someone through an onboarding or a
product intro, a few slides long, one voiced line per slide. The show moves on by itself, and a slide may
**wait for the person**: a choice ("pick a topic"), a permission, a sign-in, a form, in your own UI. A choice may
pick the next slide. It ends on calls to action. Uses: landing pages, splash and intro screens, first-run
onboarding in an app.

savethis built this pattern by hand over about 80 iterations (D.A.S.H. presents savethis.ai), then redesigned
its landing and iOS tour around it (Nov 2026, §9a). Every number and rule below is one of its lessons: **where this
skill gives a number, a rule or an order, keep it.**

**Two shapes.** A deck that *is* the page (a first-run intro, a dedicated tour: §8, §9), or a deck **inside a
landing page**, which explains the product without playing and offers the show as a video (§9a). On a landing page,
use §9a: a visitor who doesn't press play must still learn what the product does.

- Not a conversation. For a head that answers a person turn by turn, or a host that talks over a whole app
  without slides, read the "A host that talks" section of `minimoji-web` (web) or `minimoji-swift` (iOS).
- Head basics (keys, avatars, characters, the bundle, `MinimojiHead`) are in those two skills too. Install all
  three with `npx minimoji skills add` (bare `npx minimoji skills` lists them).

What is decided, so you don't re-decide it:
- **A copyable starter, not an API.** `starter/presenter.js` is a plain ES module of about 350 lines that you copy
  and own. A `createPresenter(el, slides)` joins the heads bundle only once a second product ships a deck on this
  starter, so two decks shape the API, not one.
- **The CLI makes and paces the lines**: `minimoji say --texts slides.json` voices and re-times the whole deck,
  one call at a time under the rate limit, and re-voices only what changed. `scripts/make-lines.sh` wraps it.
- **The bubble captions are the SDK's**: `capsFromLine`, `captionAt` and `wordTime` from the vanilla bundle
  (`/sdk/minimoji-heads.js`) and `@minimoji/react`. Don't copy them into your app.

## 2. Quick start

```sh
cp -R .claude/skills/minimoji-presenter/starter my-deck && cd my-deck
# optional, for offline use and a pinned version (the starter loads minimoji.com's first, then this copy):
mkdir -p vendor && curl -o vendor/minimoji-heads.js https://www.minimoji.com/sdk/minimoji-heads.js
python3 -m http.server 8000      # ES modules and audio do not load from file://
open http://localhost:8000/presenter.html
```

Press **Play**: the example deck (savethis, six real voiced lines) runs, waits for a choice on slide 2, branches,
waits on a permission step, and ends. Then make it yours:

1. Write your `slides.json` (§3) and one `<article data-pd-slide="<id>">` per slide in `presenter.html`.
2. Voice it from your project's root: `bash .claude/skills/minimoji-presenter/scripts/make-lines.sh my-deck` (your
   `ELEVENLABS_API_KEY` and voice), or `… make-lines.sh my-deck --server` to try Minimoji's voice first (§4).
3. Serve, press Play, watch it end to end. Then a person listens to it with sound on (§12).

The bundle answers `access-control-allow-origin: *`, so a page on any origin may import it straight from
`https://www.minimoji.com/sdk/minimoji-heads.js`; the starter does, and falls back to `./vendor/minimoji-heads.js`.
The skill does not ship the bundle (about 1.1 MB).

- **The deck needs a bundle with `capsFromLine`** (minimoji.com's, from the release that added this skill). With an
  older one, the starter warns `… is an older bundle (no capsFromLine)` and shows the still image; voice, captions
  and slides carry on. Re-fetch `vendor/minimoji-heads.js` if yours predates it.
- **The example's lines are savethis's.** A deck that reuses them plays savethis's words and audio, and the drift
  check warns once per slide: re-voice (§4) before anyone hears it.

## 3. The deck model (`slides.json`)

```json
{
  "character": { "id": "agent" },
  "voice": { "provider": "elevenlabs", "voiceId": "cseBT3RQoApCirnEwyFt", "model": "eleven_v4" },
  "holdMs": 250,
  "gate": { "title": "Play", "sub": "Dash shows you around · 40 s · sound on" },
  "slides": [
    {
      "id": "hello",
      "say": "Hi, I'm Dash. savethis works with your favorite AI assistants to keep everything you love in one place. Let me show you.",
      "pos": "center", "gesture": "sunny-nod", "mood": "happy", "wash": "#FFFFFF",
      "reveals": [{ "word": "favorite", "selector": ".ex-assistant" }],
      "beats": [{ "at": 1700, "look": ".ex-assistants" }, { "at": 3600, "look": "viewer" }]
    },
    {
      "id": "save",
      "say": "Save anything you love, here or through your AI assistant. A title, a link, a TikTok.",
      "pos": "left",
      "wait": { "for": "topic", "prompt": "What should I show you next?", "nudge": "Pick one of the two, and I'll show you that.", "nudgeAfterMs": 8000 },
      "next": { "filing": "file", "sharing": "open" }
    }
  ],
  "ending": { "pos": "left", "mood": "joy", "lookAt": ".pd-ending-ctas", "glanceEveryMs": 2800 }
}
```

Rules:
- **One line per slide.** At most about **25 words**, or about **7 seconds** at speaking pace. Six slides of about
  6 s is roughly **40 s**, the length people accepted.
- **`say` is the source of truth.** The CLI voices it; `lines/manifest.json` records a sha256 of each `say` it
  voiced (`textSha256`), and `presenter.js` hashes each `say` in the browser (`crypto.subtle`) and **warns in the
  console** for every slide whose line came from another text. The hash lives in the manifest, not in the line
  JSON: the line format stays the one every player reads.
- **`pos`**: `center`, `left` or `right`. The character moves between slides on a **0.7 s** ease. On the first slide
  it does not slide in from nowhere: it starts in place.
- **`reveals`**: content that appears **when its word is said**, timed from the line's word timings, never a fixed
  delay. Several elements under one selector cascade **0.25 s** apart.
- **`beats`**: ms from the slide's start, each with one of `look` (a selector inside the slide, or `"viewer"`),
  `mood`, `gesture` (a Kit track name) or `react`. Every beat lands before the line ends.
- **`wait`** and **`next`**: §7a. **`dark: true`**: the slide is dark (the bubble turns charcoal).
- **`id`**: names the slide for `next`, for events, and for its `<article data-pd-slide="<id>">`. Line files are
  named by position: `lines/slide<N>.wav` + `.json` (and `slide<N>-nudge` for a nudge).

## 4. Making the lines

```sh
# voice every slide of my-deck/slides.json on the deck's voice, then re-time each clip on its own audio
S=.claude/skills/minimoji-presenter/scripts
ELEVENLABS_API_KEY=… bash $S/make-lines.sh my-deck    # = cd my-deck && npx minimoji say --texts slides.json --out lines
bash $S/make-lines.sh my-deck --server                # Minimoji's voice, your Minimoji key: for trying it out
bash $S/make-lines.sh my-deck --dry-run               # what would be sent; nothing is
cd my-deck && npx minimoji lines lines/ --texts slides.json   # re-time only (the deck shape maps slide<N> → its say)
```

What the batch does, one slide at a time and in order:
1. **Speak** the slide's `say` on the deck's `voice` (`--voice` overrides it; with neither, the avatar's library
   voice) with the slide's `mood`: `slide<N>.wav` + `.json`. A waiting slide's `nudge` becomes `slide<N>-nudge`.
2. **Re-time** it on the final audio with `POST /lines` (forced alignment), the same call `minimoji lines --text`
   makes. **Always** (`--no-retime` exists for debugging only). The TTS request's timing is a guess; alignment on
   the final WAV is what lands the lit word on the right syllable.
3. **Pace**: one `/lines` call every **3 s** (the bucket: bursts of 5, then 20 a minute, per key and caller
   address), `--server` speech one every **6 s** (10 a minute). A **429 of 60 s or less waits and retries** that
   clip, at most 3 times; a longer one (the day's quota) stops the run and says what was written.
4. **Cache**: `lines/manifest.json` keeps `{ textSha256, voice, model, mood, effect, settings, server }` per line.
   An unchanged slide is skipped, so **rewording one line re-voices only that line**, and a re-run with nothing
   changed sends nothing. A `--server` trial is re-voiced by the first run on your own key. Lines are named by
   position (`slide<N>`): inserting or moving a slide re-voices every slide after it, so add new slides at the end
   while you iterate, and reorder once.

Needs `minimoji` 0.9.0 or later (`make-lines.sh` asks npx for it).

Rules:
- **`--server` takes catalogue voice names only** (`dash`, `person`, `alien`, …; `GET /lines/voices`). Any other
  ElevenLabs voice id needs your own key. Use `--server` to try things out, your own key and voice for production.
- **Never print the key.** `make-lines.sh` reads `ELEVENLABS_API_KEY` from the environment or `.env.local` and pipes
  every line of output, errors too, through a redactor for `sk_…`/`xi-…` patterns and the key itself.
- **Keep WAV unless size matters.** MP3 adds encoder padding that shifts lip timing; if you convert, re-time the MP3.
- **No audio post-processing** (robot filters, speed changes) after re-timing: that is the drift.

## 5. Playing a line

The starter does all of this; read it when you change `presenter.js`.

```js
const sdk = await import('https://www.minimoji.com/sdk/minimoji-heads.js');   // else ./vendor/minimoji-heads.js
const stage = sdk.mountHeadPerformance(el, {
  avatar: {}, character: { id: 'agent' }, crt: 1,
  bursts: false,                       // the burst stickers read as a ring around the head in a deck (§11)
  reduceMotion,
  onHeadTop: px => deck.style.setProperty('--headTop', px + 'px'),   // the bubble hangs from the real head top
});
const player = sdk.createLinePlayer({ onCue: (cue, quiet) => sdk.applySpeechCue(stage, cue, undefined, quiet), onEnd });
gen = player.say(line, { audio: audioEl, follow: true });   // the <audio> element is the clock
audioEl.play();
// one rAF loop for the whole page:
const r = player.tick(); if (r) stage.frame(dt, r.sample); else stage.idleFrame(dt);
```

Rules:
- **Follow the audio** (`follow: true`): pausing the `<audio>` pauses the lips and the captions with it.
- **Preload every clip into memory before the show** (`fetch` → `Blob` → `URL.createObjectURL`), and start each
  slide only once its clip is ready. A "random pause before a slide" is the next clip still downloading. Wait at
  most **8 s** for a clip, then play the slide silently on a frame clock, so the show never stalls.
- **Advance on the line's end** (`onEnd` with reason `ended`, plus the audio `ended` event as a safety net), then
  hold **`holdMs` (250)**. **Never** on a fixed timer: a character that finishes speaking and then waits for the
  next slide looks broken.
- **Sound off** plays the same line on the player's silent clock, not a different code path.
- **If the head throws once in the frame loop, dispose it and show the still image.** Voice, captions and slides
  carry on.

## 6. Captions

```js
const caps = sdk.capsFromLine(line, slide.say);        // the line's phrases, sized for a bubble
const { index, lit } = sdk.captionAt(caps, t);         // the phrase at t (s) and its lit word (-1 between words)
const at = sdk.wordTime(line, 'favorite', 1);          // when a word is said: a reveal's time
```

- **One caption at a time, in a speech bubble** beside or above the head. Never the whole sentence, never a
  subtitle bar.
- **At most two lines.** `capsFromLine` takes the line's own phrase captions and splits any longer than about **64
  characters** at punctuation, using the word timings, and never leaves a lone word ("it.") as its own caption.
  These are not `captionWindow`'s 4-word phrases (`<MinimojiCaptions>`), which suit a caption strip.
- **The word being said gets a filled pill** behind it, not just a colour change.
- **The bubble swaps text in place within a slide.** It moves or animates only on a slide change.
- **On a slide change, show the new slide's first phrase at once.** Never leave the old slide's last line up. The
  last phrase stays until the slide's hold ends (`captionAt` holds it).
- **Reduced motion**: crossfade the captions; don't stream them.
- **The caption card tucks behind the head**, so the head overlaps its edge: above the head on the web
  (`bottom: calc(100% - var(--headTop) - 30px)`, centred on it), below the chin on iOS when the headline sits
  above the head. Width **280–320 px** (phones **240–290 px**); text weight **700**, **17–19 px**.
- **Glassy and quiet, not solid.** A solid black card was the heaviest thing on screen and a white one stood out
  too: use a translucent card with a white hairline (iOS: `.ultraThinMaterial`). Inside a dark CRT frame (§9a), a
  dark plum card with a faint pink glow on the text. Never a card that matches a white button.
- **When the line ends, fade the card out** (in a §9a frame) rather than filling it with the whole line.

## 7. Directing the character

- **Looks**: `stage.look(sdk.lookTargetFor(targetEl, mountEl), holdSeconds)` toward what the line talks about, then
  `"viewer"` (`stage.look(null, sdk.LOOK_HOLD)`). This, more than anything, makes it feel like it is presenting.
- **Gestures** that read in a deck: `sunny-nod`, `knowing-nod`, `lightbulb`, `double-take`, `ponder-tilt`, `bow`
  (the closing slide). Reactions: `ah`, `giggle`.
- **Moods**: `happy` while presenting, `thinking` for a beat before a reveal, `joy` at the end. (savethis's notes say
  "delighted": the SDK has no such face, and `joy` is the one that reads that way.)
- **Reveals on words** (§3): the things the character names appear as it names them.
- **Content arrives in whole chunks**, one card at a time. Don't animate a card's inside piece by piece.

### 7a. Steps that wait for the person, and branching

The host owns the UI and the data; the deck only plays, waits and moves on.

- **A waiting slide** (`"wait": { "for": "topic", "prompt": "…", "nudge": "…", "nudgeAfterMs": 8000 }`) plays its
  line, then **holds**: no auto-advance; the head idles, looks at the person and listens; the bubble shows
  `prompt` (silent text); the page's `.pd-wait` UI for that slide appears (the root gets `is-waiting`). The slide's
  spoken `say` asks the question ("Which do you want to see first?"); `prompt` is its short silent reminder while
  the person decides ("Pick one"). Two to four choices, as real buttons, under the slide's content. If nothing
  happens for `nudgeAfterMs` (**8000** by default), the `nudge` plays **once**: its clip `slide<N>-nudge` when there
  is one, else its text silently in the bubble.
- **The host answers** with `deck.done('<for>', value)`: a choice's value, a permission's result, the signed-in
  user's id. `done` for anything else is refused with a console warning.
- **Branching, minimal**: `"next": { "<value>": "<slide id>" }` picks the next slide by the value; `"next": "<id>"`
  always goes there (two branches meeting again); `"end"` ends. A value the map lacks goes on in order. No state
  machine beyond that.
- **The engine never renders form controls or stores answers.** It emits events; you keep the choice:

```js
const deck = await startPresenter(root, { slides: 'slides.json', lines: 'lines/', resume: true });
deck.on('step',    ({ index, id }) => analytics('intro_step', id));
deck.on('waiting', ({ id, for: what, prompt }) => showMyStepUI(id));        // focus its first control
deck.on('done',    ({ for: what, value }) => saveAnswer(what, value));
deck.on('ended',   ({ skipped }) => markIntroSeen());
pickTopic.onclick = () => deck.done('topic', 'filing');
allow.onclick = async () => deck.done('notify', await askMyBackendOrTheBrowser());
skip.onclick = () => deck.skip();
```

- **Kinds of step**, one each in the starter: a **choice** (two buttons that branch), a **permission** (a button the
  host wires to its own ask), and a **skip** (`deck.skip()` jumps to the ending).
- **Resume**: with `resume: true` the deck remembers the current slide in `sessionStorage` and Play starts there.
- A waiting step works with **keyboard and touch**: its controls are real buttons, the deck focuses the first
  one when it waits, and a click on them never pauses the deck.

## 8. Starting, pausing, moving, ending

- **The gate.** Browsers block autoplay, so nothing plays before a click. Slide 0 shows a **Play** pill with a line
  under it stating the length and "sound on", between the headline and the character. Pressing it turns sound on
  and starts slide 0. **Only a trusted click starts the show** (`event.isTrusted`).
- **Before Play, slide 0 is a complete still page**: headline and character, nothing waiting to appear. Reveals
  tied to words stay hidden until the line plays them.
- **Pause**: a click anywhere on the deck (except your own controls), a **tap on the presenter**, or **space**.
  The same tap continues from where it stopped (the web player follows the `<audio>`, so pausing it pauses the line;
  for Swift see `swift/README.md`). The paused control moves to a top corner so it never covers the headline.
- **Focus follows the keyboard only.** Move focus to the presenter after a keyboard activation (`event.detail ===
  0`), never after a mouse click: a click left a focus ring around the head for the whole show.
- **Navigation**: arrows sit **outside** the card on wide screens and are hidden on phones; pagination dots are
  always visible; **←/→** work; any navigation restarts that slide's line. Forward (→, the arrow, a dot) goes
  where the deck would (`next`, then the ending, never back round to slide 0) and **never past a step waiting for
  the person**: only `deck.done()` or `deck.skip()` moves a waiting step on, so a sign-in can't be skipped by an
  arrow. Back (←) always works.
- **The ending**, after the last line ends (or `deck.skip()`): the speech bubble goes; the character moves to the
  side, vertically centred beside the content; it turns `joy` and keeps glancing at the calls to action (a
  nod or tilt every **~2.8 s**); the calls to action grow large beside it, with a small **Replay**; no auto-loop.
  The ending has its own wash (`ending.wash`, white by default), never the dark closing slide's.
- **Calls to action live in the page's top bar** for the whole show, never in a strip under the deck, and once more,
  large, in the ending.

## 9. Layout: desktop and phones

- **The deck fills the window**: a top bar, the deck card growing to fill the space (**min 470 px, max 820 px**),
  then a one-line centred footer at the bottom. No sections under the deck; FAQs go on their own page.
- **Each slide has a soft background wash**; the closing slide goes dark.
- **Texture**: outside the card, three slow blurred brand-colour glows and very faint grain; inside, two corner
  glows tinted per slide and grain at about **3.5%**. The card must still read as white (9% multiply grain turned
  it grey).
- **Content and character don't compete**: on desktop the character has its own column of about **380 px** on the
  side it stands, and the slide's content is padded away from it.
- **Phones (≤520 px): real type sizes, not a scaled-down desktop slide.** Headline about **36 px**, slide titles
  about **30 px**; content from the top of the card; the character small (about a **190 px** box), bottom-centre,
  its bubble above; arrows, the sound control and the counter hidden, dots and tap-to-pause kept; wide rows become
  horizontal scroll-snap rows; the ending centred and stacked.
- **Gotcha**: a flex column with `flex-wrap: wrap` and a `max-height` wraps back into a row (a phone footer did).
- **Gotcha**: don't name a class `.app` or `.pop` inside a bigger page; the starter prefixes its own with `pd-`.

### 9a. On a landing page: explain first, play inside a frame

savethis's redesign (savethis PRs #178, #182, #184 web, #187 iOS) after a visitor said "I didn't realize I had to
click" and wanted "what it does" on the first screen.

- **Explain first, play second.** The first screen says what the product does without playing anything: a headline
  and **one** line. No step cards, no flow diagrams ("so much text"). The show is optional depth.
- **Frame the show as a video.** A small Play pill reads as decoration. A screen with a **big centred play button**
  and a **duration badge** (`0:40`) reads as "press me". For D.A.S.H., a CRT on standby: scanlines, vignette, a slow
  rolling band, an occasional flicker, a blinking READY. The button sits dead centre.
- **The presenter invites the click.** It starts centred, scoots aside to make room for the play button, looks at
  it, and its bubble says "Watch the tour with me!".
- **The show plays inside the frame**, never by replacing the page. Play powers the screen on (it collapses to a
  line, then opens out) and grows it to fill the card; slides render inside, with a quick channel-change flash
  between them. At the end it shrinks back to standby and the presenter asks "Watch it again?".
- **A fixed slide shape**: **16:10**, capped at the window height. Never stretch it to fill a tall viewport.
- **Effects at the edges, content clean.** A full-screen tint made the slides' UI hard to read: keep content near
  true colour, put the tint and vignette at the rim, and scanlines at about **18%** opacity.
- **Phones: a big presenter.** About **2×** the §9 size while it talks (savethis's 190 px box was too small); on iOS
  it grows **×1.35** into the caption's space once it has finished.
- **The doors stay visible** beside the frame (App Store, Connect, your calls to action): large, equal width. The
  presenter glances at one when it is hovered.
- Reference: savethis `web/app/_components/landing/DashDeck.tsx`, `web/app/dash-deck.css`,
  `ios/SaveThis/Views/Onboarding/DashHost.swift`.

### React (`react/PresenterDeck.tsx`)

The same engine as a client component on `@minimoji/react`: `<MinimojiStage>` + `<MinimojiHead>` for the head,
`useLine` for the line, `capsFromLine`/`captionAt` for the bubble, and the same `slides.json` and lines. Copy it
into your app (Next.js: it is `'use client'`), import `presenter.css` or port its rules, and render your slides as
children keyed by id. It keeps the same events (`onStep`, `onWaiting`, `onDone`, `onEnded`) and a ref with
`done(for, value)` and `skip()`.

## 10. Swift

`swift/README.md` is the SwiftUI recipe: the same `slides.json` and lines, `MinimojiLinePlayer` for each line, a
pager, the one-phrase bubble with the lit word, waiting steps that show the app's own view under the head and call
`presenter.done(...)`, and the same ending. No autoplay gate in an app (audio session rules instead), and the Kit's
`crt` default matters for D.A.S.H.

## 11. Never do

- Never advance on a fixed timer while the character is talking.
- Never show the whole sentence as a caption, or more than two lines.
- Never let the audio element and the lips run on different clocks.
- Never start a slide before its clip is in memory (or its 8 s are up).
- Never show content before the word that introduces it.
- Never turn the burst stickers on in a deck: pass `bursts: false`.
- Never draw the character by hand or as an SVG stand-in: use the SDK head, with a still image while it loads.
- Never print or log a voice or API key.
- Never put the calls to action in a strip under the deck.
- Never tint the whole slide: effects stay at the rim, content stays near true colour.
- Never move focus to the presenter after a mouse click.
- Never render form controls or keep answers inside the deck engine: a waiting step's UI and data are the host's.

## 12. Checklist before you ship

- [ ] Every slide's text is in the server-rendered HTML (search engines and no-JS visitors).
- [ ] The still image shows if the SDK fails, and voice and captions continue.
- [ ] With sound on, in Safari and Chrome, a person has listened to the whole show (agents cannot hear).
- [ ] On a real phone: type sizes, tap to pause, the scroll rows, every waiting step by touch.
- [ ] Every waiting step works by keyboard alone (Tab to its controls, Enter or space to answer).
- [ ] Reduced motion: no drift, no auto-advance unless the visitor navigated, captions crossfade.
- [ ] Every line matches its `say` (no drift warning in the console; `make-lines.sh` re-run sends nothing).
