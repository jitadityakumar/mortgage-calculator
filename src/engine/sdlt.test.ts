import { describe, expect, it } from 'vitest';
import { calculateSdlt } from './sdlt';

describe('calculateSdlt — standard rates', () => {
  it('computes tax across multiple bands correctly', () => {
    // £295,000: 0% on first 125k, 2% on next 125k (=2500), 5% on remaining 45k (=2250)
    const result = calculateSdlt(295_000, false);
    expect(result.totalTax).toBe(4_750);
    const sumOfBreakdown = result.breakdown.reduce((s, b) => s + b.tax, 0);
    expect(sumOfBreakdown).toBe(result.totalTax);
  });

  it('charges nothing on a property at or below the zero-rate threshold', () => {
    const result = calculateSdlt(125_000, false);
    expect(result.totalTax).toBe(0);
  });

  it('applies the top band above £1.5m', () => {
    // 125k*0 + 125k*2%(2500) + 675k*5%(33750) + 575k*10%(57500) + 100k*12%(12000) = 105,750
    const result = calculateSdlt(1_600_000, false);
    expect(result.totalTax).toBe(105_750);
  });
});

describe('calculateSdlt — first-time buyer relief', () => {
  it('charges nothing when fully within the FTB zero-rate band', () => {
    const result = calculateSdlt(295_000, true);
    expect(result.totalTax).toBe(0);
  });

  it('charges 5% on the portion between £300,000 and £500,000', () => {
    const result = calculateSdlt(350_000, true);
    expect(result.totalTax).toBe(2_500);
  });

  it('falls back to standard rates (no relief) above the £500,000 threshold', () => {
    const ftb = calculateSdlt(600_000, true);
    const nonFtb = calculateSdlt(600_000, false);
    expect(ftb.totalTax).toBe(nonFtb.totalTax);
    expect(ftb.totalTax).toBe(20_000);
  });
});

describe('calculateSdlt — edge cases', () => {
  it('returns zero tax and an empty breakdown for a non-positive property value', () => {
    expect(calculateSdlt(0, false)).toEqual({ totalTax: 0, breakdown: [] });
    expect(calculateSdlt(-1, false)).toEqual({ totalTax: 0, breakdown: [] });
  });
});
