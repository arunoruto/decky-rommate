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
import json
import os
import platform
import signal
import time

import decky

# How many finished/failed downloads to remember for the UI.
HISTORY = 20

ARCHES = {"x86_64": "amd64", "amd64": "amd64", "aarch64": "arm64", "arm64": "arm64"}


class RommateError(Exception):
    """rommate exited with an error; the message is its stderr."""


def binary_path() -> str:
    arch = ARCHES.get(platform.machine().lower())
    if arch is None:
        raise RommateError(f"unsupported CPU architecture: {platform.machine()}")
    path = os.path.join(decky.DECKY_PLUGIN_DIR, "bin", f"rommate-linux-{arch}")
    if not os.path.exists(path):
        raise RommateError(f"rommate binary missing: {path}")
    if not os.access(path, os.X_OK):
        os.chmod(path, 0o755)
    return path


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
        decky.logger.info("rommate plugin started (%s)", platform.machine())

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
