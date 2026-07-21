/**
 * All monetary values inside the engine are handled as integer pence to avoid
 * floating point drift compounding across hundreds of amortization periods.
 * UI-facing inputs/outputs use pounds (regular numbers); conversion happens
 * only at the boundary.
 */

export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100);
}

export function penceToPounds(pence: number): number {
  return pence / 100;
}
