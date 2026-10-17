---
name: dev-setup-style
description: Style contract for commits, comments, tests, and design documents. Use when the user types /dev-setup-style, before you write a commit message, add a comment or docstring, add tests, or write a design or plan document. Also use when the user asks how a commit, test, or design doc must look.
argument-hint: [target-path]
allowed-tools: Read Glob Grep
---

# Dev setup style

## On invocation

1. Reply with a short ack: two lists with exact paths, files you will
   create and files you will edit. Apply the "Code" rules when the task
   changes code. Apply the "Design documents" rules when the task writes a
   document. Both rule sets always apply; the task decides which one is
   exercised.
2. If the user did not give a path, ask for it before you create the file.
   Use the defaults in "File placement" only when the user says "default".
3. Do not take file locations from memory. This file is the source of truth.

## Code

### Commits

- Every commit subject must use `type(scope): description`. Both type and scope
  are required. Use lowercase throughout the subject.
- The description must give a general overview of the change in the imperative.
  Keep the entire subject, including the prefix, at most 60 characters.
- Prefer an overview with up to 3 bullet points summarizing the main changes,
  or use the overview alone when it captures the change clearly.
- Do not list every changed file or function. The diff shows that.
- Good:
  ```text
  fix(viewer): improve prompt copying and markdown checkboxes

  - Keep editor wrapping out of copied prompts
  - Render standalone and empty Markdown checkboxes
  ```
- Bad: a subject plus a bullet list of six changes.

### Comments and docstrings

- Do not add docstrings or comments. If the code needs a comment to be
  understood, rename or split the code instead.
- One exception: a non-obvious invariant or a workaround for an external
  bug. One line. State the constraint, not what the code does.

### Tests

- Test edge cases only: boundaries, empty input, error paths, ordering,
  concurrency, and the exact bug that motivated the change.
- Do not test the happy path when a type check or an edge-case test already
  exercises it.
- One test per edge case. No parametrized sweep over inputs that differ
  trivially.
- Before you add a test, name the edge case it protects. If you cannot,
  do not add it.

### Implementation order

- Build the bare minimum first. It must run end to end on the main path,
  and nothing more.
- Add refinements only after the minimum works: error paths, defaults,
  limits, hardening, cleanup.
- Do not ask for a refinement, and do not block a step or a gate on one,
  while the minimum is in progress. The minimum can change the design fast.
- Write each refinement that you notice in a backlog list in the plan.
  Tell the user it is there. Then continue with the minimum.

### Layout

- Brace every `if`, `else if`, and `else` body, even a single statement.
- Keep the diff minimal. Do not reformat, reorder, or re-indent code that
  the task does not touch.

## Design documents

Use these five sections, in this order, and no other top-level sections.
Write in ASD-STE100 Simplified Technical English: sentences under 20 words,
active voice, imperative steps, no "should", "may", or "might".

### 1. Objective

One to three sentences. State what this document decides. A reader who
skims several documents must get the point from this section alone.

### 2. Problem statement

The repeated problems this design removes. Write them as functional
requirements, numbered `P1`, `P2`, ... in the form "The system must ...".
Each problem is one sentence plus, if needed, one sentence of evidence.

### 3. Proposed solution

What is built and how it satisfies each problem. Reference the problem
numbers explicitly: "P1 is solved by ...". List rejected alternatives in
one short bullet list only when the reader would otherwise ask.

### 4. Dataclasses and dataflow

- New or changed types, with every field and its type.
- Dataflow as a numbered sequence or a mermaid diagram.
- **New files.** One table row per file that does not exist today. Give the
  exact repo-relative path, including the file name and extension. No
  globs, no `...`, no "a helper module". State what the file owns and
  which existing file imports or calls it.

  | New file | Owns | Called from |
  |---|---|---|
  | `nginx/scripts/review_index.py` | index build for review comments | `nginx/scripts/review_store.py` |
  | `nginx/src/review/Panel.tsx` | comment side panel | `nginx/src/app/App.tsx` |

- **Modified files.** A second table for files that exist today, with the
  exact path and the one change made to each.

  | Modified file | Change |
  |---|---|
  | `nginx/src/app/App.tsx` | mount `Panel` under the viewer |

- If a file path is not yet decided, say so and ask. Do not guess a path.

### 5. Implementation plan

Split the solution into chunks the user approves one at a time. Each chunk
fits in one pull request. The first chunk is the bare minimum that runs end
to end. Later chunks add refinements. For each chunk give:

- Name and the problems it closes (`P1`, `P3`).
- Files created, by exact path.
- Files modified, by exact path.
- Done criterion.
- The check the user runs to confirm it.

Stop after each chunk and wait for the go-ahead before you start the next.

### Document rules

- Target under two pages. The problem statement carries the motivation;
  do not repeat it elsewhere.
- Prefer a table over prose for files, fields, and chunks.
- Put appendices, measurements, and logs below the plan only when asked.

## File placement

Ask when the user gives no path. Defaults when the user says "default":

| Kind | Default path |
|---|---|
| Design doc or plan | `<repo>/.claude/handoffs/PLAN-<kebab-topic>.md` |
| Finished plan | `<repo>/.claude/handoffs/old/` |
| Repo skill | `<repo>/skills/<name>/SKILL.md` |
| Repo docs | `<repo>/docs/<kebab-topic>.md` |

In a worktree, `.claude/handoffs` is a symlink to the main checkout. Write
there. Do not copy the file.

For each handoff created or updated, follow
[md-handoffs](../md-handoffs/SKILL.md) to run `html_link` into the viewer's
`docs/` folder. Move its viewer link to `docs/old/` when archiving the handoff.
