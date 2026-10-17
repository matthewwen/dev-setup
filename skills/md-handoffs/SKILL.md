---
name: md-handoffs
description: Keep handoff documents and plans visible in the dev-setup HTML viewer. Use when creating, updating, completing, archiving, or reactivating a handoff document, including plans in .claude/handoffs/.
---

# Markdown handoffs

Keep active handoffs linked under `$(html_path)/docs/`. Keep archived handoffs
linked under `$(html_path)/docs/old/`. These are viewer folders, separate from
the repository's `docs/` directory. Preserve the document's source location
and use symlinks rather than copies.

## Create or update

1. Write the handoff at the source location chosen for the task. Follow
   `dev-setup-style` for plan structure and placement when applicable.
2. Resolve its absolute path. In a worktree, preserve the shared
   `.claude/handoffs` directory; do not replace its symlink.
3. Use the existing `html_link` shell function to expose the document:

   ```zsh
   html_link "$handoff_path" docs/
   ```

   Run in the user's configured zsh environment. From a command runner, pass
   the absolute source path as a positional argument:

   ```sh
   zsh -ic 'html_link "$1" docs/' -- "$handoff_path"
   ```

4. If the destination already links to this document, leave it in place.
   `html_link` does not overwrite existing links. Inspect the destination
   before retrying. If a different document has the same basename, use an
   explicit destination such as `docs/<repo>-<filename>.md`. Never overwrite
   another document or a regular file.
5. Verify the viewer symlink resolves to the source. Include a clickable
   browser link in the response, using the configured viewer address and
   URL-encoding the path. In the default macOS setup this is
   `http://localhost:8080/docs/<filename>.md`.

Apply this workflow to each handoff created or updated during the task.
Do not publish unrelated existing documents as a side effect.

## Complete, archive, or reactivate

- Keep a handoff active until its work is complete or the user explicitly
  archives or abandons it. Inactivity alone does not archive a plan.
- When archiving, move the source to its archive location. For plans using
  `dev-setup-style`, this is `.claude/handoffs/old/`.
- Remove the active viewer symlink only after verifying it points to this
  document's previous source path. Never remove a regular file or another
  document's link. Then run `html_link "$archived_path" docs/old/` and verify
  the new link. Preserve any repository prefix used to avoid collisions.
- When reactivating, move the source back to its active location, remove only
  its verified archive symlink, and link it under `docs/` again.
- Report the resulting browser link and whether the handoff is active or
  archived. If linking fails, report the source path and failure; do not
  claim the document is available in the viewer.
