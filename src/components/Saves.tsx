import {
  ButtonItem,
  ConfirmModal,
  Field,
  PanelSection,
  PanelSectionRow,
  ToggleField,
  showModal,
} from "@decky/ui";
import { addEventListener, removeEventListener, toaster } from "@decky/api";
import { useEffect, useState } from "react";
import {
  SAVES_EVENT,
  SaveState,
  SaveStatus,
  Saves as SavesData,
  getSaves,
  resolveSave,
  setSyncOnExit,
  syncSaves,
} from "../backend";
import { ago, syncSummary } from "../format";

// Save sync: conflicts to settle, a sync button, the last sync and the
// sync-on-exit switch. Conflicts come first because they need a decision.
export function Saves({ reloadKey }: { reloadKey: number }) {
  const [saves, setSaves] = useState<SavesData | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    const res = await getSaves();
    if (res.ok) {
      setSaves(res.data);
      setError("");
    } else setError(res.error);
  };

  useEffect(() => {
    load();
    // A sync started elsewhere (a game closing) updates the panel live, and
    // reloads the games when it ends so new conflicts show up.
    const onSaves = addEventListener<[SaveState]>(SAVES_EVENT, (state) => {
      setSaves((s) => (s ? { ...s, ...state } : s));
      if (!state.syncing) load();
    });
    return () => {
      removeEventListener(SAVES_EVENT, onSaves);
    };
  }, [reloadKey]);

  if (error) {
    return (
      <PanelSection title="Saves">
        <PanelSectionRow>
          <Field label="Could not read saves" description={error} />
        </PanelSectionRow>
      </PanelSection>
    );
  }
  if (!saves) return null;

  const conflicts = saves.games.filter((g) => g.conflict);
  const withSave = saves.games.filter((g) => g.path).length;

  const sync = async () => {
    setSaves({ ...saves, syncing: true });
    const res = await syncSaves("manual");
    if (!res.ok) toaster.toast({ title: "rommate: save sync failed", body: res.error });
    await load();
  };

  const resolve = (game: SaveStatus, keep: "local" | "server") => {
    const other = keep === "local" ? "RomM's save" : "this device's save";
    showModal(
      <ConfirmModal
        strTitle={keep === "local" ? "Keep this device's save?" : "Keep RomM's save?"}
        strDescription={`${game.name}: ${other} is replaced. The replaced version stays available as a backup.`}
        strOKButtonText={keep === "local" ? "Keep this device's" : "Keep RomM's"}
        onOK={async () => {
          const res = await resolveSave(game.rom_id, keep);
          if (res.ok) setSaves(res.data);
          else toaster.toast({ title: `rommate: could not resolve ${game.name}`, body: res.error });
        }}
      />,
    );
  };

  return (
    <PanelSection title="Saves">
      {conflicts.map((g) => (
        <PanelSectionRow key={g.rom_id}>
          <Field
            label={`Conflict: ${g.name}`}
            description={
              "Changed on this device and on RomM" +
              (g.server_updated_at ? ` (RomM ${ago(new Date(g.server_updated_at))})` : "") +
              ". Which save do you want to keep?"
            }
          />
          <ButtonItem layout="below" onClick={() => resolve(g, "local")}>
            Keep this device's save
          </ButtonItem>
          <ButtonItem layout="below" onClick={() => resolve(g, "server")}>
            Keep RomM's save
          </ButtonItem>
        </PanelSectionRow>
      ))}
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={sync} disabled={saves.syncing}>
          {saves.syncing ? "Syncing saves…" : "Sync saves"}
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <Field label={lastSyncLabel(saves)} description={`${withSave} of ${saves.games.length} games have a save`} />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Sync when a game closes"
          checked={saves.sync_on_exit}
          onChange={async (on) => {
            const res = await setSyncOnExit(on);
            if (res.ok) setSaves({ ...saves, ...res.data });
          }}
        />
      </PanelSectionRow>
    </PanelSection>
  );
}

function lastSyncLabel(s: SaveState): string {
  if (s.syncing) return "Syncing…";
  const last = s.last;
  if (!last) return "Not synced yet";
  if (!last.result) return `Last sync failed ${ago(last.at)}`;
  return `Synced ${ago(last.at)}: ${syncSummary(last.result)}`;
}

/** Toast after an automatic sync, only when something happened: changes,
 * conflicts or a failure. A sync with nothing to do stays silent. */
export function toastAutoSync(state: SaveState | null) {
  const last = state?.last;
  if (!last) return;
  if (!last.result) {
    toaster.toast({ title: "rommate: saves not synced", body: `${last.error}. They sync next time.` });
    return;
  }
  const r = last.result;
  if (last.conflicts.length > 0) {
    toaster.toast({
      title: "rommate: save conflict",
      body: `${last.conflicts.map((c) => c.name).join(", ")}: choose which save to keep in rommate.`,
    });
  } else if (r.failed > 0) {
    toaster.toast({
      title: "rommate: some saves failed",
      body: last.errors.map((e) => `${e.name}: ${e.detail}`).join("; "),
    });
  } else if (r.uploaded || r.downloaded) {
    toaster.toast({ title: "rommate", body: `Saves synced: ${syncSummary({ ...r, in_sync: 0 })}` });
  }
}
