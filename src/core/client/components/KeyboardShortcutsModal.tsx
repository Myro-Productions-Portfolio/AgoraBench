interface ShortcutGroup {
  label: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    label: 'Navigation',
    shortcuts: [
      { keys: ['⌘', 'K'], description: 'Open global search' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal / search' },
    ],
  },
  {
    label: 'Search',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'Navigate results' },
      { keys: ['↵'], description: 'Open selected result' },
    ],
  },
  {
    label: 'Pages',
    shortcuts: [
      { keys: ['G', 'H'], description: 'Go to Capitol (home)' },
      { keys: ['G', 'A'], description: 'Go to Agents' },
      { keys: ['G', 'L'], description: 'Go to Bills (Legislation)' },
      { keys: ['G', 'W'], description: 'Go to Laws' },
      { keys: ['G', 'J'], description: 'Go to Court (Judicial)' },
      { keys: ['G', 'E'], description: 'Go to Elections' },
      { keys: ['G', 'P'], description: 'Go to Parties' },
      { keys: ['G', 'F'], description: 'Go to Forum' },
      { keys: ['G', 'C'], description: 'Go to Calendar' },
      { keys: ['G', 'M'], description: 'Go to Capitol Map' },
    ],
  },
];

interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({ isOpen, onClose }: KeyboardShortcutsModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ backdropFilter: 'blur(4px)', background: 'rgba(26, 27, 30, 0.7)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-full max-w-md mx-4 rounded-lg border border-border shadow-2xl overflow-hidden"
        style={{ background: '#2B2D31' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-serif text-base font-semibold text-stone">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
            aria-label="Close"
          >
            <svg viewBox="0 0 16 16" fill="none" className="w-4 h-4" aria-hidden="true">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Groups */}
        <div className="divide-y divide-border/40 max-h-[70vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.label} className="px-5 py-4 space-y-2.5">
              <div className="text-badge uppercase tracking-widest text-text-muted">{group.label}</div>
              {group.shortcuts.map((s, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-sm text-text-secondary">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((key, ki) => (
                      <kbd
                        key={ki}
                        className="font-mono text-xs text-text-muted border border-border/60 bg-capitol-deep/60 rounded px-1.5 py-0.5 min-w-[24px] text-center"
                      >
                        {key}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border/40 text-badge text-text-muted">
          Press <kbd className="font-mono border border-border/50 rounded px-1">Esc</kbd> or <kbd className="font-mono border border-border/50 rounded px-1">?</kbd> to close
        </div>
      </div>
    </div>
  );
}
