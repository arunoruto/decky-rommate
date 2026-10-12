import { ButtonItem, Field, PanelSection, PanelSectionRow, Spinner } from "@decky/ui";
import { useEffect, useState } from "react";
import { Game, Platform, Queue, download, downloadMany, getGames } from "../backend";
import { bytes } from "../format";

interface Props {
  platform: Platform;
  queue: Queue;
  onQueue: (q: Queue) => void;
  onBack: () => void;
  reloadKey: number;
}

export function Games({ platform, queue, onQueue, onBack, reloadKey }: Props) {
  const [games, setGames] = useState<Game[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getGames(platform.id).then((res) => {
      if (!alive) return;
      if (res.ok) setGames(res.data);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [platform.id, reloadKey]);

  const finished = new Set(queue.finished.map((f) => f.id));
  const queued = new Set(queue.pending.map((p) => p.id));
  const status = (g: Game) => {
    if (queue.current?.id === g.id) return "downloading";
    if (queued.has(g.id)) return "queued";
    if (g.installed || finished.has(g.id)) return "installed";
    return "missing";
  };
  const missing = games?.filter((g) => status(g) === "missing") ?? [];

  return (
    <PanelSection title={platform.name}>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onBack}>
          ← All platforms
        </ButtonItem>
      </PanelSectionRow>
      {missing.length > 0 && (
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={async () =>
              onQueue(await downloadMany(missing.map((g) => ({ id: g.id, name: g.name, size: g.size }))))
            }
          >
            Download {missing.length} missing
          </ButtonItem>
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <Field label="Could not load games" description={error} />
        </PanelSectionRow>
      )}
      {!games && !error && (
        <PanelSectionRow>
          <Spinner style={{ height: "28px" }} />
        </PanelSectionRow>
      )}
      {games?.map((g) => {
        const s = status(g);
        const label = { downloading: "↓", queued: "Queued", installed: "✓", missing: "Get" }[s];
        return (
          <PanelSectionRow key={g.id}>
            <ButtonItem
              layout="inline"
              label={g.name}
              description={bytes(g.size)}
              disabled={s !== "missing"}
              onClick={async () => onQueue(await download({ id: g.id, name: g.name, size: g.size }))}
            >
              {label}
            </ButtonItem>
          </PanelSectionRow>
        );
      })}
    </PanelSection>
  );
}
