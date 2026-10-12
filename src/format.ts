const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"];

/** Formats a byte count like rommate does: 1.5 GiB, 40 KiB. */
export function bytes(n: number): string {
  let i = 0;
  while (n >= 1024 && i < UNITS.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${UNITS[i]}`;
}

/** Formats seconds as 1h 2m, 3m 4s or 5s. */
export function duration(s: number): string {
  s = Math.round(s);
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

/** Formats how long ago a moment was: just now, 5m ago, 2h ago, 3d ago. */
export function ago(when: Date | number): string {
  const ms = typeof when === "number" ? when * 1000 : when.getTime();
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Summarises a save sync result like the TUI: "1 uploaded · 2 in sync". */
export function syncSummary(r: {
  uploaded: number;
  downloaded: number;
  conflicts: number;
  in_sync: number;
  failed: number;
}): string {
  const parts: string[] = [];
  if (r.uploaded) parts.push(`${r.uploaded} uploaded`);
  if (r.downloaded) parts.push(`${r.downloaded} downloaded`);
  if (r.conflicts) parts.push(r.conflicts === 1 ? "1 conflict" : `${r.conflicts} conflicts`);
  if (r.failed) parts.push(`${r.failed} failed`);
  if (r.in_sync) parts.push(`${r.in_sync} in sync`);
  return parts.join(" · ") || "no saves yet";
}
