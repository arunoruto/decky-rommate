import { ButtonItem, Field, PanelSection, PanelSectionRow, Spinner, staticClasses } from "@decky/ui";
import { addEventListener, definePlugin, removeEventListener, toaster } from "@decky/api";
import { launchRommate } from "./launch";
import { useEffect, useState } from "react";
import {
  Config,
  DONE_EVENT,
  FAILED_EVENT,
  Platform,
  QUEUE_EVENT,
  Queue,
  QueueItem,
  getConfig,
  getQueue,
  onGameExit,
} from "./backend";
import { Downloads } from "./components/Downloads";
import { Games } from "./components/Games";
import { RommateIcon } from "./components/Icon";
import { Platforms } from "./components/Platforms";
import { Saves, toastAutoSync } from "./components/Saves";
import { Setup } from "./components/Setup";

const EMPTY_QUEUE: Queue = { current: null, pending: [], failed: [], finished: [] };

type View = { kind: "library" } | { kind: "games"; platform: Platform } | { kind: "setup" };

function Content() {
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState("");
  const [view, setView] = useState<View>({ kind: "library" });
  const [queue, setQueue] = useState<Queue>(EMPTY_QUEUE);
  // Bumped when a download finishes so lists refresh their ✓ marks and counts.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    getConfig().then((res) => {
      if (res.ok) setConfig(res.data);
      else setConfigError(res.error);
    });
    getQueue().then(setQueue);
    const onQueue = addEventListener<[Queue]>(QUEUE_EVENT, setQueue);
    const onDone = addEventListener<[QueueItem]>(DONE_EVENT, () => setReloadKey((k) => k + 1));
    return () => {
      removeEventListener(QUEUE_EVENT, onQueue);
      removeEventListener(DONE_EVENT, onDone);
    };
  }, []);

  if (configError) {
    return (
      <PanelSection title="rommate">
        <PanelSectionRow>
          <Field label="rommate could not start" description={configError} />
        </PanelSectionRow>
      </PanelSection>
    );
  }
  if (!config) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <Spinner style={{ height: "28px" }} />
        </PanelSectionRow>
      </PanelSection>
    );
  }
  if (!config.configured || view.kind === "setup") {
    return (
      <Setup
        config={config}
        onDone={(c) => {
          setConfig(c);
          setView({ kind: "library" });
          setReloadKey((k) => k + 1);
        }}
      />
    );
  }

  const openTui = async () => {
    const error = await launchRommate();
    if (error) toaster.toast({ title: "rommate could not open", body: error });
  };

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={openTui}>
            Open rommate
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
      <Downloads queue={queue} onQueue={setQueue} />
      <Saves reloadKey={reloadKey} />
      {view.kind === "games" ? (
        <Games
          platform={view.platform}
          queue={queue}
          onQueue={setQueue}
          onBack={() => setView({ kind: "library" })}
          reloadKey={reloadKey}
        />
      ) : (
        <Platforms onOpen={(platform) => setView({ kind: "games", platform })} reloadKey={reloadKey} />
      )}
      <PanelSection title="Server">
        <PanelSectionRow>
          <Field
            label={config.server}
            description={
              config.local_server
                ? `At home: ${config.local_server} · games go to ${config.rom_dir}`
                : `Games go to ${config.rom_dir}`
            }
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setView({ kind: "setup" })}>
            Change server
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  // Toasts are registered globally so they show even when the panel is closed.
  const onDone = addEventListener<[QueueItem]>(DONE_EVENT, (item) =>
    toaster.toast({ title: "rommate", body: `Downloaded ${item.name}` }),
  );
  const onFailed = addEventListener<[QueueItem]>(FAILED_EVENT, (item) =>
    toaster.toast({ title: "rommate: download failed", body: `${item.name}: ${item.error ?? ""}` }),
  );

  // Sync saves whenever a game closes; the backend skips rommate itself and
  // honours the "Sync when a game closes" switch.
  const lifetime = SteamClient.GameSessions.RegisterForAppLifetimeNotifications((n) => {
    if (n.bRunning) return;
    onGameExit(n.unAppID).then((res) => {
      if (res.ok) toastAutoSync(res.data);
    });
  });

  return {
    name: "rommate",
    titleView: (
      <div className={staticClasses.Title} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <RommateIcon size={20} />
        rommate
      </div>
    ),
    content: <Content />,
    icon: <RommateIcon />,
    onDismount() {
      removeEventListener(DONE_EVENT, onDone);
      removeEventListener(FAILED_EVENT, onFailed);
      lifetime.unregister();
    },
  };
});
