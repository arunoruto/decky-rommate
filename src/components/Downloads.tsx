import { ButtonItem, Field, PanelSection, PanelSectionRow, ProgressBarWithInfo } from "@decky/ui";
import { Queue, cancel, dismiss, retry } from "../backend";
import { bytes, duration } from "../format";

// Steam-style download status: the running download with progress, how many
// are queued, and failed downloads with retry. Hidden when there is nothing.
export function Downloads({ queue, onQueue }: { queue: Queue; onQueue: (q: Queue) => void }) {
  const { current, pending, failed } = queue;
  if (!current && pending.length === 0 && failed.length === 0) return null;

  let progress = 0;
  let stats = "";
  let eta = "";
  if (current) {
    progress = current.total > 0 ? (current.done / current.total) * 100 : 0;
    stats = `${bytes(current.done)} / ${bytes(current.total)}`;
    if (current.speed > 0) {
      stats += ` · ${bytes(current.speed)}/s`;
      eta = duration((current.total - current.done) / current.speed);
    }
  }

  return (
    <PanelSection title="Downloads">
      {current && (
        <>
          <PanelSectionRow>
            <ProgressBarWithInfo
              label={current.name}
              nProgress={progress}
              sOperationText={stats}
              sTimeRemaining={eta}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={async () => onQueue(await cancel(current.id))}>
              Cancel (resumes next time)
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
      {pending.length > 0 && (
        <PanelSectionRow>
          <Field
            label={`${pending.length} queued`}
            description={pending.map((p) => p.name).join(", ")}
          />
        </PanelSectionRow>
      )}
      {failed.map((f) => (
        <PanelSectionRow key={f.id}>
          <ButtonItem
            layout="inline"
            label={`Failed: ${f.name}`}
            description={f.error}
            onClick={async () => onQueue(await retry(f.id))}
          >
            Retry
          </ButtonItem>
          <ButtonItem layout="below" onClick={async () => onQueue(await dismiss(f.id))}>
            Dismiss
          </ButtonItem>
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}
