---
name: md-review
description: >-
  Read and answer the review comments that a reviewer left on a rendered
  Markdown file in the dev-setup nginx viewer. Use when the user says
  "/md-review", "address the comments on <file>.md", "check the md
  comments", "respond to the review on the plan", or asks which documents
  have open comments. Lists the open comments with the current source lines,
  edits the document, then replies and resolves each comment with `mdreview`.
---

# md-review: answer review comments on Markdown

A reviewer selects text in a rendered `.md` page and leaves a comment. The
comments live outside the document, in a store that `mdreview` reads and
writes. The browser shows every reply and resolution on the next window focus.

## Run mdreview

Use the `mdreview` shell command when it exists. `dev/common.sh` defines it.
If the command is not found, run the script through this skill's own link:

```bash
MDREVIEW="python3 $(readlink -f ~/.claude/skills/md-review)/../../nginx/scripts/mdreview.py"
$MDREVIEW list
```

`--path` accepts a filesystem path or a webroot path such as
`/dev-setup/PLAN.md`. Pass the path that the user gives you.

## Procedure

1. If the user names no document, run `mdreview list`. It prints every
   document that has open comments.
2. Run `mdreview list --path <file> --json`. Read `comments[]`.
3. For each comment, read `body`, `anchor.selection`, and `resolved.text`.
   `resolved.text` is the current source at `resolved.line`-`resolved.endLine`.
4. Read the document around each line range before you decide.
5. List each comment with the edit or the answer you plan. Wait for the OK
   of the user.
6. Apply only the minimal edit that each comment asks for. Do not reformat
   other text.
7. After the edit, reply:
   `mdreview reply <id> --body "<what changed>" --author agent`.
8. Resolve:
   `mdreview resolve <id> --action fixed|answered|wontfix --author agent`.
9. Report the comments that you resolved and the comments that stay open.

`mdreview resolve <id> --action <a> --body "<text>" --author agent` replies
and resolves in one command.

## Choose the action

| The comment | Action | Edit the document? |
| :-- | :-- | :-- |
| finds a real problem | `fixed` | yes, then reply with what changed |
| asks a question | `answered` | no; the reply is the answer |
| rests on a wrong premise | `wontfix` | no; reply with the evidence |

## Rules

- Edit the document before you reply. Comment ids do not change after an
  edit, and the anchors follow the text.
- Put evidence in a `wontfix` reply: a file path and line, a command output,
  or a quote. The reviewer reads the reply, not your reasoning.
- Never delete a comment. Only the reviewer deletes comments.
- Never resolve a comment that you did not address. Leave it open and say why
  in your report.
- If `resolved.confidence` is `orphan`, the commented text is gone. Use
  `anchor.quote` to find what the reviewer meant, and ask the user when it is
  not clear.
- Pass `--author agent` on every reply and every resolve. Without it, the
  reply carries the login name of the user, and the reviewer cannot tell
  your replies from their own.

## Confidence values

| Value | Meaning |
| :-- | :-- |
| `exact` | the anchored lines still hold the commented text |
| `moved` | the same text sits at a new line range |
| `quote` | the block changed; the server found the quote in it |
| `orphan` | the commented text is gone from the document |
| `document` | a note on the whole document, with no line range |

## JSON shape

```json
{"ok": true, "path": "/dev-setup/nginx/README.md",
 "counts": {"open": 1, "resolved": 0, "orphan": 0},
 "comments": [{"id": "k3f9a2", "status": "open", "action": null,
   "author": "mattwen", "ts": "2026-09-24T20:31:07Z", "body": "This number is stale.",
   "anchor": {"line": 214, "endLine": 214, "quote": "Measured on a 105.8 MiB log", "selection": "105.8 MiB"},
   "resolved": {"confidence": "exact", "line": 214, "endLine": 214, "text": "Measured on a 105.8 MiB log"},
   "replies": []}]}
```

The format of the store is not a contract. Read comments only through
`mdreview`.
