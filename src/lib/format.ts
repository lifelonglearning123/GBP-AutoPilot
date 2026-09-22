/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st. */
export function ord(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** 7.0 → "7", 7.25 → "7.3". */
export const pts = (n: number) => (Math.round(n * 10) / 10).toString().replace(/\.0$/, '');
