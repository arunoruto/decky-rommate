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
