// Starts the rommate TUI as a Steam non-Steam shortcut (the same way Decky
// plugins start emulators): a terminal running the bundled rommate binary.
import { Navigation } from "@decky/ui";
import { getArtwork, getLaunch, setArtworkApplied, setShortcutAppid } from "./backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const SteamClient: any;
declare const appStore: any;
declare const appDetailsStore: any;

// Steam's custom artwork types.
const ASSET = { capsule: 0, hero: 1, logo: 2, wide_capsule: 3 } as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Gives the shortcut rommate's artwork once. Artwork the user picks later
// (e.g. with SteamGridDB) is never overwritten.
async function applyArtwork(appid: number) {
  const res = await getArtwork();
  if (!res.ok || res.data.applied_to === appid) return;
  const art = res.data;
  const apps = SteamClient.Apps;
  for (const key of ["capsule", "wide_capsule", "hero", "logo"] as const) {
    try {
      await apps.SetCustomArtworkForApp(appid, art[key], "png", ASSET[key]);
    } catch (e) {
      console.warn("rommate: could not set", key, e);
    }
  }
  // Shortcut logos stay blank until a logo position exists. The overview can
  // take a moment to appear after AddShortcut.
  for (let i = 0; i < 10; i++) {
    const overview = appStore?.GetAppOverviewByAppID(appid);
    if (overview) {
      try {
        await appDetailsStore?.SaveCustomLogoPosition(overview, {
          pinnedPosition: "BottomLeft",
          nWidthPct: 50,
          nHeightPct: 50,
        });
      } catch (e) {
        console.warn("rommate: could not set the logo position", e);
      }
      break;
    }
    await sleep(200);
  }
  try {
    apps.SetShortcutIcon?.(appid, art.icon_path);
  } catch (e) {
    console.warn("rommate: could not set the icon", e);
  }
  await setArtworkApplied(appid);
}

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

  try {
    await applyArtwork(appid);
  } catch (e) {
    console.warn("rommate: artwork failed", e);
  }

  Navigation.CloseSideMenus();
  apps.RunGame(gameId(appid), "", -1, 100);
  return null;
}
