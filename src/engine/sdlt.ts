/**
 * Stamp Duty Land Tax (England & Northern Ireland only — Scotland/Wales use
 * different taxes/bands). This is a one-off purchase cost, entirely separate
 * from the mortgage repayment math: it does not affect the loan principal or
 * amortization schedule. It's offered as a side-calculation so users can see
 * the real total cash needed at completion (property price + SDLT − deposit).
 *
 * Rates current as of 1 April 2025 (unchanged into 2026). Verify against
 * https://www.gov.uk/stamp-duty-land-tax/residential-property-rates before
 * relying on this for a real transaction — bands are subject to change.
 */

export interface SdltBandBreakdown {
  bandLabel: string;
  ratePct: number;
  taxableAmount: number;
  tax: number;
}

export interface SdltResult {
  totalTax: number;
  breakdown: SdltBandBreakdown[];
}

interface Band {
  upTo: number | null;
  ratePct: number;
  label: string;
}

const STANDARD_BANDS: Band[] = [
  { upTo: 125_000, ratePct: 0, label: 'Up to £125,000' },
  { upTo: 250_000, ratePct: 2, label: '£125,001–£250,000' },
  { upTo: 925_000, ratePct: 5, label: '£250,001–£925,000' },
  { upTo: 1_500_000, ratePct: 10, label: '£925,001–£1.5m' },
  { upTo: null, ratePct: 12, label: 'Above £1.5m' },
];

const FIRST_TIME_BUYER_BANDS: Band[] = [
  { upTo: 300_000, ratePct: 0, label: 'Up to £300,000' },
  { upTo: 500_000, ratePct: 5, label: '£300,001–£500,000' },
];

function applyBands(propertyValue: number, bands: Band[]): SdltResult {
  const breakdown: SdltBandBreakdown[] = [];
  let remaining = propertyValue;
  let lowerBound = 0;
  let totalTax = 0;

  for (const band of bands) {
    if (remaining <= 0) break;
    const bandCeiling = band.upTo ?? Infinity;
    const bandSize = bandCeiling - lowerBound;
    const taxableAmount = Math.min(remaining, bandSize);
    if (taxableAmount > 0) {
      const tax = Math.round(taxableAmount * (band.ratePct / 100));
      breakdown.push({ bandLabel: band.label, ratePct: band.ratePct, taxableAmount, tax });
      totalTax += tax;
      remaining -= taxableAmount;
    }
    lowerBound = bandCeiling;
  }

  return { totalTax, breakdown };
}

/**
 * First-time buyer relief only applies while the price is £500,000 or below;
 * above that threshold, standard rates apply to the whole price instead.
 */
export function calculateSdlt(propertyValue: number, isFirstTimeBuyer: boolean): SdltResult {
  if (propertyValue <= 0) {
    return { totalTax: 0, breakdown: [] };
  }
  if (isFirstTimeBuyer && propertyValue <= 500_000) {
    return applyBands(propertyValue, FIRST_TIME_BUYER_BANDS);
  }
  return applyBands(propertyValue, STANDARD_BANDS);
}
