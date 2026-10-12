import { ButtonItem, Field, PanelSection, PanelSectionRow, TextField } from "@decky/ui";
import { useState } from "react";
import { Config, setup } from "../backend";

// First-time setup (or changing the server). The token never comes back from
// the backend; leave it empty to keep the saved one.
export function Setup({ config, onDone }: { config: Config | null; onDone: (c: Config) => void }) {
  const [server, setServer] = useState(config?.server ?? "");
  const [token, setToken] = useState("");
  const [romDir, setRomDir] = useState("");
  const [localServer, setLocalServer] = useState(config?.local_server ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    const res = await setup(server, token, romDir, localServer);
    setBusy(false);
    if (res.ok) onDone(res.data);
    else setError(res.error);
  };

  return (
    <PanelSection title="Connect to RomM">
      <PanelSectionRow>
        <Field
          label="Create a Client API Token in RomM under Administration → Client API Tokens."
          bottomSeparator="none"
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Server"
          description="e.g. https://romm.example.com"
          value={server}
          onChange={(e) => setServer(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="API token"
          description={config?.token_set ? "Leave empty to keep the saved token" : "Starts with rmm_"}
          bIsPassword
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Local address (optional)"
          description="Used at home when it answers, e.g. http://romm.local:8080"
          value={localServer}
          onChange={(e) => setLocalServer(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="ROM folder (optional)"
          description={config?.rom_dir ? `Default: ${config.rom_dir}` : "Default: from ES-DE"}
          value={romDir}
          onChange={(e) => setRomDir(e.target.value)}
        />
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <Field label="Could not connect" description={error} />
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy || !server || (!token && !config?.token_set)}
          onClick={connect}
        >
          {busy ? "Connecting…" : "Connect"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}
