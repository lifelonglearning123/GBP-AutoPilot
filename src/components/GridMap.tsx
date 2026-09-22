import { mapLayout, rankColour, type GridPoint } from '@/lib/grid';

/**
 * Heatmap of one search: OpenStreetMap tiles with a circle per grid point showing this business's
 * position there. Pure HTML positioned in percentages, so it scales with the page and needs no map
 * library. Each circle links to the same search on Google Maps from that spot, to check by hand.
 */
export default function GridMap({ points, centre, zoom, dark = true }: { points: GridPoint[]; centre: { lat: number; lng: number }; zoom: number; dark?: boolean }) {
  const L = mapLayout(points, centre);
  return (
    <div className="relative w-full overflow-hidden rounded-xl border" style={{ aspectRatio: String(L.ratio), borderColor: 'var(--line)', background: '#1b2230' }}>
      <div className={dark ? 'osm-dark' : ''}>
        {L.tiles.map(t => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t.url} src={t.url} alt="" draggable={false} className="absolute select-none"
            style={{ left: `${t.left}%`, top: `${t.top}%`, width: `${t.w}%`, height: `${t.h}%` }} />
        ))}
      </div>
      <div className="absolute" title="The business" style={{ left: `${L.centre.left}%`, top: `${L.centre.top}%`, transform: 'translate(-50%, -115%)', fontSize: 22, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>📍</div>
      {points.map((p, i) => {
        const at = L.pins[i];
        const top = (() => { try { return JSON.parse(p.top_json ?? '[]')[0]; } catch { return null; } })();
        const label = p.error ? '!' : p.position ? String(p.position) : '20+';
        const tip = p.error ? `Could not be read here: ${p.error}`
          : `${p.position ? `#${p.position} here` : 'Not in the first 20 here'}${top && !top.isSelf ? ` · #1: ${top.title}` : ''} · click to open this search on Google Maps`;
        return (
          <a key={p.id} href={`https://www.google.com/maps/search/${encodeURIComponent(p.query)}/@${p.lat.toFixed(6)},${p.lng.toFixed(6)},${zoom}z`} target="_blank" rel="noopener" title={tip}
            className="absolute flex items-center justify-center rounded-full font-semibold text-white shadow-md hover:scale-110 transition-transform"
            style={{ left: `${at.left}%`, top: `${at.top}%`, width: 34, height: 34, transform: 'translate(-50%, -50%)', background: p.error ? '#374151' : rankColour(p.position), border: '2px solid rgba(255,255,255,.85)', fontSize: label.length > 2 ? 10 : 13 }}>
            {label}
          </a>
        );
      })}
      <div className="absolute bottom-1 right-2 text-[10px]" style={{ color: '#cbd5e1', textShadow: '0 1px 2px #000' }}>
        © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" className="underline">OpenStreetMap</a> contributors
      </div>
    </div>
  );
}
