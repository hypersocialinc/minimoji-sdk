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
