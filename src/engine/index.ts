// Only src/engine/sdlt.ts remains here — mortgage amortization now lives
// entirely in the backend (backend/app/engine/), see src/api/client.ts.
// SDLT is a stateless, self-contained tax-band calculator with no shared
// state with the mortgage engine, so it isn't part of the
// single-source-of-truth concern the migration addressed and stays
// client-side; there's no backend SDLT endpoint.
export { calculateSdlt } from './sdlt';
export type { SdltResult, SdltBandBreakdown } from './sdlt';
