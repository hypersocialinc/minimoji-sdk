# Minimoji SDK

The public half of [Minimoji](https://www.minimoji.com/developers): the
`minimoji` command line and the agent skills that teach a coding agent the
SDK. MIT licensed.

```text
cli/                      the minimoji CLI, published to npm as `minimoji`
skills/
  minimoji-swift/
    SKILL.md              the MinimojiKit skill for Swift apps
```

## The CLI

```sh
npx minimoji login           # approve the code in the browser
npx minimoji init            # in your app's folder: a publishable key, written where the app reads it
npx minimoji skills add      # install the skills below into your project
```

Node 20 or later, no dependencies. [cli/README.md](cli/README.md) has every
command.

## The skills

`npx minimoji skills add` copies `skills/<name>/` into your project
(`.claude/skills/` for Claude Code, `.agents/skills/` for Codex) at a commit,
and `npx minimoji skills update` refreshes it. Or with the `skills` tool:

```sh
npx skills add hypersocialinc/minimoji-sdk --skill minimoji-swift
```

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

## Where this comes from

This repository is exported from Minimoji's private repo on every change, so
its history is one commit per export. Issues and pull requests are welcome:
see [CONTRIBUTING.md](CONTRIBUTING.md).
