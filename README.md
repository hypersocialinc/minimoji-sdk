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

```sh
npx minimoji login           # approve the code in the browser
npx minimoji init            # in your app's folder: a publishable key, written where the app reads it
npx minimoji skills list     # see available skills and which are installed here
npx minimoji generate "red curls, round glasses" --open   # make a head and see it live
```

Node 20 or later, no dependencies. [cli/README.md](cli/README.md) has every
command.

## The skills

Run these commands from your project's folder. Install just the skill you need;
installing a skill needs no Minimoji login or API key.

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
