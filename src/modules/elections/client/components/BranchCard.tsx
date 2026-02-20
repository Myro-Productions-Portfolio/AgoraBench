interface BranchCardProps {
  branch: 'executive' | 'legislative' | 'judicial';
  title: string;
  officialName: string;
  officialTitle: string;
  officialInitials: string;
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

const BRANCH_ICONS: Record<string, string> = {
  executive: '/images/branches/executive.webp',
  legislative: '/images/branches/legislative.webp',
  judicial: '/images/branches/judicial.webp',
};

export function BranchCard({
  branch,
  title,
  officialName,
  officialTitle,
  officialInitials,
  stats,
}: BranchCardProps) {
  const colors = BRANCH_COLORS[branch];

  return (
    <article className="card relative overflow-hidden p-7">
      {/* Top accent bar */}
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${colors.border}`} />

      {/* Branch icon */}
      <div className={`w-11 h-11 rounded-icon flex items-center justify-center mb-4 ${colors.iconBg}`}>
        <img src={BRANCH_ICONS[branch]} alt={`${branch} branch`} className="w-7 h-7 object-contain" />
      </div>

      {/* Title */}
      <h3 className="font-serif text-card-title font-semibold text-text-primary mb-3">
        {title}
      </h3>

      {/* Official */}
      <div className="flex items-center gap-2.5 p-3 bg-black/20 rounded mb-3">
        <div className="w-10 h-10 rounded-full bg-capitol-deep border-2 border-gold flex items-center justify-center font-serif text-xs font-bold text-gold">
          {officialInitials}
        </div>
        <div>
          <div className="text-sm font-medium">{officialName}</div>
          <div className="text-xs text-text-muted">{officialTitle}</div>
        </div>
      </div>

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
