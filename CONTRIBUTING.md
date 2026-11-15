# Contributing

Issues and pull requests are welcome.

This repository is an export. The CLI and the skills live in Minimoji's
private repository, and every change there that touches them replaces this
repository's tree in one commit ("export from minimoji@<commit>"). So a pull
request here is not merged as it is: we review it, apply it in the private
repository with you credited as co-author, and it comes back here with the
next export. Your pull request is closed with a link to that export commit.

Before you open one:

- `cd cli && node --test` passes (Node 20 or later, no install step);
- a change to a skill says what an agent got wrong without it.

A security problem: report it privately (Security → Report a vulnerability)
rather than in an issue.

## Contributing a character or a part

Prepare the contribution locally with `minimoji characters contribute`. It writes a folder you can
read end to end, and it uploads nothing and opens nothing:

```sh
minimoji characters contribute --kind character|part [--part <id>] --author "Your Name" \
  --license CC-BY-4.0 --evidence review --out dist/contribution
```

Open an issue that links the folder (a zip, or a repository of your own). Then we review it, apply it
to the canonical repository with you credited, and it arrives here with the next export. Don't open a
pull request that edits generated package files: the next export would overwrite it.

**Where accepted work lands** (in the canonical repository; the export carries it here):

- an original character: `packages/authoring/fixtures/characters/<name>/` (the source, as authored);
- a reusable part: `packages/authoring/fixtures/parts/<name>/` (the part's source and an example project
  that uses it);
- a prepared mesh: beside the part that places it, with its source file and provenance.

**What we check** (the bundle's README carries the same list):

- [ ] The rebuild (`characters unpack pack restored`, install, `pack`) gives the bundle's digests.
- [ ] The evidence matches a fresh render of that build. A character shows every variant from the front,
      three-quarter and profile, and neutral, happy, sad, angry, thinking and speaking. A part shows the
      head before and after, on every variant.
- [ ] `checks.json` is valid for the targets the contribution claims.
- [ ] The author and licence are stated. Reference media is either excluded or stated as licensed for
      redistribution. No partner concept, private reference, production asset or account id is included.
- [ ] A part composes cleanly into another project; a character reads at 48 px and 140 px.

Opening an issue, granting reuse rights and adding something to the official catalogue are separate,
explicit steps. Saving a character privately does none of them.
