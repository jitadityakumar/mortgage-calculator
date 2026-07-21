const gbpWhole = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

const gbpPrecise = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
});

export function formatGBP(amount: number, precise = false): string {
  return (precise ? gbpPrecise : gbpWhole).format(amount);
}

export function formatMonthsAsYearsMonths(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years} year${years === 1 ? '' : 's'}`);
  if (months > 0) parts.push(`${months} month${months === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' ') : '0 months';
}

export function formatMonthCompact(totalMonths: number): string {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const parts: string[] = [];
  if (years > 0) parts.push(`${years}y`);
  if (months > 0) parts.push(`${months}m`);
  return parts.length > 0 ? parts.join('') : '0m';
}

export function parseNum(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
