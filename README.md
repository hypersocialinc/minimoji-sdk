# Minimoji SDK

[Minimoji](https://www.minimoji.com) makes expressive 3D Mini avatars for
apps, games and AI agents: a few lines of avatar JSON become a 3D head
and a PNG picture, from one HTTPS API.

This is the public half of it: the `minimoji` command line and the agent
skills that teach a coding agent the SDK. MIT licensed.

- [Developer portal](https://www.minimoji.com/developers): keys, platforms and the cast
- [API reference](https://www.minimoji.com/developers/docs) (also
  [as Markdown](https://www.minimoji.com/developers/docs.md), and
  [llms.txt](https://www.minimoji.com/llms.txt) for coding agents)
- [`minimoji` on npm](https://www.npmjs.com/package/minimoji)
- [Preview any avatar live](https://www.minimoji.com/preview)

```text
cli/                      the minimoji CLI, published to npm as `minimoji`
web/
  react/                  @minimoji/react on npm: heads in a React app
  heads/                  @minimoji/heads on npm: heads on any page, no React or bundler
skills/
  minimoji-swift/
    SKILL.md              the MinimojiKit skill for Swift apps
  minimoji-web/
    SKILL.md              the @minimoji/react skill for web apps
  minimoji-presenter/
    SKILL.md              decks and onboarding a Mini avatar presents
    starter/              a working deck: HTML + the heads bundle, six voiced lines
    scripts/make-lines.sh slides.json → voiced, re-timed lines (never prints a key)
    react/                the same deck as a React component
    swift/                the SwiftUI recipe
```

## The CLI

Install the CLI once, then run the wizard from your project's folder:

```sh
npm install -g minimoji
minimoji setup
```

Choose Claude Code, Codex or both, then confirm installation of the full skill
bundle. No Minimoji account is needed. Start a new agent session and ask it to
add a talking avatar to your app. The wizard installs project skills; your agent
can help with SDK packages and account setup when needed.

Node 20 or later, no dependencies. Prefer no global install? Run
`npx minimoji setup`. For automation, use
`minimoji setup --yes --agent claude|codex|both --json`.
[cli/README.md](cli/README.md) has every command, including `minimoji login`,
`minimoji init` for your app's key and `minimoji generate` to make an avatar.

## Web SDK release notes

`@minimoji/react` and `@minimoji/heads` (`web/react`, `web/heads`):

- **19.2.0**: ten small D.A.S.H. heads appear in about a second. A D.A.S.H. build took most of a second (every
  surface pick tested every triangle of its cage, and every plate was extruded anew for every head); the first now
  takes about 0.2–0.35 s and each one after it about 50–120 ms, the same heads to the byte. A resting head is drawn at its final size from its first
  frame and swaps without the whirl; `land` on `<MinimojiHead>` chooses either way (default `!rest`). Ten cold
  resting heads: all drawn about 1 s after the stage mounts, against 7.4 s.
- **19.1.0**: small heads that cost nothing at rest. `rest` on `<MinimojiHead>` draws a change, lets it play out
  and holds still; a stage whose heads are all held asks for no animation frame and issues no WebGL draw. Only the
  heads that move are drawn, and small resting heads playing D.A.S.H.'s `thinking` or `working` screen draw at
  `<MinimojiStage restFps>` (default 15). Ten idle 30–56 px heads: 0 frames; one working among nine at rest: about
  2% of a main thread in Electron. Runs under a strict CSP in Electron (no `unsafe-eval`). Opt-in; nothing changes
  without it.
  Also: agent states on every Mini avatar, not just D.A.S.H. (`agentState` on a person, an animal, the ghost or the
  penguin: a face it already has, a gesture now and then, and one held sticker).
- **19.0.0**: D.A.S.H. agent states (`agentState`: thinking, working, needsYou, waiting, done, errored, asleep) and
  `screenColor`. Never published to npm: 19.1.0 carries everything in it.

## The skills

Skills are instructions, examples and supporting files that teach your coding
agent to build with Minimoji. Setup installs the full public bundle so your agent
can use the guides that fit your project. Individual installs are also available:

| Skill | Use it for |
| --- | --- |
| `minimoji-web` | Live heads, lip-sync, moods and gaze in a web app |
| `minimoji-swift` | Native heads, speech and avatar editing on iOS and macOS |
| `minimoji-presenter` | A talking avatar for a deck, demo or onboarding flow |

```sh
npx minimoji skills add minimoji-web --agent claude
npx minimoji skills add minimoji-swift --agent claude
npx minimoji skills add minimoji-presenter --agent claude

# For Codex, use --agent codex instead:
npx minimoji skills add minimoji-web --agent codex

npx minimoji skills list
npx minimoji skills update minimoji-web   # update just this skill
npx minimoji skills update               # update all installed Minimoji skills
```

Claude Code skills go in `.claude/skills/`; Codex skills go in `.agents/skills/`.
Without `--agent`, the CLI detects the project (and defaults to Claude Code).
Without a skill name, `npx minimoji skills add` installs all available skills.
Each copy records its source commit; updates refuse to overwrite your local edits.

Or install an individual skill with the `skills` tool, which asks which coding
agent to use:

```sh
npx skills add hypersocialinc/minimoji-sdk --skill minimoji-swift
npx skills add hypersocialinc/minimoji-sdk --skill minimoji-web
npx skills add hypersocialinc/minimoji-sdk --skill minimoji-presenter
```

Skills teach your agent; they do not install SDK packages or create API keys.
The skills and the web packages are public. MinimojiKit is available by request;
the presenter skill includes a vanilla web starter.

The Swift skill integrates [MinimojiKit](https://www.minimoji.com/developers),
the Swift package for Minimoji 3D avatar heads: a head in a SwiftUI app on
Metal or RealityKit, its 2D picture, the avatar editor with selfies and AI
edits, head gestures, moods from text and lip-sync to live audio. It needs a
publishable key (`npx minimoji init`, or
[minimoji.com/developers/keys](https://www.minimoji.com/developers/keys)) and
access to the MinimojiKit package. The Kit's README and release notes are at
[minimoji.com/developers/kit/README.md](https://www.minimoji.com/developers/kit/README.md)
and
[minimoji.com/developers/kit/RELEASE_NOTES.md](https://www.minimoji.com/developers/kit/RELEASE_NOTES.md).

The web skill integrates `@minimoji/react`: live heads and characters
(D.A.S.H., the aliens, the animals) on a web page, the head's loader,
lip-sync and emotes from a recorded line or audio, moods, gestures,
listening and presence. Install it with its peers:

```sh
npm install @minimoji/react react@19 react-dom@19 three@0.160 @react-three/fiber@9
```

On a page with no React or bundler, `npm install @minimoji/heads` (or load
`minimoji-heads.js` from a CDN at a fixed version) gives the same heads from
one script.

## Licence

The CLI and these skills are MIT: see [LICENSE](LICENSE). The web packages
under `web/` (`@minimoji/react`, `@minimoji/heads`) are under the Minimoji SDK
License (`LICENSE-SDK` in each). The API (with a key), the CLI, the skills and
the web packages are open to anyone; the Swift package is for partners, by
request, for now.

## Where this comes from

This repository is exported from Minimoji's private repo on every change, so
its history is one commit per export. Issues and pull requests are welcome:
see [CONTRIBUTING.md](CONTRIBUTING.md).
