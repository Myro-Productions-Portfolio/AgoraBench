interface SidebarItem {
  label: string;
  value: string | number;
}

interface SidebarCardProps {
  title: string;
  items: SidebarItem[];
}

export function SidebarCard({ title, items }: SidebarCardProps) {
  return (
    <div className="card p-5 mb-4">
      <h4 className="font-serif text-[0.95rem] text-stone mb-3">{title}</h4>
      {items.map((item) => (
        <div
          key={item.label}
          className="flex justify-between items-center py-2 border-b border-border-lighter last:border-b-0 text-sm"
        >
          <span className="text-text-secondary">{item.label}</span>
          <span className="font-mono text-sm text-gold">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
