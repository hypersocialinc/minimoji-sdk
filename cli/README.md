# minimoji

[Minimoji](https://www.minimoji.com) makes expressive 3D Mini avatars for
apps, games and AI agents: people, and characters such as D.A.S.H. A few
lines of avatar JSON become a 3D head (GLB) and a PNG picture, from one
HTTPS API, and the SDKs make the head talk and emote.

This is its command line. Sign a terminal in, mint API keys, set an iOS or
React app up with a key, install the Minimoji agent skills, and make Mini
avatars from the terminal. Node 20 or later, no dependencies.

- Docs: [minimoji.com/developers](https://www.minimoji.com/developers), the
  [API reference](https://www.minimoji.com/developers/docs) and
  [llms.txt](https://www.minimoji.com/llms.txt) for coding agents
- See any avatar live: [minimoji.com/preview](https://www.minimoji.com/preview)
- Source and skills: [hypersocialinc/minimoji-sdk](https://github.com/hypersocialinc/minimoji-sdk)

```sh
npx minimoji login           # approve the code in the browser
npx minimoji init            # in your app's folder: a publishable key, written where the app reads it
npx minimoji skills add      # teach your coding agent the SDK
npx minimoji generate "red curls, round glasses" --open   # make a head and see it live
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
the plist; `--with-skill` also installs the platform's skill (`minimoji-swift` or
`minimoji-web`). The packages are
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
| `minimoji generate "red curls, round glasses" [--name kai] [--photo me.jpg]` | a person from words, a photo or both, saved and kept in your library; `--count n` (at most 10), `--seed n`, `--out kai.json`, `--open` |
| `minimoji species list` | the species and their kits |
| `minimoji species make <id> [--seed n] [--pick axis=option …]` | a species, saved; `--open` |
| `minimoji render <avatarKey \| name> [--size 256] [--face happy] [--out file.png]` | the still picture |
| `minimoji preview <avatarKey \| name \| doc.json> [--face happy] [--body]` | open it on minimoji.com/preview |

Each prints the avatar key, its picture URL and its preview page. A
generation costs model time and spends one of the key's generations for the
day. Saving takes a **secret** key: on first use the CLI mints one labelled
"minimoji CLI on <host>" and keeps it in the credentials file (`logout`
revokes it). `--key` or `MINIMOJI_KEY` uses a key of your own instead.

`preview` of a local file puts the document in the link's fragment, which
the browser never sends to a server.

## Your avatar library

Signed in, every avatar `generate` makes is kept in your account under a
name: `--name kai`, or a slug of the words (`red-curls-round-glasses`), with
`-2`, `-3`… when the name is taken. Sign in on another machine and the same
library is there.

| Command | What it does |
| --- | --- |
| `minimoji avatars` (or `avatars list`) | name, short key, kind (person or species), saved date; `--json` gives `{avatars: [{name, avatarKey, kind, createdAt}]}` |
| `minimoji avatars save <key> [--name pal]` | keep any saved avatar, someone else's too; saving it again changes nothing unless `--name` renames it |
| `minimoji avatars get <name \| key> [--out kai.json]` | the key and the document |
| `minimoji avatars rename <name \| key> <new>` | a new name |
| `minimoji avatars remove <name \| key>` | drop it from the library; the avatar stays saved and its key keeps working |

### Changing one

```sh
minimoji edit kai "make the hair blue"     # kai is now the blue-haired one
minimoji edit kai --photo me.jpg           # change it toward a photo
minimoji edit kai "add glasses" --as kai-glasses   # keep it as a new entry; kai stays as it was
```

`edit <name | key> ["words"] [--photo me.jpg] [--as new-name]` sends the
avatar's document with the words, the photo or both to the service, which
changes that avatar rather than starting over. The result is saved under a
new key, and the name follows it: `render kai` and `preview kai` show the
edit, and apps connected to kai through minimoji.com/connect see it too. The
old key keeps working and is printed in full (`was`; `previousKey` in
`--json`, beside `name`, `avatarKey`, `notes`, `picture` and `preview`):
`minimoji avatars save <old key> --name kai-before` keeps the old look as an
entry of its own. An edit spends one generation from the key's day, like
`generate`. A species can't be edited this way (`species make` picks its
look). Signed out, `edit` takes a key, prints the new one and keeps nothing.

A name is 1 to 40 lowercase letters, digits and dashes. Wherever a command
takes an avatar, it reads an exact name first, then a full 64-hex key, then a
key prefix of 8 or more characters that only one of your avatars starts
with. A library holds 500 avatars.

## Status

The line beside your avatar in every app that wears it (Bunch, savethis, Fizz
FM). It is kept on the library entry and read for a mood once, on the service;
the Minimoji app's you screen sets the same line.

```sh
minimoji status kai "back at 3"     # set it: kai: back at 3 (happy, just now)
minimoji status kai                 # print it
minimoji status kai --clear         # clear it
```

A status is one line of at most 140 characters. `minimoji avatars get` prints
it too.

## Voices and spoken lines

Give an avatar an ElevenLabs voice, then turn any sentence into a line it
speaks. You bring your own ElevenLabs key: `export ELEVENLABS_API_KEY=…` (or
`--elevenlabs-key`). It goes to api.elevenlabs.io and nowhere else. It is
never sent to Minimoji, never written to a file and never printed.

```sh
minimoji voice kai 21m00Tcm4TlvDq8ikWAM          # Rachel, by id (no key needed)
minimoji voice dash Brian --effect robot         # by name (looked up with your key); D.A.S.H.'s robot
minimoji voice kai                               # what kai speaks with
minimoji voice --list                            # your ElevenLabs voices: name and id
minimoji say kai "[excited] Hi, I'm Billie"      # minimoji-lines/hi-i-m-billie.json + .wav
```

| Command | What it does |
| --- | --- |
| `minimoji voice <name \| key> <voice id \| name> [--effect robot\|none] [--settings stability=0.4,speed=1.1]` | keeps `{provider: "elevenlabs", voiceId, effect, settings}` on the library entry, so the voice follows you to any terminal you sign in to. An avatar not in your library yet is added first. The settings are ElevenLabs' `stability`, `similarity_boost`, `style` (0 to 1), `speed` (0.7 to 1.2) and `use_speaker_boost` |
| `minimoji voice <name \| key>` | prints the voice, and the Minimoji app's own voice for it (`app voice: juniper`) when one is set. With no voice yet, it suggests one for the species |
| `minimoji voice <name \| key> --clear` | removes the voice |
| `minimoji voice --list` | lists your account's ElevenLabs voices, using your key |
| `minimoji say <name \| key> "text" [--voice id] [--mood happy] [--out dir] [--name hello] [--effect robot\|none] [--model eleven_v4] [--dry-run]` | one ElevenLabs text-to-speech call with timestamps, then writes `<out>/<name>.wav` and `<out>/<name>.json` and prints both paths and the duration. `--json` gives `{line, audio, duration}` |

- **The voice** comes from `--voice`, else the avatar's library entry. With
  neither, `say` tells you to run `minimoji voice`. `--effect` and
  `--settings` override the stored ones for one line.
- **The line** is the public line format (`docs/speech-line-format.md`): mouth
  frames, captions, timed words and mood cues. `[tags]` in the text (ElevenLabs'
  audio tags, `[excited]`) leave the captions, and a mood tag sets the face.
  `--mood` sets the face the line starts on. Every SDK line player plays it
  with the audio beside it: React `useLine().say(line, { audio })`, the
  vanilla bundle's `createLineSession`, `createLinePlayer`, or Swift
  `MinimojiLinePlayer.say(line, audio:)`.
- **The audio** is a 24 kHz 16-bit mono WAV. `say` asks ElevenLabs for raw
  PCM (every tier has 24 kHz), so the CLI decodes it and runs the effect with
  no ffmpeg and no native dependencies. Convert the WAV to mp3 yourself if
  file size matters.
- **`--effect robot`** is D.A.S.H.'s voice recipe: a 45 Hz tremolo and a faint
  echo, with no change to pitch or tempo, so the word times still line up.
- **Costs**: your key pays, one call per line. A line is at most 1,000
  characters (and 60 seconds of audio), so a stray file can't spend your
  credits. A bad `--mood` or an output folder that can't be written is
  refused before the call. Audio that comes back longer than 60 s is kept as
  `<name>.too-long.wav`, with an error saying to split the text. `--dry-run` prints the voice, the text and its character count and
  sends nothing.
- **The line builder** is the engine's `buildLine`, from the site's public
  bundle (`https://www.minimoji.com/sdk/minimoji-heads.js`). The first `say`
  downloads it over https and caches it in `~/.cache/minimoji` (or
  `$XDG_CACHE_HOME/minimoji`). Later runs only check whether it changed, and
  they work offline from the cache. That URL is fixed: no flag or variable
  points it anywhere else. If it can't be downloaded or loaded, `say` stops
  with one error before the paid call and writes nothing.

## Lines from clips you already have

Have recordings already (another TTS, a human voice, an earlier batch)?
`minimoji lines` turns each one into the same `<name>.json` line `say`
writes, on your Minimoji key alone: no ElevenLabs key anywhere.

```sh
minimoji lines ./clips --texts lines.json --timings   # clips/<name>.json + <name>.timings.json per clip
minimoji lines hello.wav --text "Hi, I'm Billie"      # one clip, its words given
minimoji lines ./clips --dry-run                       # what would be sent; nothing is
```

| Command | What it does |
| --- | --- |
| `minimoji lines <clip \| folder>… [--text "…" \| --texts lines.json] [--out dir] [--timings] [--dry-run]` | one `POST /lines` per clip; writes `<name>.json` beside the clip (or in `--out`) and, with `--timings`, `<name>.timings.json` = `{transcript, words, letters, alignedTo, loss?}` (seconds). `--json` gives `{clips: [{clip, name, status, line, timings?, alignedTo?, loss?, reason?}], skipped}` |

- **The text** of a clip comes from `--text` (one clip), `--texts`
  (`{"<name>": "text"}`, or the `{"<name>": {"text": …}}` of an app's
  `lines.json`) or a `<name>.txt` beside it. With it, the service
  force-aligns that script to the audio, so the lips follow the words as
  written (`alignedTo: "text"`; a high `loss` says text and audio disagree).
  A clip with no text is transcribed (`alignedTo: "transcript"`). `[tags]`
  in the text set the face and are never sent to the aligner.
- **The clips**: `.wav` is read as is; `.mp3` and `.m4a` need `ffmpeg` on the
  PATH (one clear line says so). A folder means its clips, not its
  subfolders. Each is sent as a 16-bit mono WAV at its own rate (48 kHz at
  most).
- **Limits**: at most 30 s a clip and 2,000 characters of text. A clip over
  them, or one that can't be read, is skipped with the reason and the rest
  carry on; the exit code is 1 if any was skipped. A refused key, a spent
  day (each clip is one of the key's 200 lines a day) or the route switched
  off stops the run.
- **Privacy**: the audio and the text go to Minimoji and to ElevenLabs, and
  are not stored.

## Use it from an agent (MCP)

`minimoji mcp` serves the commands as tools over stdio (the Model Context
Protocol), so an agent in Claude Code, Claude Desktop, Cursor or any MCP
client can make avatars, set statuses and say lines with no key to bring.
It runs as this signed-in terminal: run `minimoji login` first. No tool
takes a key, and `login`, `logout` and `keys` are not tools.

Claude Code:

```sh
claude mcp add minimoji -- npx -y minimoji mcp
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`,
or `~/.cursor/mcp.json` for every project):

```json
{
  "mcpServers": {
    "minimoji": { "command": "npx", "args": ["-y", "minimoji", "mcp"] }
  }
}
```

| Tool | What it does | What it spends |
| --- | --- | --- |
| `whoami`, `list_avatars`, `list_species`, `list_voices`, `get_status` | Read the account, the library, the species, the voices, a status | nothing |
| `make_avatar` | From words, a photo (a path or an https URL) or both; kept in the library | one generation each, `count` ≤ 3 |
| `edit_avatar` | Change one with words or a photo; `save_as` keeps it as a new entry | one generation |
| `make_species_avatar` | A species with picks from its kit, kept in the library | nothing |
| `set_status` | The line beside the avatar in every app wearing it | one status change |
| `say` | A line on Minimoji's voice: the audio URL, `line`, `words`, `letters`, and the `.wav` + `.json` written here | the text's characters of the day's 5,000 (a repeat is free) |
| `lines` | A clip you have + its text → a line, with timings | one line build |
| `render_still` | The still PNG, written here | nothing |
| `preview_link` | A minimoji.com link that shows it in 3D | nothing |

`say` with `voice_source: "elevenlabs"` speaks on your own ElevenLabs account
instead, from `ELEVENLABS_API_KEY` in the server's environment (the `env`
of the client config), never a tool argument. Files are written to the
folder the client starts the server in (`~/Minimoji` when that is `/` or read-only, as Claude Desktop starts servers), or `minimoji mcp --out <dir>`. The
resources `minimoji://skill/web` and `minimoji://skill/swift` are the SDK
guides `minimoji skills` installs. `--base dev` serves another deployment.
Logs go to stderr; stdout is the protocol.

## Every command

- `--json`: one JSON object on stdout; an error is `{"error": "…"}`.
- Errors are one line on stderr and a non-zero exit.
- `--base prod|dev|<https://….convex.site>` (or `MINIMOJI_API`) picks the
  deployment; production is the default. `MINIMOJI_SITE` points `preview` at
  another copy of the website.
- `MINIMOJI_NO_BROWSER=1` never opens a browser.
