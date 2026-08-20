import { US_STATE_PATHS, US_STATE_CENTROIDS, US_MAP_VIEWBOX, FIPS_TO_STATE } from '@modules/world/client/lib/usStatePaths';

/**
 * Generic US choropleth. Geometry is keyed by 2-digit FIPS (usStatePaths);
 * consumers whose data is keyed by 2-letter abbreviation (e.g. the Electoral
 * College tables) bridge via FIPS_TO_STATE[fips].abbr inside their callbacks —
 * the bridge lives in the caller, never here.
 */
export interface ChoroplethMapProps {
  /** Fill color for a state. */
  colorForState: (fips: string) => string;
  /** Centroid label text; null (or omitting the prop) renders no label. */
  labelForState?: (fips: string) => string | null;
  /** Per-state aria-label; defaults to the state name. */
  ariaForState?: (fips: string) => string;
  /** Accessible label for the map as a whole. */
  ariaLabel: string;
  selectedFips: string | null;
  onSelect: (fips: string) => void;
}

export function ChoroplethMap({
  colorForState,
  labelForState,
  ariaForState,
  ariaLabel,
  selectedFips,
  onSelect,
}: ChoroplethMapProps) {
  return (
    <svg
      viewBox={US_MAP_VIEWBOX}
      role="group"
      aria-label={ariaLabel}
      className="w-full h-auto motion-reduce:transition-none"
    >
      {Object.entries(US_STATE_PATHS).map(([fips, d]) => {
        const isSelected = selectedFips === fips;
        return (
          <path
            key={fips}
            d={d}
            role="button"
            tabIndex={0}
            aria-label={ariaForState ? ariaForState(fips) : FIPS_TO_STATE[fips]?.name ?? fips}
            aria-pressed={isSelected}
            fill={colorForState(fips)}
            stroke="#15161A"
            strokeWidth={0.6}
            className="cursor-pointer transition-colors duration-150 motion-reduce:transition-none hover:opacity-80 [&:focus]:outline-none [&:focus-visible]:stroke-gold-bright [&:focus-visible]:[stroke-width:2px]"
            onClick={() => onSelect(fips)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(fips);
              }
            }}
          />
        );
      })}
      {/* Selected state re-drawn last so its border sits above every neighbor
          (SVG has no z-index — paint order is DOM order). Non-interactive
          overlay; the base path underneath keeps click/keyboard handling. */}
      {selectedFips && US_STATE_PATHS[selectedFips] && (
        <path
          d={US_STATE_PATHS[selectedFips]}
          fill="none"
          stroke="#D4AF6A"
          strokeWidth={2}
          className="pointer-events-none"
          style={{ paintOrder: 'stroke', filter: 'drop-shadow(0 0 4px rgba(212,175,106,0.65))' }}
        />
      )}
      {labelForState &&
        Object.entries(US_STATE_CENTROIDS).map(([fips, [x, y]]) => {
          const label = labelForState(fips);
          if (label == null) return null;
          return (
            <text
              key={fips}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="middle"
              className="pointer-events-none select-none fill-white text-[8px] font-mono font-semibold"
              style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.55)', strokeWidth: 2 }}
            >
              {label}
            </text>
          );
        })}
    </svg>
  );
}
