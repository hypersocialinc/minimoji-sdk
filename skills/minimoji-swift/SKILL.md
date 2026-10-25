---
name: minimoji-swift
description: Add Minimoji 3D avatar heads to an iOS app with MinimojiKit — use when asked to "add Minimoji", integrate MinimojiKit, show an avatar head, open the avatar editor (selfie, AI edit), lip-sync a head to a voice, cue a gesture, or read a mood from text.
---

# MinimojiKit: integrating Minimoji heads in a Swift app

MinimojiKit is a Swift package that shows **baked Minimoji heads** as
SwiftUI views (Metal or RealityKit), ships the **avatar editor** as one view,
talks to the **avatar service** (`AvatarService`), and can build heads **on
the device** (`MinimojiEngine`). This file is the rules and the smallest
snippets; every Swift snippet is copied from the package
[README](https://www.minimoji.com/developers/kit/README.md)
or the Minimoji demo app, so it compiles against the version you pin. The
[release notes](https://www.minimoji.com/developers/kit/RELEASE_NOTES.md)
say what each version changed and what a host must do. Both links are on a
private repository: read the copies inside the checked-out package
(`README.md`, `RELEASE_NOTES.md` next to this file) when you cannot open
them.

## 1. Pin the package and pick products

Add `https://github.com/hypersocialinc/MinimojiKit` (private: the machine
needs GitHub access to it). Tags are `v<bakeVersion>.<minor>.<patch>`; the
major is the bake version, so never take a new major without reading its
release note. Link only the products you use:

```yaml
# xcodegen project.yml
packages:
  MinimojiKit:
    url: https://github.com/hypersocialinc/MinimojiKit
    from: "9.41.0"
targets:
  YourApp:
    dependencies:
      - package: MinimojiKit
        product: MinimojiKit        # HeadDocument, FaceLife, the RealityKit views
      - package: MinimojiKit
        product: MinimojiMetal      # MinimojiMetalHeadView — a head as an ordinary view
      - package: MinimojiKit
        product: MinimojiService    # AvatarService — the URL contract as one call
      - package: MinimojiKit
        product: MinimojiEditor     # the editor's model: catalogue, rules, thumbnails
      - package: MinimojiKit
        product: MinimojiEditorUI   # MinimojiEditorView — the editor as a view
      - package: MinimojiKit
        product: MinimojiEngine     # LocalBaker — the engine on the device, for the editor's previews
```

In Xcode without xcodegen: File → Add Package Dependencies, the same URL,
"Up to Next Major" from 9.41.0, and tick the same products. `MinimojiLive`
(live lip-sync, section 8) is a seventh product.

| you want | link |
|---|---|
| a head in a view | `MinimojiKit`, `MinimojiMetal`, `MinimojiService` |
| the editor | add `MinimojiEditor`, `MinimojiEditorUI` |
| previews built on the phone | add `MinimojiEngine` |
| lip-sync from a live call's audio | add `MinimojiLive` |

Older than 9.38 lacks `MinimojiHeadPoster(placementDocument:)` (and before
9.39 its still draws too big); older than 9.25 has no species.

**iOS 18 gate.** The package links from iOS 17 (set your deployment target
to 17.0 or later), but every view is
`@available(iOS 18, *)`: wrap each head and the editor in
`if #available(iOS 18, *) { … } else { … }` and show the 2D picture
(section 4) in the `else`. The model, the service and the caches run on 17.

## 2. The service and the keys

**Getting a key.** In the app's folder, run:

```sh
npx minimoji login   # prints a code and a link; the person approves it in the browser
npx minimoji init    # mints a publishable key, writes it to the app's Info.plist
```

`init` adds `MINIMOJI_PUBLISHABLE_KEY` and `MINIMOJI_SERVICE_URL` to the
app's `Info.plist` (or `Minimoji.plist` when Xcode generates the plist) and
never writes a secret key. Read them with
`Bundle.main.object(forInfoDictionaryKey:)`. Without the CLI, mint the key at
minimoji.com/developers/keys.

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
That JSON is a prebuilt line, played with `host.say(try SpeechLine(json: data), audio: wavURL)`. Never hand-roll TTS timestamps
into a line: `say` already ran `buildLine` on them.

- A **publishable key** (`mk_pub_…`, from minimoji.com/developers) lives in
  the app: it may bake heads, cut editor pieces, generate avatars and pick
  moods.
- A **secret key** never ships in the app. Saving an avatar (`POST
  /avatars`) is your backend's call, with the secret key.
- The base URL is the deployment's **`.convex.site`** origin (not
  `.convex.cloud`).

```swift
import MinimojiMetal
import MinimojiService

let service = AvatarService(base: URL(string: "https://<deployment>.convex.site")!, key: "mk_pub_…")
```

Make one service for the app and pass it everywhere.

## 3. Build on the device (`MinimojiEngine`)

Attach the engine once, from a long-lived place, and the editor's taps and
proposals build on the phone instead of waiting for the server. Fill in your
origin and key in `loggedAvatar`; hand the editor `editorService()`'s answer
and show a `ProgressView` until it comes (at most about 3 s):

```swift
import MinimojiEditorUI   // builder() is the editor's
import MinimojiEngine
import MinimojiService

enum Service {
  static let loggedAvatar: AvatarService? = AvatarService(base: URL(string: "https://<deployment>.convex.site")!, key: "mk_pub_…")
  private static let baker = LocalBaker()
  static let deviceAvatar: Result<AvatarService?, Error> = Result {
    guard var service = loggedAvatar else { return nil }
    service.localBuilder = try baker.builder()
    return service
  }

  /// the service to hand the editor: with the device builder when the service
  /// bakes the same version (or has not answered in 3 s), else the server path
  static func editorService() async -> AvatarService? {
    guard let remote = loggedAvatar else { return nil }
    let matches: Bool? = await withTaskGroup(of: Bool?.self) { group in
      group.addTask { (try? await remote.capabilities()).map { $0.bakeVersion == LocalBaker.bakeVersion } }
      group.addTask { try? await Task.sleep(for: .seconds(3)); return nil }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
    if matches == false { return remote }
    return (try? deviceAvatar.get()) ?? remote
  }
}

// in the view that shows the editor
@State private var editorService: AvatarService?
// …
.task { editorService = await Service.editorService() }
```

Rules:

- **Attach only on a matching bake version** (`capabilities().bakeVersion
  == LocalBaker.bakeVersion`); a mismatch means the device would preview
  heads the service bakes differently. **The 3 s rule**: if
  `capabilities()` has not answered within 3 s (or failed), attach anyway.
  `editorService()` runs both; keep it.
- `builder()` throws on a stale bundle; `editorService()` then answers the
  service without a builder (the server path).
- Keep one `LocalBaker` for the app's lifetime (its engine load is about
  half a second, done in the background on attach).
- Still on the server with a builder attached: saving, a friend's head by
  key, CDN URLs, the `.png` renders.
- **No server fallback yet**: a failed device build is shown by the editor
  with a retry, not retried on the server.

## 4. Show a head

Run the `await` in a `.task { }` and keep the result in
`@State private var head: HeadDocument?` (`HeadDocument` is in `import
MinimojiKit`); draw the view once it is non-nil:

```swift
// an avatar document (the same JSON the web edits) → a head, baked on first ask anywhere,
// cached on this device by content key from then on
let doc: [String: Any] = ["seed": 4821, "head": "round", "skin": "brown", "hair": ["style": "afro", "color": "ink"]]
let head = try await service.head(for: doc)                 // HeadDocument
MinimojiMetalHeadView(document: head, expression: "happy").frame(width: 96, height: 96)
```

- `MinimojiMetalHeadView` is a head as an ordinary transparent view (lists,
  chat bubbles). `MinimojiHeadView` (RealityKit, `MinimojiKit`) takes the
  same arguments and lives on one `MinimojiStageView` at the window's root.
- Every surface that cannot run a live head (notifications, widgets, the
  iOS 17 fallback) shows the 2D picture of a **saved** avatar:

```swift
AsyncImage(url: service.renderURL(for: saved.avatarKey, size: 256))
```

- Store an **avatar key** against a user, never a document. A friend's head
  comes by their key:

```swift
let theirs = try await service.head(forKey: theirKey)
MinimojiMetalHeadView(document: theirs).frame(width: 96, height: 96)
```

- A head's first `expression` is on in full from frame one (no blend, no
  emote); later changes blend and emote.
- Below 64 pt fetch `detail: .25, lite: true` and run `frameRate:
  .reduced` (34–63 pt) or `.low` (under 34 pt); see the README's size table.

### Showing a head while it loads

Do not draw your own placeholder: `MinimojiHeadPoster` (in `MinimojiMetal`)
is the head's own loader, the one the website shows — the still soft and
breathing, a cross-fade with a puff when the head is ready, the sharp still
on an error, a plain swap under Reduce Motion. No Metal view exists until the
head is ready, so a feed of them is cheap.

```swift
MinimojiHeadPoster(still: .url(service.renderURL(for: avatarKey, size: 256))) {
  try await service.head(forKey: avatarKey)      // your load, your caching
}
.frame(width: 120, height: 120)
```

- `fit: .render` (default) lands the service's picture where the live head
  draws under the same `framing:`; `fit: .contain` for a still of your own
  (`.url` of a bundled file or `.image(cgImage)`, any shape, never
  stretched), `.none` for no still. Until the head loads, `.render` places
  the still from a typical head's estimate; pass `placementDocument:` (the
  document from an earlier load) and it is exact from the start. Long
  hair under `.face` misses the estimate by up to a third: pass it for those.
- **A curated character** (D.A.S.H., an alien, an animal, the penguin, the
  ghost): pass `character: CharacterSelection(id: "agent")` and the still is
  exact on a cold load too (the Kit keeps every catalogue character's
  measures). A still of your own framed your own way: `placementHint:
  HeadPosterPlacement(side:dy:)` (fractions of the view's height) places it
  there throughout.
- `head:` takes your own `MinimojiMetalHeadView(document:…)` (mood, frame
  rate, colours); without it the head is decorative. Bump `reload:` to retry.
- An unsaved species has no service picture: bundle a still or pass `.none`.

### A species: D.A.S.H., an alien, an animal

```swift
let dash = try await service.head(for: CharacterSelection(id: "agent"))    // a fixed guide; bundled? remember(_:for:)
let starter = try await service.head(for: CharacterSelection(id: "dashDealt", seed: installSeed))   // same seed, same face
let cast = try await service.characters()   // ids, names, families, pick axes; SpeciesUnsupported on an old service
```

- The first, uncached bake of a species takes ~15 s on the service; it waits
  `characterBakeTimeout` (45 s), so no timeout to raise. Later loads are cached.
- Play it like a person: expressions, `HeadCue`, listening, presence,
  `SpeechVoice` / `SingingVoice` through one `AvatarPerformanceInput`. No
  per-species host code; D.A.S.H. draws the mouth on its screen.
- `save(character:)` (backend key) gives a key that `head(forKey:)` and
  `renderURL(for:)` take; `HeadDocument.character` tells a species from a person.
- The editor picks species with `offersSpecies: true` (kind row; `doc` becomes
  `{"character": …}`, `service.save(doc)` saves it, `CharacterSelection(document: doc)`
  reads it back, nil for a person); `colors:` overrides do nothing on one.

## 5. The editor

```swift
import MinimojiEditorUI

@State var doc: [String: Any] = me.minimojiDoc ?? MinimojiEditorView.starter()
@State var head: HeadDocument?   // the last baked preview, for a Save screen

MinimojiEditorView(service: service, doc: $doc, head: $head)
  .minimojiEditorTheme(MinimojiEditorTheme(page: …, card: …, ink: …, dim: …, accent: …))   // or the default
// on Save: hand `doc` to your backend, which POSTs /avatars with its secret key
```

`me.minimojiDoc` stands for the document you stored for the user; a new user
starts from `MinimojiEditorView.starter()`. The theme line is optional: omit
it for the default look.

With the built-in selfie camera and AI edit:

```swift
MinimojiEditorView(service: service, doc: $doc, head: $head,
                   imports: .kit(camera: true),
                   proposalOpen: $stageBusy)              // true while the camera, the read or a new face owns the stage
```

- `imports: .kit(camera: true)` needs a nonempty
  **`NSCameraUsageDescription`** in your `Info.plist`; without one (or on the
  simulator) the camera button opens the photo library and the pick is the
  send. Voice needs `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription`; the mic hides without them.
- **Hide your own Cancel/Save while `proposalOpen` is true.** The Kit's Keep,
  Undo, Retake and ✕ are the only exits then.
- The editor fills the space you give it (the stage takes what the parts
  panel doesn't use; the camera takes all of it), so put it in a sheet or a
  screen with no fixed height. `shuffleHeads:` is deprecated and ignored.
- A "replace my avatar" screen starts fresh:

```swift
MinimojiEditorView(service: service, doc: $newDraft, head: $newHead,
                   imports: .kit(camera: true), creatingAvatar: true, creationSource: .selfie)
```

  `.selfie` opens the stage camera on arrival, `.description` the composer
  with the keyboard up. `onReplacement` runs after Keep to persist.
- The editor never saves. Persistence, and the `POST /avatars` through your
  backend, are yours.

## 6. Cue a gesture

```swift
@State private var cue: HeadCue? = nil
@State private var cues = 0

MinimojiMetalHeadView(document: head, expression: "happy",
                      cue: cue,
                      onGestureEnd: { gesture, cancelled in /* chain the next one here */ })

// on the moment
cues += 1
cue = HeadCue(.gesture(.doubleTake), generation: cues)   // a named track, any face's
cue = HeadCue(.forMood("laugh"), generation: cues)       // one of laugh's three, never the last one twice
```

- A cue is a **value**: it fires once per distinct `HeadCue`. Bump
  `generation` to play the same gesture again; nil clears.
- The face never changes. One shot only: chain from `onGestureEnd`.
- Under Reduce Motion nothing moves and `onGestureEnd` still comes on the
  next frame, so a chain advances. Do not add your own Reduce Motion check.
- Cueing your own gestures? Pass `emotes: false`: a new `expression` then
  plays no emote of its own (and does not cut your cue short), cues still
  play. Do not pass `performances: false` for that: it silences cues too.
  `bursts: false` drops only the stickers that pop on a mood change.
- Over a host's beat (a `performance:` source with `beat`), a cue rides over
  the nod and the nod keeps the beat. A singing app leaves `performances`
  on, passes `emotes: false`, and cues a nod or a double take on its moments.
- A recorded line's cue track (`{at, mood}` / `{at, gesture}`) plays
  through `SpeechCueTrack`: `cues(since:through:)` each frame, `held(at:)`
  on a seek.

## 7. Read a mood from text

`service.pickExpression(for:mode:gesture:)` returns the face a line of text
reads as and, with `gesture: true`, a gesture to cue beside it. As the demo
asks:

```swift
guard let pick = try? await service.pickExpression(for: text, mode: .balanced, gesture: true), let mood = pick.expression else { return nil }
```

- **A nil pick changes nothing**: `expression == nil` means keep the face
  the head wears, not "neutral".
- `pick.gesture` is a `HeadGesture?`; cue it with `HeadCue(.gesture(g),
  generation: …)`.
- Debounce: ask on a typing pause or a finished phrase, never per
  keystroke. The service gives up after 3 s (a `504`), the client after
  5 s.
- **Words go to the service; audio never does.** Send text (a status, a
  transcript you made on the device), not recordings.

## 8. Live speech (`MinimojiLive`)

For a call with no transcript, `LiveVisemes` guesses a mouth shape from the
PCM you already play, on the device, and a per-head `SpeechVoice` eases it:

```swift
import MinimojiLive

let visemes = LiveVisemes(sampleRate: 48_000)        // one per voice (per participant), kept

// wherever your voice SDK hands you a remote track's PCM (mono Float32), on its own queue:
func render(pcm: UnsafeBufferPointer<Float>) {
  visemes.process(pcm, at: CACurrentMediaTime())     // the time the buffer ARRIVED is all it needs
}

// in each head's performance source, on the main actor:
func performanceSnapshot(at hostTime: TimeInterval) -> AvatarPerformanceSnapshot {
  let dt = hostTime - lastTime; lastTime = hostTime        // your own frame step
  let (viseme, level) = visemes.now(at: hostTime)    // a pure read: every head of this voice gets the same answer
  return AvatarPerformanceSnapshot(mouth: voice.sample(dt: dt, viseme: viseme, level: level), voiceLevel: viseme == nil ? nil : level)
}
```

- Fed speech is all it takes: the mouth articulates (lips meet on
  `.shut`), the head breathes in the phrase gaps, and natural talk glances
  aside, follows pitch and nods at phrase ends. All on by default, no host
  code; the views have no switch for them (the opt-outs and
  `FaceLife.inhale(length:lead:)` are on a `FaceLife` you drive yourself).
  `SpeechVoice(articulate: false)` / `LiveVisemes(…, articulate: false)`
  bring back the pre-9.40 mouth.
- Pitch is off by default (it costs CPU). With `LiveVisemes(sampleRate:
  48_000, pitch: true)`, read `let (viseme, level, pitch) =
  visemes.voice(at: hostTime)` and pass `voice.sample(dt:viseme:level:pitch:)`,
  so natural talk's brows follow it.
- A head that hears someone else: feed `heardVoice: HeardVoice(level:pitch:look:)`
  in its snapshot every frame (`level: 0` through pauses, `nil` on the
  speaking head); a feed 300 ms stale releases.
- The performance source is an `@MainActor` class conforming to
  `AvatarPerformanceInput`, held once per head and passed as
  `performance:` with `talking: true`.
- **Always feed a shape** while the voice plays: through silences hand
  `SpeechVoice` `.rest`, and `nil` only once the voice ends, or the head's
  own talk jaw takes over.
- One `LiveVisemes` per voice (any number of heads read it), one
  `SpeechVoice` per head. A gap in arrivals (DTX, a mute) re-anchors by
  itself; call `reset()` when the voice behind it changes.
- `LiveVisemes` opens no microphone and no audio session, and records or
  sends nothing (only `MinimojiLinePlayer` sets `.ambient`, and you can opt
  out).
- Events ride the same snapshot as counters, never flags: bump
  `blinkSequence` for a blink, `dropSequence` for the listening drop (a
  bigger nod and a burst of notes: a pluck, a beat drop). Each fires once
  per change and is never replayed after a stop; a drop needs the view's
  `listening:` set, or it does nothing.

### Say a line: one call (`MinimojiLinePlayer`)

**Hand the player the audio.** `host.say(audioFile: url, transcript: …)`
makes the head lip-sync to it, emote and caption it, with no line building
and no lip-sync code in your app. The player builds the line on the device
with `SpeechLine.build`, off the main actor (no upload), caches it per file
and plays it. `MinimojiCaptions` shows its words. The line player arrived in
Kit 9.44.0; plain audio comes in 9.46.0 (see
RELEASE_NOTES.md for the tag). The views need iOS 18 / macOS 15.

```swift
import SwiftUI
import MinimojiKit
import MinimojiMetal

@available(iOS 18, macOS 15, *)
struct DashSaysHey: View {
  let head: HeadDocument
  let audio: URL                             // any file AVFoundation reads: m4a, mp3, wav, caf
  @StateObject private var host = MinimojiLinePlayer()   // made once: the view struct is rebuilt, the player is not

  var body: some View {
    VStack {
      Button { host.say(audioFile: audio, transcript: "Hey! I am D.A.S.H.", mood: "happy") } label: {
        MinimojiMetalHeadView(document: head, linePlayer: host, framing: .face)
      }
      .accessibilityLabel("Replay")
      MinimojiCaptions(player: host)
    }
    .task { _ = try? await host.prepare(audioFile: audio, transcript: "Hey! I am D.A.S.H.", mood: "happy") }   // the tap then starts at once
  }
}
```

- **Words, a transcript or neither:** `words:` as
  `[SpeechLine.Word(text:start:end:)]` (your TTS provider's timestamps or
  on-device dictation) give phrase captions and word cues, such as a nod on
  "yes". `transcript:` gives one caption over the voiced part. Samples in
  memory go through `say(pcm:sampleRate:…)` instead, which is not cached.
- **Not prepared?** `say` still works. The line starts once it has been
  built (a 10 s clip takes a fraction of a second). `preparing` is true until
  then, and the head stays as it is.
- **A clip that can't be built** (unreadable, empty, over 60 s) never plays
  and never hangs. The say ends `.stopped`, and `lastFailure` (cleared by
  the next say) and `onFailure` give the reason. `EndReason` still has only
  `.ended` and `.stopped`.
- **A prebuilt line** (`SpeechLine(json:)`, the same JSON the website plays)
  is the fast path: `host.say(line, audio: url)`.
- **The head view takes the player** (`linePlayer:`): the mouth on the
  audio's clock, the line's strong mood cues as emotes, quiet ones (k under
  0.35) as a face change only, gestures as cues. The view's own emotes are
  off while it speaks, so the line's cues are the only ones.
- **Never hangs.** No audio, an `AVAudioPlayer` that can't be made or won't
  play, a sound that stops short, or a clock that stalls (1.5 s; 4 s before
  it first moves): the line carries on a silent clock, and the mouth and
  captions still run and end. Audio errors are logged.
- **The newest `say` wins** (a generation token): it cuts the line before
  it, and the old one's callbacks do nothing. `stop()` ends a line;
  `await host.speak(audioFile:…)` (or `speak(line, audio:)`) returns `.ended` or `.stopped`, and
  cancelling its task stops the line. Never stop on `onDisappear`, which
  can fire after the next screen's `onAppear` and cut off its line.
- **Audio session `.ambient` by default**: it mixes, respects the silent
  switch, and never ducks or interrupts the person's own audio.
  `MinimojiLinePlayer(audioSession: .leaveAlone)` keeps your session.
- **Captions** (`MinimojiCaptions(player:)` observes the player itself):
  phrases by default — at most four words, broken after punctuation, the
  word being said lit and staying lit through the pause after it; the first
  phrase shows before the voice starts and the last stays a second after it
  ends; a new phrase pushes up. `style: .window` is Kit 9.44's sliding window
  (about 7 words / 40 characters), to pin the old look. Reduce Motion shows
  the whole line at once: give a subtitle slot `maxLines: 1` or `height:`
  and a long line shrinks to fit, then truncates. VoiceOver announces each
  line once, and the moving words are hidden from it. They must survive
  large Dynamic Type (shrink a headline beside the head instead).
- **Building a line yourself**, offline (to store or send it):
  `try SpeechLine.build(audioFile: url, words: words, mood: "happy")`
  (`MinimojiLive`), with `words` as `[SpeechLine.Word(text:start:end:)]`
  from your TTS provider's timestamps or on-device dictation. Without
  words, pass `transcript:` for one caption, or neither. It matches the
  website's builder; a 10 s line takes a fraction of a second. Never derive
  mouth shapes from letters.
- **`mood:` sets the opening face quietly** (no emote burst at the line's
  start). **Audio tags** in the words or transcript (ElevenLabs'
  `[excited]`, `[curious]`, `[whispers]`…) leave the captions and become
  quiet face changes at their word (`SpeechLine.tagMoods`); `[laughs]` plays
  the laugh. Pass the provider's words as they come.

### A host that talks (onboarding, tours)

A character that says one line per screen: `MinimojiLinePlayer` plus a
few rules.

- **One line per screen.** Start it on appear after a 250–500 ms lead-in;
  tapping the head replays it. Pick lines at random, never the same one
  twice in a row.
- **Load the host early** (a character bake is about 5 MB). Show
  `MinimojiHeadPoster` until it is ready: it retries a failed load while on
  screen (2 s, doubling to 30 s), and `session: true` keeps the loaded head
  for the session so it is live at once when it comes back.
- Hide off-screen duplicate heads from VoiceOver.
- Under `.face` framing a character like D.A.S.H. reads about 10% larger
  than a person's head in the same frame. Give its poster `character:` so
  the still lands exactly on it.
- **Never break the host.** A missing clip, a line that won't decode, an
  audio error: fall back to the still head or the silent clock (`say(line,
  audio: nil)` still moves the mouth and captions), log it under one
  category, and never block the screen on it. The player already never hangs.
- **Own long-lived things in a reference object made once** (`@StateObject`,
  or your screen's model): the player, a tilt or motion source, the loaded
  head. Not in a SwiftUI view struct, which is rebuilt every update. Decode
  each line's JSON once per process and keep it.
- **Post-processing the provider's audio** (a robot filter, a pitch shift)
  must keep the exact duration: pad or trim back to the raw recording's
  sample count, or every word timing drifts against the mouth and captions.
- **VoiceOver** hears the line once (`MinimojiCaptions` announces it) and
  never the captions word by word. Skipping the audio under VoiceOver, so
  the voice doesn't talk over the screen reader, is an option, not the rule
  (`UIAccessibility.isVoiceOverRunning`).

#### A host on a sign-in screen (before auth)

No key, no network: bundle the character's GLB (its bake, fetched from the
service once at build time and added to your app), its lines and their
audio, and draw it with `MinimojiMetalHeadView`. Nothing here calls
`AvatarService`.

```swift
@MainActor final class SignInHost: ObservableObject {   // made once, owned by the screen
  let player = MinimojiLinePlayer(restingExpression: "happy")
  private(set) var head: HeadDocument?
  private(set) var hello: SpeechLine?
  init() {
    // decoded once; a missing or bad file leaves the screen without a host, never broken
    head = Bundle.main.url(forResource: "agent", withExtension: "glb")
      .flatMap { try? GLB.decodeHead(Data(contentsOf: $0)) }
    hello = Bundle.main.url(forResource: "hello", withExtension: "line.json")
      .flatMap { try? SpeechLine(json: Data(contentsOf: $0)) }
  }
}

@available(iOS 18, macOS 15, *)
struct SignInScreen: View {
  @StateObject private var host = SignInHost()
  var body: some View {
    VStack {
      if let head = host.head {
        MinimojiMetalHeadView(document: head, linePlayer: host.player, framing: .face).frame(height: 200)
        MinimojiCaptions(player: host.player, maxLines: 1)
      }
      // … the sign-in form, never waiting on the host
    }
    .task {
      guard let line = host.hello else { return }
      try? await Task.sleep(for: .milliseconds(350))
      _ = await host.player.speak(line, audio: Bundle.main.url(forResource: "hello", withExtension: "m4a"))   // nil: the silent clock
    }
  }
}
```

```swift
@available(iOS 18, macOS 15, *)
struct OnboardingHost: View {
  let head: HeadDocument
  let line: SpeechLine
  let audio: URL
  @StateObject private var host = MinimojiLinePlayer(restingExpression: "happy")

  var body: some View {
    VStack {
      Button { host.say(line, audio: audio) } label: {
        MinimojiMetalHeadView(document: head, linePlayer: host, framing: .face)
      }
      .accessibilityLabel("Replay")
      MinimojiCaptions(player: host)
    }
    .task {                                    // cancelled with the view; the generation token guards the rest
      try? await Task.sleep(for: .milliseconds(350))
      _ = await host.speak(line, audio: audio)
    }
  }
}
```

## 9. Saving

```swift
// store a KEY against a user, not a document: the same document is always the same key.
// Host-provided backend client (not a MinimojiKit API): your backend authenticates
// the user and calls POST /avatars with its secret key. Never embed that key in iOS.
let saved = try await yourBackend.saveAvatar(doc)           // response includes avatarKey, glb, png, json
```

The response's `avatarKey` is what you store; `renderURL(for:size:)` and
`head(forKey:)` take it.

### Use my Minimoji: a person's own avatar

A person with a Minimoji account (minimoji.com/me) can bring their avatar
to your app. You never send an email: they pick one on minimoji.com (an
`ASWebAuthenticationSession`, so an existing minimoji.com sign-in is one tap)
and your app gets that pick. The host's three lines:

```swift
import MinimojiService

// 1. show the button (iOS 18; `service.connect(from: window)` is the same flow on 17)
MinimojiConnectButton(service: service) { connected in
  user.minimoji = connected              // 2. store { grantId, avatarKey } against your user
}
// 3. on launch, follow their edits and re-picks; nil means they disconnected your app
user.minimoji = try await service.refresh(user.minimoji!.grantId)
```

- One live grant per app and person: connecting again (another device, or the person reconnecting) replaces the grant, and the old id answers 410 (`refresh` returns nil). Re-read the grant you stored before clearing it; another device may have saved a new one.
- `service.key` is your app's publishable key; its label (set at
  minimoji.com/developers/keys) is the app name the person sees.
- Show the head with `head(forKey: connected.avatarKey)` or
  `renderURL(for:size:)`.
- An avatar your server saved with `POST /avatars`:
  `service.addToLibrary(grantId, avatarKey:)` puts it in their library and
  picks it for your app (`.service` with a 403's words if they said no).

## 10. Gotchas

- **Never put `current` or locks on a photo request.** A selfie is always a
  new face; the editor sends a photo alone. Calling
  `service.generate(photo:prompt:current:)` with a document by hand takes
  the slow edit ladder.
- **Attach the engine only on a matching bake version**, and attach anyway
  if capabilities is silent for 3 s (section 3).
- **No server fallback for device builds yet**: the editor shows the error
  and a retry.
- Secret keys stay on your backend; the app holds only `mk_pub_…`.
- Use the `.convex.site` origin, not `.convex.cloud`.
- Service errors are `AvatarService.Fail` (transport errors such as
  `URLError`, and `CancellationError`, pass through as they are): `.rejected` (a `400`, e.g. no face in the
  photo), `.limited(retryAfterMs: Int, String)` (a `429`), `.service(String)`, `.reply(status:body:)`. On an old service `characters()`,
  `head(for: CharacterSelection)` and `save(character:)` throw
  `AvatarService.SpeciesUnsupported`.

## 11. Web twin

The same calls exist for React in `@minimoji/react`: `MinimojiHead` takes
`cue={{ gesture: 'double-take', generation }}` or `{ mood: 'laugh' }` and
`onGestureEnd`, and the engine's `createLiveVisemeTimeline` is what
`LiveVisemes` ports. Integrate the web side with the `minimoji-web` skill.
