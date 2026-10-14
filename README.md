# Minimoji Skills

Install the Minimoji Swift skill with:

```bash
npx skills add hypersocialinc/minimoji-skills --skill minimoji-swift
```

The skill integrates [MinimojiKit](https://www.minimoji.com/developers), the
Swift package for Minimoji 3D avatar heads. It needs a publishable API key
from [minimoji.com/developers](https://www.minimoji.com/developers) and
access to the MinimojiKit package.

What the skill is for:

- show a Minimoji head in a SwiftUI app, on Metal or RealityKit, and its 2D picture anywhere an image goes
- build previews on the device with the on-phone engine
- open the avatar editor, with a selfie that becomes a new face and AI edits from words
- cue a head gesture, read a mood from a line of text, lip-sync a head to live audio
- save avatars through your backend and show friends' heads by key

Example requests:

- "Add Minimoji to this app and show the user's avatar in the profile row"
- "Open the Minimoji editor from Settings with a selfie button"
- "Make the head do a double take when a reply lands"
- "Lip-sync the party heads to the call audio"

The skill is the one shipped inside the MinimojiKit package (`SKILL.md` at
its root) and is copied here on each Kit tag. The package README and release
notes are served at
[minimoji.com/developers/kit/README.md](https://www.minimoji.com/developers/kit/README.md)
and
[minimoji.com/developers/kit/RELEASE_NOTES.md](https://www.minimoji.com/developers/kit/RELEASE_NOTES.md).

Repository layout:

```text
skills/
  minimoji-swift/
    SKILL.md
```
