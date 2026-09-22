type Grade = 'good' | 'partial' | 'poor' | 'unknown';

const LABEL: Record<Grade, string> = { good: 'Done', partial: 'Partly done', poor: 'Missing', unknown: 'Not checked' };
const COLOUR: Record<Grade, string> = { good: 'var(--good)', partial: 'var(--warn)', poor: 'var(--bad)', unknown: 'var(--muted)' };

/** A drawn status mark (tick, half, cross, dashed ring), so status never relies on colour alone. */
export default function StatusIcon({ grade, size = 16 }: { grade: Grade; size?: number }) {
  const c = COLOUR[grade];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" role="img" aria-label={LABEL[grade]} className="shrink-0">
      {grade === 'good' && (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--good-bg)" stroke={c} strokeWidth="1.4" />
          <path d="M5 8.3l2 2 4-4.3" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {grade === 'partial' && (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--warn-bg)" stroke={c} strokeWidth="1.4" />
          <path d="M8 1.7a6.3 6.3 0 0 1 0 12.6z" fill={c} />
        </>
      )}
      {grade === 'poor' && (
        <>
          <circle cx="8" cy="8" r="7" fill="var(--bad-bg)" stroke={c} strokeWidth="1.4" />
          <path d="M5.7 5.7l4.6 4.6M10.3 5.7l-4.6 4.6" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
      {grade === 'unknown' && <circle cx="8" cy="8" r="6.4" fill="none" stroke={c} strokeWidth="1.4" strokeDasharray="2.4 2.4" />}
    </svg>
  );
}
