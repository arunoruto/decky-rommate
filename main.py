"""Decky backend for rommate.

All real work is done by the bundled rommate binary (one per architecture, see
package.json → remote_binary). This module runs it with --json, keeps a small
download queue and forwards progress to the frontend as events.

rommate shares its configuration with the CLI and TUI
(~/.config/rommate/config.toml of the Decky user), so setting it up in one place
sets it up everywhere.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import platform
import shlex
import shutil
import signal
import subprocess
import time

import decky

# How many finished/failed downloads to remember for the UI.
HISTORY = 20

# Terminals that can host the TUI, with arguments for a full-screen window
# without any terminal chrome, running one command. Konsole ships with
# SteamOS and Armada; its profile tweaks only apply to this window.
KONSOLE_PROFILE = [
    "ScrollBarPosition=2",  # hidden
    "TerminalMargin=6",
    "TerminalCenter=true",
    "BellMode=3",  # no bell
    "BlinkingCursorEnabled=false",
    "Font=Monospace,15",
]
TERMINALS = [
    (
        "konsole",
        ["--fullscreen", "--hide-menubar", "--hide-toolbars", "--hide-tabbar", "--notransparency"]
        + [arg for prop in KONSOLE_PROFILE for arg in ("-p", prop)],
    ),
    ("foot", ["--fullscreen", "--font=monospace:size=15"]),
    ("alacritty", ["--option", "window.startup_mode='Fullscreen'", "--option", "font.size=15", "-e"]),
    ("kitty", ["--start-as=fullscreen", "-o", "font_size=15"]),
    ("xterm", ["-fullscreen", "-fa", "Monospace", "-fs", "15", "-e"]),
]

# A Konsole colour scheme with the TUI's background, so the margins around the
# text blend in. ANSI colours follow Breeze; the TUI itself uses true colour.
KONSOLE_SCHEME = """[General]
Description=rommate
Opacity=1

[Background]
Color=22,22,30
[BackgroundIntense]
Color=22,22,30
[BackgroundFaint]
Color=22,22,30
[Foreground]
Color=230,230,240
[ForegroundIntense]
Color=255,255,255
[ForegroundFaint]
Color=124,124,140
[Color0]
Color=35,38,39
[Color0Intense]
Color=127,140,141
[Color1]
Color=237,21,21
[Color1Intense]
Color=192,57,43
[Color2]
Color=17,209,22
[Color2Intense]
Color=28,220,154
[Color3]
Color=246,116,0
[Color3Intense]
Color=253,188,75
[Color4]
Color=29,153,243
[Color4Intense]
Color=61,174,233
[Color5]
Color=155,89,182
[Color5Intense]
Color=142,68,173
[Color6]
Color=26,188,156
[Color6Intense]
Color=22,160,133
[Color7]
Color=252,252,252
[Color7Intense]
Color=255,255,255
"""


def install_konsole_scheme() -> bool:
    """Write the rommate colour scheme for the Decky user. Returns whether it
    is available."""
    home = decky.DECKY_USER_HOME
    folder = os.path.join(home, ".local", "share", "konsole")
    path = os.path.join(folder, "rommate.colorscheme")
    try:
        os.makedirs(folder, exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(KONSOLE_SCHEME)
        if os.geteuid() == 0:
            # The loader may run as root; keep the user's files theirs.
            st = os.stat(home)
            for p in (os.path.join(home, ".local"), os.path.join(home, ".local", "share"), folder, path):
                os.chown(p, st.st_uid, st.st_gid)
        return True
    except OSError as e:
        decky.logger.warning("could not write Konsole colour scheme: %s", e)
        return False


class RommateError(Exception):
    """rommate exited with an error; the message is its stderr."""


ARCHES = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}

# The binary that works on this device, found once by binary_path().
_binary: str | None = None


def native_arch() -> str:
    """The CPU's real architecture.

    On ARM handhelds running Armada, Decky itself is an x86 program emulated by
    FEX, so platform.machine() reports x86_64 even though the CPU is ARM (and
    the x86 rommate binary crashes under FEX). FEX leaves two tells: its
    binfmt_misc registration and the real CPU in /proc/cpuinfo.
    """
    machine = ARCHES.get(platform.machine().lower(), "amd64")
    if machine == "arm64":
        return "arm64"
    if os.path.exists("/proc/sys/fs/binfmt_misc/FEX-x86_64"):
        return "arm64"
    try:
        with open("/proc/cpuinfo", encoding="utf-8", errors="replace") as f:
            cpuinfo = f.read(8192)
        if "CPU implementer" in cpuinfo or "Cortex-" in cpuinfo or "Oryon" in cpuinfo:
            return "arm64"
    except OSError:
        pass
    return machine


def binary_path() -> str:
    """Path of a rommate binary that runs here: the native one if it works,
    otherwise the other architecture."""
    global _binary
    if _binary:
        return _binary
    preferred = native_arch()
    order = [preferred] + [a for a in ("arm64", "amd64") if a != preferred]
    errors = []
    for arch in order:
        path = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", f"rommate-linux-{arch}")
        if not os.path.exists(path):
            errors.append(f"{arch}: missing")
            continue
        if not os.access(path, os.X_OK):
            os.chmod(path, 0o755)
        try:
            proc = subprocess.run([path, "version"], capture_output=True, timeout=15, env=rommate_env())
        except (OSError, subprocess.SubprocessError) as e:
            errors.append(f"{arch}: {e}")
            continue
        if proc.returncode == 0:
            decky.logger.info("using %s (%s)", path, proc.stdout.decode(errors="replace").strip())
            _binary = path
            return path
        errors.append(f"{arch}: exit {proc.returncode}")
    raise RommateError("no rommate binary runs on this device (" + "; ".join(errors) + ")")


def rommate_env() -> dict:
    """Run rommate as the Decky user would, so config and state are shared."""
    env = dict(os.environ)
    home = decky.DECKY_USER_HOME
    env["HOME"] = home
    env["XDG_CONFIG_HOME"] = os.path.join(home, ".config")
    env["XDG_STATE_HOME"] = os.path.join(home, ".local", "state")
    # The loader is a PyInstaller bundle; its library path is irrelevant to the
    # static rommate binary and can only confuse it.
    env.pop("LD_LIBRARY_PATH", None)
    return env


async def run(*args: str, timeout: float = 60) -> str:
    proc = await asyncio.create_subprocess_exec(
        binary_path(),
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=rommate_env(),
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RommateError(f"rommate {args[0]} timed out") from None
    if proc.returncode != 0:
        msg = err.decode(errors="replace").strip()
        raise RommateError(msg.removeprefix("rommate: ") or f"rommate {args[0]} failed")
    return out.decode(errors="replace")


async def run_json(*args: str, timeout: float = 60):
    return json.loads(await run(*args, "--json", timeout=timeout))


def ok(data=None) -> dict:
    return {"ok": True, "data": data}


def fail(err: Exception) -> dict:
    decky.logger.warning("rommate: %s", err)
    return {"ok": False, "error": str(err)}


def game_from_rom(rom: dict) -> dict:
    """Trim rommate's ROM JSON to what the frontend needs."""
    return {
        "id": rom["id"],
        "name": rom.get("name") or rom.get("fs_name") or f"#{rom['id']}",
        "file": rom.get("fs_name", ""),
        "size": rom.get("fs_size_bytes", 0),
        "installed": bool(rom.get("installed")),
        "path": rom.get("path", ""),
        "platform": rom.get("platform_slug", ""),
    }


class Plugin:
    # ── lifecycle ────────────────────────────────────────────────────────────

    async def _main(self):
        self.pending: list[dict] = []
        self.current: dict | None = None
        self.proc: asyncio.subprocess.Process | None = None
        self.cancelled = False
        self.failed: list[dict] = []
        self.finished: list[dict] = []
        self.wakeup = asyncio.Event()
        self.worker = asyncio.get_event_loop().create_task(self._worker())
        decky.logger.info("rommate plugin started (reported %s, native %s)", platform.machine(), native_arch())

    async def _unload(self):
        self.pending = []
        await self._stop_current()
        self.worker.cancel()

    async def _uninstall(self):
        pass

    # ── configuration ────────────────────────────────────────────────────────

    async def get_config(self) -> dict:
        try:
            return ok(await run_json("config"))
        except Exception as e:  # noqa: BLE001 - every failure goes to the UI
            return fail(e)

    async def setup(self, server: str, token: str, rom_dir: str = "", local_server: str = "") -> dict:
        args = ["init", "--server", server.strip()]
        if token.strip():
            args += ["--token", token.strip()]
        if local_server.strip():
            args += ["--local-server", local_server.strip()]
        if rom_dir.strip():
            args += ["--rom-dir", rom_dir.strip()]
        try:
            await run(*args, timeout=30)
            return ok(await run_json("config"))
        except Exception as e:  # noqa: BLE001
            return fail(e)

    # ── library ──────────────────────────────────────────────────────────────

    async def get_platforms(self) -> dict:
        try:
            platforms = await run_json("platforms")
            status = await run_json("status")
        except Exception as e:  # noqa: BLE001
            return fail(e)
        counts: dict[str, int] = {}
        for entry in status or []:
            slug = entry.get("platform_slug", "")
            if entry.get("present", True):
                counts[slug] = counts.get(slug, 0) + 1
        return ok(
            [
                {
                    "id": p["id"],
                    "slug": p["slug"],
                    "name": p.get("custom_name") or p["name"],
                    "games": p.get("rom_count", 0),
                    "downloaded": counts.get(p["slug"], 0),
                    "folder": p.get("folder", p["slug"]),
                }
                for p in platforms or []
            ]
        )

    async def get_games(self, platform_id: int) -> dict:
        try:
            roms = await run_json("roms", str(platform_id), timeout=120)
        except Exception as e:  # noqa: BLE001
            return fail(e)
        return ok([game_from_rom(r) for r in roms or []])

    async def remove_game(self, rom_id: int) -> dict:
        try:
            await run_json("remove", str(rom_id))
            return ok()
        except Exception as e:  # noqa: BLE001
            return fail(e)

    # ── launching the TUI ────────────────────────────────────────────────────

    async def get_launch(self) -> dict:
        """How to start the TUI from a Steam shortcut, plus the shortcut's app
        id if one was created before."""
        try:
            rommate = binary_path()
        except Exception as e:  # noqa: BLE001
            return fail(e)
        for name, args in TERMINALS:
            exe = shutil.which(name)
            if exe:
                if name == "konsole" and install_konsole_scheme():
                    args = [*args, "-p", "ColorScheme=rommate"]
                if name == "konsole":
                    args = [*args, "-e"]
                return ok(
                    {
                        "name": "rommate",
                        "exe": exe,
                        "start_dir": decky.DECKY_USER_HOME,
                        "launch_options": " ".join(shlex.quote(a) for a in [*args, rommate]),
                        "appid": self._settings().get("shortcut_appid"),
                    }
                )
        return fail(RommateError("no terminal found (install Konsole or another terminal)"))

    async def get_artwork(self) -> dict:
        """Steam artwork for the shortcut as base64 PNGs, and whether it was
        already applied to the current shortcut."""
        folder = os.path.join(decky.DECKY_PLUGIN_DIR, "artwork")
        out = {}
        try:
            for key in ("capsule", "wide_capsule", "hero", "logo"):
                with open(os.path.join(folder, key + ".png"), "rb") as f:
                    out[key] = base64.b64encode(f.read()).decode("ascii")
        except OSError as e:
            return fail(e)
        settings = self._settings()
        out["icon_path"] = os.path.join(folder, "icon.png")
        out["applied_to"] = settings.get("artwork_appid")
        return ok(out)

    async def set_artwork_applied(self, appid: int) -> dict:
        settings = self._settings()
        settings["artwork_appid"] = appid
        self._save_settings(settings)
        return ok()

    async def set_shortcut_appid(self, appid: int) -> dict:
        settings = self._settings()
        settings["shortcut_appid"] = appid
        self._save_settings(settings)
        return ok()

    def _settings_path(self) -> str:
        return os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")

    def _settings(self) -> dict:
        try:
            with open(self._settings_path(), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def _save_settings(self, settings: dict):
        os.makedirs(decky.DECKY_PLUGIN_SETTINGS_DIR, exist_ok=True)
        with open(self._settings_path(), "w", encoding="utf-8") as f:
            json.dump(settings, f)

    # ── download queue ───────────────────────────────────────────────────────

    async def get_queue(self) -> dict:
        return self._state()

    async def download(self, game: dict) -> dict:
        self._enqueue(game)
        await self._publish()
        return self._state()

    async def download_many(self, games: list[dict]) -> dict:
        for game in games:
            self._enqueue(game)
        await self._publish()
        return self._state()

    async def cancel(self, rom_id: int) -> dict:
        if self.current and self.current["id"] == rom_id:
            await self._stop_current()
        else:
            self.pending = [g for g in self.pending if g["id"] != rom_id]
        await self._publish()
        return self._state()

    async def retry(self, rom_id: int) -> dict:
        for item in self.failed:
            if item["id"] == rom_id:
                self.failed = [f for f in self.failed if f["id"] != rom_id]
                self._enqueue(item)
                break
        await self._publish()
        return self._state()

    async def dismiss(self, rom_id: int) -> dict:
        self.failed = [f for f in self.failed if f["id"] != rom_id]
        self.finished = [f for f in self.finished if f["id"] != rom_id]
        await self._publish()
        return self._state()

    # ── internals ────────────────────────────────────────────────────────────

    def _busy(self, rom_id: int) -> bool:
        if self.current and self.current["id"] == rom_id:
            return True
        return any(g["id"] == rom_id for g in self.pending)

    def _enqueue(self, game: dict):
        if self._busy(game["id"]):
            return
        self.failed = [f for f in self.failed if f["id"] != game["id"]]
        self.pending.append(
            {"id": game["id"], "name": game.get("name", ""), "size": game.get("size", 0)}
        )
        self.wakeup.set()

    def _state(self) -> dict:
        return {
            "current": self.current,
            "pending": self.pending,
            "failed": self.failed,
            "finished": self.finished,
        }

    async def _publish(self):
        await decky.emit("rommate_queue", self._state())

    async def _stop_current(self):
        if self.proc and self.proc.returncode is None:
            self.cancelled = True
            # rommate stops on SIGINT/SIGTERM and keeps the .part file, so the
            # next download of this game resumes.
            self.proc.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(self.proc.wait(), 10)
            except asyncio.TimeoutError:
                self.proc.kill()

    async def _worker(self):
        while True:
            if not self.pending:
                self.wakeup.clear()
                await self.wakeup.wait()
                continue
            game = self.pending.pop(0)
            await self._download(game)

    async def _download(self, game: dict):
        self.current = {**game, "done": 0, "total": game.get("size", 0), "speed": 0}
        self.cancelled = False
        await self._publish()
        error = ""
        started_at, started_bytes = time.monotonic(), None
        try:
            self.proc = await asyncio.create_subprocess_exec(
                binary_path(),
                "pull",
                str(game["id"]),
                "--json",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=rommate_env(),
            )
            assert self.proc.stdout is not None
            async for line in self.proc.stdout:
                try:
                    ev = json.loads(line)
                except json.JSONDecodeError:
                    continue
                kind = ev.get("event")
                if kind in ("start", "progress"):
                    done, total = ev.get("done", 0), ev.get("total", 0)
                    if started_bytes is None and kind == "progress":
                        # A resumed download starts above zero.
                        started_at, started_bytes = time.monotonic(), done
                    elapsed = time.monotonic() - started_at
                    speed = (done - (started_bytes or 0)) / elapsed if elapsed > 0.5 else 0
                    if total:
                        self.current["total"] = total
                    self.current.update(done=done, speed=speed, name=ev.get("name") or game["name"])
                    await self._publish()
                elif kind == "error":
                    error = ev.get("error", "")
            stderr = (await self.proc.stderr.read()).decode(errors="replace").strip() if self.proc.stderr else ""
            code = await self.proc.wait()
        except Exception as e:  # noqa: BLE001
            code, stderr, error = -1, "", str(e)
        finally:
            self.proc = None

        item = {"id": game["id"], "name": self.current["name"], "size": self.current["total"], "at": time.time()}
        self.current = None
        if self.cancelled:
            pass
        elif code == 0:
            self.finished = [item, *self.finished][:HISTORY]
            await decky.emit("rommate_done", item)
        else:
            item["error"] = error or stderr.removeprefix("rommate: ") or f"rommate exited with {code}"
            self.failed = [item, *self.failed][:HISTORY]
            await decky.emit("rommate_failed", item)
        await self._publish()
