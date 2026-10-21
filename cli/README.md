# minimoji

The Minimoji command line. Sign a terminal in, mint API keys, set an iOS or
React app up with a key, install the Minimoji agent skills, and make Mini
avatars from the terminal. Node 20 or later, no dependencies.

```sh
npx minimoji login           # approve the code in the browser
npx minimoji init            # in your app's folder: a publishable key, written where the app reads it
npx minimoji skills add      # teach your coding agent the SDK
```

## Signing in

`minimoji login` prints a code and a link to minimoji.com/developers/device,
opens the browser when it can, and waits while you approve it. The session
is saved to `~/.config/minimoji/credentials.json` (mode 0600). `--no-browser`
only prints the link (for SSH, or an agent that hands the link to a person).

| Command | What it does |
| --- | --- |
| `minimoji login [--label …] [--force]` | sign this terminal in |
| `minimoji whoami` | the account it is signed in as |
| `minimoji logout` | sign out, revoking the session and the CLI's own secret key |
| `minimoji keys list` | your keys |
| `minimoji keys create --kind publishable\|secret [--label …]` | mint a key; it is shown in full once |
| `minimoji keys revoke <prefix>` | revoke one, by the prefix `keys list` shows |

## Setting an app up

`minimoji init` looks at the folder:

- **a React app** (a `package.json` with `react` or `next`): writes the key
  and the service URL to `.env.local` as `NEXT_PUBLIC_MINIMOJI_KEY` /
  `NEXT_PUBLIC_MINIMOJI_SERVICE_URL` (Next), `VITE_MINIMOJI_KEY` /
  `VITE_MINIMOJI_SERVICE_URL` (Vite), or `MINIMOJI_KEY` /
  `MINIMOJI_SERVICE_URL`;
- **a Swift app** (an `.xcodeproj`, xcodegen's `project.yml`, or a
  `Package.swift`): adds `MINIMOJI_PUBLISHABLE_KEY` and
  `MINIMOJI_SERVICE_URL` to the app's `Info.plist` (and to `project.yml`'s
  info properties when it already carries them), or, when Xcode generates
  the plist, writes them to `Minimoji.plist` in the app folder.

It mints a **publishable** key labelled after the project, keeps one that is
already there (`--force` mints a new one), and never writes a secret key into
an app: a secret key it finds there is replaced, and it tells you to revoke
it. `--platform swift|web` settles a folder that is both; `--plist` picks
the plist; `--with-skill` also installs the Swift skill. The packages are
not public yet (MinimojiKit is a private GitHub repo, `@minimoji/react` is
not on npm), so `init` prints the install step rather than running it.

## Agent skills

`minimoji skills list | add [name…] | update [name…]` copies the public skills
from [hypersocialinc/minimoji-sdk](https://github.com/hypersocialinc/minimoji-sdk)
into the project: `.claude/skills/<name>/` for Claude Code,
`.agents/skills/<name>/` for Codex. `--agent claude|codex` chooses; otherwise
a `.claude/` folder means Claude Code, an `AGENTS.md`, `.agents/` or
`.codex/` means Codex, and nothing means Claude Code. Skills are fetched
from GitHub at a commit (`--ref`, default `main`), not bundled, and each
`SKILL.md` records that commit in a `minimoji-source:` frontmatter line;
`update` replaces copies from an older commit and leaves current ones alone.
Set `GITHUB_TOKEN` if GitHub's anonymous rate limit gets in the way.

## Making avatars

| Command | What it does |
| --- | --- |
| `minimoji generate "red curls, round glasses" [--photo me.jpg]` | a person from words, a photo or both, saved; `--count n` (at most 10), `--seed n`, `--out kai.json`, `--open` |
| `minimoji species list` | the species and their kits |
| `minimoji species make <id> [--seed n] [--pick axis=option …]` | a species, saved; `--open` |
| `minimoji render <avatarKey> [--size 256] [--face happy] [--out file.png]` | the still picture |
| `minimoji preview <avatarKey \| doc.json> [--face happy] [--body]` | open it on minimoji.com/preview |

Each prints the avatar key, its picture URL and its preview page. A
generation costs model time and spends one of the key's generations for the
day. Saving takes a **secret** key: on first use the CLI mints one labelled
"minimoji CLI on <host>" and keeps it in the credentials file (`logout`
revokes it). `--key` or `MINIMOJI_KEY` uses a key of your own instead.

`preview` of a local file puts the document in the link's fragment, which
the browser never sends to a server.

## Every command

- `--json`: one JSON object on stdout; an error is `{"error": "…"}`.
- Errors are one line on stderr and a non-zero exit.
- `--base prod|dev|<https://….convex.site>` (or `MINIMOJI_API`) picks the
  deployment; production is the default. `MINIMOJI_SITE` points `preview` at
  another copy of the website.
- `MINIMOJI_NO_BROWSER=1` never opens a browser.
