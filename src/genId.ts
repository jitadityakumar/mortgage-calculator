/**
 * crypto.randomUUID() only exists in secure contexts (HTTPS or localhost) —
 * it's undefined over plain HTTP on a LAN/Tailscale IP, so calling it there
 * throws. These ids are just local React keys/row identity, never sent to
 * the API, so a non-UUID fallback is fine.
 */
export function genId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
