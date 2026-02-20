import { useState } from 'react';

interface Props {
  id: string;
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: React.ReactNode;
}

export function CollapsibleSection({ id, title, subtitle, defaultOpen = true, children, badge }: Props) {
  const storageKey = `admin_section_${id}`;
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored !== null ? stored === 'true' : defaultOpen;
    } catch { return defaultOpen; }
  });

  const toggle = () => {
    const next = !isOpen;
    setIsOpen(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* ignore */ }
  };

  return (
    <section className="bg-surface rounded-lg border border-border p-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-serif text-lg font-medium text-stone">{title}</h2>
            {badge}
          </div>
          {subtitle && <p className="text-xs text-text-muted mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={toggle}
          className="text-text-muted hover:text-text-secondary p-1 rounded transition-colors"
          aria-label={isOpen ? 'Collapse section' : 'Expand section'}
        >
          <svg
            className={`w-4 h-4 transition-transform duration-200 ${isOpen ? 'rotate-0' : '-rotate-180'}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
      {isOpen && <div className="mt-4 space-y-4">{children}</div>}
    </section>
  );
}
