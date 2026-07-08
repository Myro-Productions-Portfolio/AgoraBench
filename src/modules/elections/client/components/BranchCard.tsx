interface BranchCardProps {
  branch: 'executive' | 'legislative' | 'judicial';
  title: string;
  /** Source path for the branch icon. Callers own the asset path so the
      component doesn't depend on magic /public paths. */
  icon: string;
  officialName: string;
  officialTitle: string;
  officialInitials: string;
  /** When true, the office is unfilled: render a neutral vacant state instead
      of a fake person named "Vacant" with "--" initials. */
  vacant?: boolean;
  /** When true, this branch has no single-leader role in the sim at all (no
      election, no appointment rule) — render as "Not tracked" instead of
      "Vacant", since "Vacant" implies an office that could be filled. */
  notModeled?: boolean;
  stats: Array<{ label: string; value: string | number }>;
}

const BRANCH_COLORS = {
  executive: {
    border: 'bg-gold',
    iconBg: 'bg-gold/15',
  },
  legislative: {
    border: 'bg-stone',
    iconBg: 'bg-stone/15',
  },
  judicial: {
    border: 'bg-slate-judicial',
    iconBg: 'bg-slate-judicial/15',
  },
} as const;

export function BranchCard({
  branch,
  title,
  icon,
  officialName,
  officialTitle,
  officialInitials,
  vacant = false,
  notModeled = false,
  stats,
}: BranchCardProps) {
  const colors = BRANCH_COLORS[branch];

  return (
    <article className="card relative overflow-hidden p-7">
      {/* Top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${colors.border}`} />

      {/* Branch icon */}
      <div className={`w-11 h-11 rounded-icon flex items-center justify-center mb-4 ${colors.iconBg}`}>
        <img src={icon} alt={`${branch} branch`} className="w-7 h-7 object-contain" />
      </div>

      {/* Title */}
      <h3 className="font-serif text-card-title font-semibold text-text-primary mb-3">
        {title}
      </h3>

      {/* Official */}
      {notModeled ? (
        <div className="flex items-center gap-2.5 p-3 bg-black/20 rounded mb-3">
          <div className="w-10 h-10 rounded-full bg-capitol-deep border-2 border-dashed border-border flex items-center justify-center font-serif text-xs font-bold text-text-muted">
            &mdash;
          </div>
          <div>
            <div className="text-sm font-medium text-text-muted italic">Not tracked</div>
            <div className="text-xs text-text-muted">No single {officialTitle.toLowerCase()} role in this sim</div>
          </div>
        </div>
      ) : vacant ? (
        <div className="flex items-center gap-2.5 p-3 bg-black/20 rounded mb-3">
          <div className="w-10 h-10 rounded-full bg-capitol-deep border-2 border-dashed border-border flex items-center justify-center font-serif text-xs font-bold text-text-muted">
            &mdash;
          </div>
          <div>
            <div className="text-sm font-medium text-text-muted italic">Vacant</div>
            <div className="text-xs text-text-muted">{officialTitle}</div>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 p-3 bg-black/20 rounded mb-3">
          <div className="w-10 h-10 rounded-full bg-capitol-deep border-2 border-gold flex items-center justify-center font-serif text-xs font-bold text-gold">
            {officialInitials}
          </div>
          <div>
            <div className="text-sm font-medium">{officialName}</div>
            <div className="text-xs text-text-muted">{officialTitle}</div>
          </div>
        </div>
      )}

      {/* Stats row */}
      <div className="flex gap-4 mt-4 pt-3 border-t border-border-light">
        {stats.map((stat) => (
          <div key={stat.label} className="flex-1 text-center">
            <div className="font-mono text-lg text-gold">{stat.value}</div>
            <div className="text-stat-label text-text-muted uppercase">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
