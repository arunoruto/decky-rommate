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
