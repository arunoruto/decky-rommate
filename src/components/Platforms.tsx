import { ButtonItem, Field, PanelSection, PanelSectionRow, Spinner } from "@decky/ui";
import { useEffect, useState } from "react";
import { Platform, getPlatforms } from "../backend";

export function Platforms({ onOpen, reloadKey }: { onOpen: (p: Platform) => void; reloadKey: number }) {
  const [platforms, setPlatforms] = useState<Platform[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getPlatforms().then((res) => {
      if (!alive) return;
      if (res.ok) setPlatforms(res.data);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, [reloadKey]);

  return (
    <PanelSection title="Library">
      {error && (
        <PanelSectionRow>
          <Field label="Could not load platforms" description={error} />
        </PanelSectionRow>
      )}
      {!platforms && !error && (
        <PanelSectionRow>
          <Spinner style={{ height: "28px" }} />
        </PanelSectionRow>
      )}
      {platforms?.map((p) => (
        <PanelSectionRow key={p.id}>
          <ButtonItem
            layout="inline"
            label={p.name}
            description={`${p.downloaded}/${p.games} on this device`}
            onClick={() => onOpen(p)}
          >
            {p.downloaded >= p.games ? "✓" : "Open"}
          </ButtonItem>
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}
