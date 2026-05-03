# Unison

Bidirectional file sync between a local computer and a remote SSH server.

Unison must be installed on both machines. The local machine starts the sync, and
the remote machine only needs SSH access plus a compatible `unison` binary.

## Local Computer

Install Unison:

```bash
brew install unison
```

Confirm your local version:

```bash
unison -version
```

Confirm SSH can reach the server:

```bash
ssh <remote-host>
```

Create the local Unison config directory:

```bash
mkdir -p ~/.unison
```

Copy the profile template from this repo:

```bash
cp unison/dev-sync.prf ~/.unison/dev-sync.prf
```

Edit `~/.unison/dev-sync.prf` and replace:

- `<local-path>` with the local directory to sync.
- `<remote-host>` with the SSH host alias or `user@host`.
- `<remote-path>` with the absolute remote directory to sync.

Run the first sync interactively:

```bash
unison dev-sync
```

After reviewing the proposed changes, press `g` to apply them.

For later syncs:

```bash
unison dev-sync -auto
```

## Remote Server

Install Unison with the server package manager.

Ubuntu or Debian:

```bash
sudo apt-get update
sudo apt-get install unison
```

Fedora:

```bash
sudo dnf install unison
```

Arch:

```bash
sudo pacman -S unison
```

Confirm the remote version:

```bash
unison -version
```

The local and remote Unison versions should match closely. If sync fails with a
protocol or archive-version error, install the same Unison version on both
machines.

Create the remote sync directory if it does not exist:

```bash
mkdir -p <remote-path>
```

Make sure the SSH user can read and write that directory:

```bash
test -r <remote-path> && test -w <remote-path>
```

No Unison profile is required on the remote server for the SSH workflow above.
The local profile tells Unison which remote path to use.

## Notes

- Start with a small directory or a clean test folder before syncing important
  work.
- The template ignores common dependency, Python cache, packaging, and build
  outputs such as `.hatch`, `.venv`, `env`, `__pycache__`, `*.pyc`,
  `*.egg-info`, `node_modules`, `build`, `dist`, `out`, `logs`, and `target`.
- The template also ignores local editor metadata from Vim and JetBrains IDEs,
  including swap files, `.netrwhist`, `.idea`, and `*.iml`.
- If a file changed on both machines, Unison will ask you to choose which side
  wins.
- Unison is bidirectional. Use `rsync` instead if you only want one-way copying.
