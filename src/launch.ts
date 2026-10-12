// Starts the rommate TUI as a Steam non-Steam shortcut (the same way Decky
// plugins start emulators): a terminal running the bundled rommate binary.
import { Navigation } from "@decky/ui";
import { getLaunch, setShortcutAppid } from "./backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const SteamClient: any;
declare const appStore: any;

// Non-Steam shortcuts launch by 64-bit game id: (appid << 32) | 0x02000000.
function gameId(appid: number): string {
  return ((BigInt(appid >>> 0) << 32n) | 0x02000000n).toString();
}

function shortcutExists(appid: number): boolean {
  try {
    return Boolean(appStore?.GetAppOverviewByAppID(appid));
  } catch {
    return false;
  }
}

export async function launchRommate(): Promise<string | null> {
  const res = await getLaunch();
  if (!res.ok) return res.error;
  const { name, exe, start_dir, launch_options } = res.data;
  const apps = SteamClient?.Apps;
  if (!apps?.AddShortcut || !apps?.RunGame) return "Steam's shortcut API is not available";

  let appid = res.data.appid;
  if (appid && shortcutExists(appid)) {
    // Keep the shortcut current, e.g. after the plugin moved or a new terminal.
    apps.SetShortcutExe?.(appid, `"${exe}"`);
    apps.SetShortcutStartDir?.(appid, `"${start_dir}"`);
    apps.SetShortcutLaunchOptions?.(appid, launch_options);
  } else {
    appid = Number(await apps.AddShortcut(name, exe, start_dir, launch_options));
    if (!appid) return "Steam did not create the shortcut";
    // New shortcuts are named after the executable; set the real name.
    apps.SetShortcutName?.(appid, name);
    apps.SetShortcutLaunchOptions?.(appid, launch_options);
    await setShortcutAppid(appid);
  }

  Navigation.CloseSideMenus();
  apps.RunGame(gameId(appid), "", -1, 100);
  return null;
}
