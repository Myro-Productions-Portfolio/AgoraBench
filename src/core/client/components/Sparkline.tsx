/* Tiny inline-SVG sparkline for metric rows (E4 scoreboard). Deliberately
   minimal — no axes, no grid, no interaction; the full DeficitChart /
   TreasuryChart SVGs stay where they are (this exists so a THIRD copy of
   those never gets written). Values are assumed time-ascending. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = '#B8956A',
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) {
    return <span className="text-[10px] text-text-muted">—</span>;
  }

  const pad = 2;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const span = max - min || 1;
  const sx = (i: number) => pad + (i / (finite.length - 1)) * (width - pad * 2);
  const sy = (v: number) => pad + (1 - (v - min) / span) * (height - pad * 2);
  const points = finite.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  const last = finite[finite.length - 1];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="shrink-0" role="img" aria-label="trend sparkline">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={sx(finite.length - 1)} cy={sy(last)} r={2} fill={stroke} />
    </svg>
  );
}
