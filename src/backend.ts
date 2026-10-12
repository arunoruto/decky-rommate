// Typed bridge to main.py. Every call returns { ok, data } or { ok: false, error }.
import { callable } from "@decky/api";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export interface Config {
  configured: boolean;
  problem?: string;
  config_path: string;
  server: string;
  local_server?: string;
  token_set: boolean;
  profile: string;
  rom_dir: string;
  hints: string;
}

export interface Platform {
  id: number;
  slug: string;
  name: string;
  games: number;
  downloaded: number;
  folder: string;
}

export interface Game {
  id: number;
  name: string;
  file: string;
  size: number;
  installed: boolean;
  path: string;
  platform: string;
}

export interface QueueItem {
  id: number;
  name: string;
  size: number;
  at?: number;
  error?: string;
}

export interface CurrentDownload extends QueueItem {
  done: number;
  total: number;
  speed: number;
}

export interface Queue {
  current: CurrentDownload | null;
  pending: QueueItem[];
  failed: QueueItem[];
  finished: QueueItem[];
}

export interface Launch {
  name: string;
  exe: string;
  start_dir: string;
  launch_options: string;
  appid: number | null;
}

export interface Artwork {
  capsule: string;
  wide_capsule: string;
  hero: string;
  logo: string;
  icon_path: string;
  applied_to: number | null;
}

export const getArtwork = callable<[], Result<Artwork>>("get_artwork");
export const setArtworkApplied = callable<[appid: number], Result<null>>("set_artwork_applied");
export const getLaunch = callable<[], Result<Launch>>("get_launch");
export const setShortcutAppid = callable<[appid: number], Result<null>>("set_shortcut_appid");
export const getConfig = callable<[], Result<Config>>("get_config");
export const setup = callable<
  [server: string, token: string, romDir: string, localServer: string],
  Result<Config>
>("setup");
export const getPlatforms = callable<[], Result<Platform[]>>("get_platforms");
export const getGames = callable<[platformId: number], Result<Game[]>>("get_games");
export const removeGame = callable<[romId: number], Result<null>>("remove_game");
export const getQueue = callable<[], Queue>("get_queue");
export const download = callable<[game: QueueItem], Queue>("download");
export const downloadMany = callable<[games: QueueItem[]], Queue>("download_many");
export const cancel = callable<[romId: number], Queue>("cancel");
export const retry = callable<[romId: number], Queue>("retry");
export const dismiss = callable<[romId: number], Queue>("dismiss");

export const QUEUE_EVENT = "rommate_queue";
export const DONE_EVENT = "rommate_done";
export const FAILED_EVENT = "rommate_failed";

export interface SaveStatus {
  rom_id: number;
  name: string;
  platform: string;
  emulator?: string;
  path?: string; // empty: no local save yet
  conflict: boolean;
  problem?: string;
  synced_at?: string;
  server_updated_at?: string;
}

export interface SaveSyncResult {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  in_sync: number;
  failed: number;
}

export interface SaveSync {
  at: number; // unix seconds
  reason: "manual" | "game_exit";
  result: SaveSyncResult | null; // null: the sync did not run, see error
  conflicts: { rom_id: number; name: string }[];
  errors: { name: string; detail: string }[];
  error: string;
}

export interface SaveState {
  syncing: boolean;
  last: SaveSync | null;
  sync_on_exit: boolean;
}

export interface Saves extends SaveState {
  games: SaveStatus[];
}

export const getSaves = callable<[], Result<Saves>>("get_saves");
export const syncSaves = callable<[reason: string], Result<SaveState>>("sync_saves");
export const onGameExit = callable<[appid: number], Result<SaveState | null>>("on_game_exit");
export const setSyncOnExit = callable<[enabled: boolean], Result<SaveState>>("set_sync_on_exit");
export const resolveSave = callable<[romId: number, keep: "local" | "server"], Result<Saves>>("resolve_save");

export const SAVES_EVENT = "rommate_saves";
