# decky-rommate task runner. Run `just` to list recipes.

set shell := ["bash", "-euo", "pipefail", "-c"]

decky_cli_version := "0.0.8"

# List recipes
default:
    @just --list --unsorted

# Install frontend dependencies
install:
    pnpm install

# Build the frontend → dist/index.js
build: install
    pnpm run build

# Type-check the frontend and lint the Python backend
check: install
    pnpm run typecheck
    python3 -m py_compile main.py
    {{ if `command -v ruff || true` != "" { "ruff" } else { "nix run nixpkgs#ruff --" } }} check --select E,F,B,UP --ignore E501,UP041 --target-version py39 main.py

# Build the installable plugin zip with the Decky CLI (needs Docker) → out/rommate.zip
zip: build
    #!/usr/bin/env bash
    set -euo pipefail
    mkdir -p cli out
    if [ ! -x cli/decky ]; then
        case "$(uname -s)-$(uname -m)" in
            Linux-x86_64) asset=decky-linux-x86_64 ;;
            Linux-aarch64) asset=decky-linux-aarch64 ;;
            Darwin-arm64) asset=decky-macOS-aarch64 ;;
            Darwin-x86_64) asset=decky-macOS-x86_64 ;;
            *) echo "no decky CLI for $(uname -s)-$(uname -m)"; exit 1 ;;
        esac
        curl -fsSL -o cli/decky "https://github.com/SteamDeckHomebrew/cli/releases/download/{{ decky_cli_version }}/$asset"
        chmod +x cli/decky
    fi
    cli/decky plugin build -b -o out -s directory .
    ls -la out

# Copy the built plugin to a device (default: the Armada handheld) and restart Decky
deploy host="armada@armada.local": zip
    scp out/rommate.zip {{ host }}:/tmp/rommate.zip
    ssh -t {{ host }} 'sudo rm -rf ~/homebrew/plugins/rommate && sudo unzip -q -o /tmp/rommate.zip -d ~/homebrew/plugins && sudo systemctl restart plugin_loader'

# Remove build output
clean:
    rm -rf dist out
