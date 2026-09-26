// Non-security identifiers for local records (history rows, alerts, members).
// Anything security-relevant (request ids, nonces, keys) comes from the service layer.
let counter = 0;

export function uid(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, "0")}${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
