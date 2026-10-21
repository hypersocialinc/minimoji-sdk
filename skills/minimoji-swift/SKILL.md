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
    from: "9.4.0"
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
"Up to Next Major" from 9.4.0, and tick the same products. `MinimojiLive`
(live lip-sync, section 8) is a seventh product.

| you want | link |
|---|---|
| a head in a view | `MinimojiKit`, `MinimojiMetal`, `MinimojiService` |
| the editor | add `MinimojiEditor`, `MinimojiEditorUI` |
| previews built on the phone | add `MinimojiEngine` |
| lip-sync from a live call's audio | add `MinimojiLive` |

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
  document from an earlier load) and it is exact from the start.
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
  `{"character": …}`, `service.save(doc)` saves it); `colors:` overrides do nothing on one.

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
                   shuffleHeads: cast.map(\.document),   // optional: the heads the shuffle turns through
                   proposalOpen: $stageBusy)              // true while the camera, the read or a new face owns the stage
```

- `imports: .kit(camera: true)` needs a nonempty
  **`NSCameraUsageDescription`** in your `Info.plist`; without one (or on the
  simulator) the camera button opens the photo library and the pick is the
  send. Voice needs `NSMicrophoneUsageDescription` and
  `NSSpeechRecognitionUsageDescription`; the mic hides without them.
- **Hide your own Cancel/Save while `proposalOpen` is true.** The Kit's Keep,
  Undo, Retake and ✕ are the only exits then.
- `shuffleHeads:` is optional (`[HeadDocument]`); without it the device
  builds three starters when a builder is attached.
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
- Over a host's beat (a `performance:` source with `beat`), a cue rides over
  the nod and the nod keeps the beat. A singing app leaves `performances`
  on, passes `emotes: false`, and cues a nod or a double take on its moments.

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
  let (viseme, level) = visemes.now(at: hostTime)    // a pure read: every head of this voice gets the same answer
  return AvatarPerformanceSnapshot(mouth: voice.sample(dt: dt, viseme: viseme, level: level), voiceLevel: viseme == nil ? nil : level)
}
```

- The performance source is an `@MainActor` class conforming to
  `AvatarPerformanceInput`, held once per head and passed as
  `performance:` with `talking: true`.
- **Always feed a shape** while the voice plays: through silences hand
  `SpeechVoice` `.rest`, and `nil` only once the voice ends, or the head's
  own talk jaw takes over.
- One `LiveVisemes` per voice (any number of heads read it), one
  `SpeechVoice` per head. A gap in arrivals (DTX, a mute) re-anchors by
  itself; call `reset()` when the voice behind it changes.
- The Kit opens no microphone and no audio session, and records or sends
  nothing.
- Events ride the same snapshot as counters, never flags: bump
  `blinkSequence` for a blink, `dropSequence` for the listening drop (a
  bigger nod and a burst of notes: a pluck, a beat drop). Each fires once
  per change and is never replayed after a stop; a drop needs the view's
  `listening:` set, or it does nothing.

## 9. Saving

```swift
// store a KEY against a user, not a document: the same document is always the same key.
// Host-provided backend client (not a MinimojiKit API): your backend authenticates
// the user and calls POST /avatars with its secret key. Never embed that key in iOS.
let saved = try await yourBackend.saveAvatar(doc)           // response includes avatarKey, glb, png, json
```

The response's `avatarKey` is what you store; `renderURL(for:size:)` and
`head(forKey:)` take it.

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
  photo), `.limited(retryAfterMs: Int, String)` (a `429`), `.service`, `.reply`.

## 11. Web twin

The same calls exist for React in `@minimoji/react`: `MinimojiHead` takes
`cue={{ gesture: 'double-take', generation }}` or `{ mood: 'laugh' }` and
`onGestureEnd`, and the engine's `createLiveVisemeTimeline` is what
`LiveVisemes` ports. Integrate the web side from that package's own docs.
