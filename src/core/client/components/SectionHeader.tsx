interface SectionHeaderProps {
  title: string;
  badge?: string;
}

export function SectionHeader({ title, badge }: SectionHeaderProps) {
  return (
    <div className="flex items-center gap-3 mb-6 pb-3 border-b border-border">
      <h2 className="font-serif text-section-title font-semibold text-stone">{title}</h2>
      {badge && (
        <span className="badge-floor">{badge}</span>
      )}
    </div>
  );
}
