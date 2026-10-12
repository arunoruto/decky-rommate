# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` is a symlink to this file.

## What this is

A [Decky Loader](https://decky.xyz) plugin for [rommate](https://github.com/arunoruto/rommate), the RomM sync tool.
The plugin is a thin UI: the frontend (`src/`, React + `@decky/ui`) calls the Python backend (`main.py`), which runs
the bundled `rommate` binary with `--json`. **Do not reimplement rommate logic here** (folder mapping, downloads,
config); add it to rommate and expose it through its CLI instead.

## Development environment

**If `nix` is available, always work inside the dev shell**: `github:arunoruto/flake#node-lsp` (Node.js LTS, pnpm,
just, TypeScript language servers). With direnv it is loaded by `.envrc`; otherwise prefix commands:

```sh
nix develop github:arunoruto/flake#node-lsp -c just check
```

`nix develop <flake> -c <command>` runs one program (like `devenv shell -- <command>`); wrap shell syntax in
`bash -c '…'`.

## Commands

```sh
just build    # frontend → dist/index.js
just check    # tsc --noEmit + python compile + ruff: run before every commit
just zip      # installable plugin zip via the Decky CLI (needs Docker)
just deploy   # copy to a device and restart Decky
```

## Conventions

- **Universal plugin.** `package.json` → `remote_binary` pins one rommate release for linux-amd64 *and* linux-arm64;
  `main.py` picks the binary by `platform.machine()`. When bumping rommate, update both URLs and `sha256hash` values
  from that release's `checksums.txt`, and the README if behaviour changes.
- **Backend calls return `{ok, data}` or `{ok: false, error}`**; never let exceptions escape to the frontend. Long
  work runs in the backend's queue and reports through `decky.emit` events (`rommate_queue`, `rommate_done`,
  `rommate_failed`).
- **Never send the RomM token to the frontend.** `rommate config --json` only reports whether it is set.
- **Python must run on the loader's interpreter**: keep `from __future__ import annotations`, stdlib only, and target
  Python 3.9 syntax (ruff runs with `--target-version py39`).
- **Controller first.** Everything in the panel must work with the D-pad and A/B; text fields are fine because Decky
  opens Steam's on-screen keyboard.
- Bump `version` in `package.json` for every release (the Decky store and the Release workflow read it).
- Commits follow [Conventional Commits](https://www.conventionalcommits.org).
