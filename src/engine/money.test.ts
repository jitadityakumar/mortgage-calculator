import { describe, expect, it } from 'vitest';
import { penceToPounds, poundsToPence } from './money';

describe('money helpers', () => {
  it('converts pounds to pence without float drift', () => {
    expect(poundsToPence(1169.18)).toBe(116918);
    expect(poundsToPence(0.1)).toBe(10);
    expect(poundsToPence(250000)).toBe(25000000);
  });

  it('round-trips pence back to pounds exactly', () => {
    expect(penceToPounds(116918)).toBe(1169.18);
    expect(penceToPounds(10)).toBe(0.1);
  });
});
