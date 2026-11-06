# The presenter in SwiftUI

A recipe, not a package: the same `slides.json` and the same `lines/slide<N>.wav` + `.json` as the web starter (made
by `scripts/make-lines.sh`), played with MinimojiKit's own parts. Read `../SKILL.md` first: every rule there holds here.
Head basics (documents, `MinimojiMetalHeadView`, `MinimojiHeadPoster`) are in the `minimoji-swift` skill.

## The parts

- **`MinimojiLinePlayer`** plays each slide's line (`say(line, audio:)`), publishes the held look and cues for the
  head (`expression`, `cue`, `look`), and calls `onEnd(generation, reason)` when a line ends. Its `captionTime` moves
  per word: that is the bubble's clock.
- **A pager**: a `TabView` with `.tabViewStyle(.page)`, or your own `ZStack` that swaps slides. The deck moves it, not
  a swipe timer.
- **The bubble**: one caption at a time from `line.captions`, the word being said in a filled pill (the line's
  `words`, lit when `captionTime` passes a word's start). Split a caption longer than about 64 characters at
  punctuation, never leaving one word alone (the web SDK's `capsFromLine` rules; there is no Swift port yet).
- **The ending**: the bubble gone, the head to one side, `joy`, looking at the buttons, a small Replay.

## The model

```swift
struct Deck: Decodable {
  struct Wait: Decodable { let `for`: String; let prompt: String?; let nudge: String?; let nudgeAfterMs: Int? }
  enum Next: Decodable {
    case always(String), byValue([String: String])
    init(from d: Decoder) throws {
      let c = try d.singleValueContainer()
      if let id = try? c.decode(String.self) { self = .always(id) } else { self = .byValue(try c.decode([String: String].self)) }
    }
  }
  struct Slide: Decodable { let id: String?; let say: String; let pos: String?; let mood: String?; let gesture: String?; let wait: Wait?; let next: Next? }
  let holdMs: Int?
  let slides: [Slide]

  /// where slide `i` goes: `next` by value, `next` as one id, else in order; nil ends
  func next(after i: Int, value: String? = nil) -> Int? {
    let pick: String? = switch slides[i].next {
      case .always(let id): id
      case .byValue(let map): value.flatMap { map[$0] }
      case nil: nil
    }
    if pick == "end" { return nil }
    if let pick, let at = slides.firstIndex(where: { $0.id == pick }) { return at }
    return i + 1 < slides.count ? i + 1 : nil
  }
}
```

## The presenter

```swift
@MainActor final class Presenter: ObservableObject {       // made once, owned by the screen
  let player = MinimojiLinePlayer(restingExpression: "happy")
  let deck: Deck
  @Published private(set) var index = 0
  @Published private(set) var waitingFor: String?
  @Published private(set) var ended = false
  @Published private(set) var prompt: String?             // a waiting step's silent bubble text
  private var lines: [SpeechLine?] = []                    // decoded once, all before the show
  private var audio: [URL?] = []
  private var playing: Int?
  private var hold: Task<Void, Never>?

  init(deck: Deck, folder: URL) {
    self.deck = deck
    for i in deck.slides.indices {
      lines.append(try? SpeechLine(json: Data(contentsOf: folder.appending(path: "slide\(i).json"))))
      audio.append(folder.appending(path: "slide\(i).wav"))
    }
    player.onEnd = { [weak self] generation, reason in
      Task { @MainActor in if reason == .ended, generation == self?.playing { self?.lineEnded() } }
    }
  }

  func play(_ i: Int) {
    hold?.cancel(); player.stop()
    index = i; waitingFor = nil; prompt = nil; ended = false
    // a missing line plays nothing and moves on after its hold; a missing clip plays the line on the silent clock
    guard let line = lines[i] else { return lineEnded() }
    playing = player.say(line, audio: audio[i])
  }

  private func lineEnded() {
    let slide = deck.slides[index]
    if let wait = slide.wait {                             // hold: no auto-advance; the app's own view shows below the head
      waitingFor = wait.for; prompt = wait.prompt
      if let nudge = wait.nudge {
        hold = Task { [index] in
          try? await Task.sleep(for: .milliseconds(wait.nudgeAfterMs ?? 8000))
          if !Task.isCancelled, self.index == index, self.waitingFor != nil { self.prompt = nudge }   // once, silently
        }
      }
      return
    }
    hold = Task {                                          // the line's end, then the hold: never a fixed timer
      try? await Task.sleep(for: .milliseconds(deck.holdMs ?? 250))
      if !Task.isCancelled { advance(nil) }
    }
  }

  /// the app's answer to a waiting step: a choice's value, a permission's result
  @discardableResult func done(_ event: String, value: String? = nil) -> Bool {
    guard waitingFor == event else { return false }
    waitingFor = nil
    advance(value)
    return true
  }

  func skip() { hold?.cancel(); player.stop(); ended = true }

  private func advance(_ value: String?) {
    if let next = deck.next(after: index, value: value) { play(next) } else { ended = true }
  }
}
```

## The screen

```swift
@available(iOS 18, macOS 15, *)
struct IntroScreen: View {
  @StateObject var presenter: Presenter
  let head: HeadDocument
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    ZStack(alignment: .bottom) {
      SlideView(slide: presenter.deck.slides[presenter.index])          // your own content per slide id
      VStack {
        if !presenter.ended { Bubble(player: presenter.player, override: presenter.prompt) }
        MinimojiMetalHeadView(document: head, linePlayer: presenter.player, framing: .face)
          .frame(width: 190, height: 190)
        if presenter.waitingFor == "topic" {                              // the app's own view, under the head
          HStack {
            Button("How it's filed") { presenter.done("topic", value: "filing") }
            Button("Who can use it") { presenter.done("topic", value: "sharing") }
          }
        } else if presenter.waitingFor == "notify" {
          Button("Turn on alerts") {
            Task { let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert])) ?? false
                   presenter.done("notify", value: ok ? "allowed" : "later") }
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: presenter.ended ? .leading : .center)
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.7), value: presenter.ended)
    }
    .onAppear { presenter.play(0) }
  }
}
```

`Bubble` reads `player.line?.captions` and `player.captionTime`: the caption whose span holds the time (the last
one after the line ends), its words with the one being said in a pill, at most two lines, text weight 700 at 17 pt,
a dark ink bubble (charcoal on a dark slide). `override` shows a waiting step's prompt or nudge instead.

## Where it differs from the web

- **No autoplay gate.** An app may start the first line on appear; the audio session rules apply instead
  (`MinimojiLinePlayer(audioSession: .ambient)` by default: the ringer switch mutes it, other audio keeps playing).
- **D.A.S.H.'s screen face** has the Kit's `crt` default (1); keep it, it is part of the character.
- **Reduce Motion** (`UIAccessibility.isReduceMotionEnabled`, `accessibilityReduceMotion`): no slide of the head
  across the screen, no auto-advance after a slide the person didn't choose, captions crossfade.
- **Pause** is the app's: `player.stop()` and replay the slide's line on resume (a navigation restarts it anyway).
- Lines and audio ship in the app bundle (or download once): decode every `slide<N>.json` before the show, as the
  web preloads every clip.
