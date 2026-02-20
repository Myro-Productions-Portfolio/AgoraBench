import { motion, AnimatePresence } from 'framer-motion';
import type { Agent } from '@shared/types';

interface AgentDrawerProps {
  agent: Agent | null;
  onClose: () => void;
}

function getAlignmentColor(alignment: string | null | undefined): string {
  if (!alignment) return '#B8956A';
  const a = alignment.toLowerCase();
  if (a.includes('progress') || a.includes('liberal') || a.includes('tech') || a.includes('digital')) return '#6B7A8D';
  if (a.includes('conserv') || a.includes('right') || a.includes('nation') || a.includes('auth')) return '#8B3A3A';
  if (a.includes('labor') || a.includes('union') || a.includes('social') || a.includes('green')) return '#3A6B3A';
  return '#B8956A';
}

export function AgentDrawer({ agent, onClose }: AgentDrawerProps) {
  const ringColor = getAlignmentColor(agent?.alignment ?? undefined);

  return (
    <AnimatePresence>
      {agent && (
        <>
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 z-20 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.aside
className="absolute right-0 top-0 bottom-0 z-30 w-72 bg-capitol-card border-l border-border overflow-y-auto shadow-xl" style={{ paddingTop: '70px' }}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          >
            {/* Close button */}
            <button
              className="absolute top-3 right-3 w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-capitol-elevated transition-colors"
              onClick={onClose}
              type="button"
              aria-label="Close agent panel"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </button>

            <div className="p-5 pt-20">
              {/* Avatar + name */}
              <div className="text-center mb-5">
                <div
                  className="w-20 h-20 rounded-full mx-auto mb-3 overflow-hidden flex items-center justify-center"
                  style={{ border: `3px solid ${ringColor}`, boxShadow: `0 0 12px ${ringColor}44` }}
                >
                  {agent.avatarUrl ? (
                    <img src={agent.avatarUrl} alt={agent.displayName} className="w-full h-full object-cover" />
                  ) : (
                    <div
                      className="w-full h-full flex items-center justify-center text-xl font-bold font-serif"
                      style={{ background: `${ringColor}22`, color: ringColor }}
                    >
                      {agent.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <h3 className="font-serif text-2xl font-semibold text-text-primary">{agent.displayName}</h3>
                <p className="text-sm text-text-muted font-mono mt-0.5">{agent.name}</p>
              </div>

              {/* Stats */}
              <div className="card p-4 mb-4 space-y-2.5">
                <div className="flex justify-between items-center py-1.5 border-b border-border-lighter">
                  <span className="text-sm text-text-secondary">Reputation</span>
                  <span className="font-mono text-base text-gold">{agent.reputation.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-center py-1.5 border-b border-border-lighter">
                  <span className="text-sm text-text-secondary">Balance</span>
                  <span className="font-mono text-base text-gold">M${agent.balance.toLocaleString()}</span>
                </div>
                {agent.alignment && (
                  <div className="flex justify-between items-center py-1.5 border-b border-border-lighter">
                    <span className="text-sm text-text-secondary">Alignment</span>
                    <span className="text-sm capitalize" style={{ color: ringColor }}>{agent.alignment}</span>
                  </div>
                )}
                {agent.bio && (
                  <p className="text-sm text-text-muted pt-1 leading-relaxed">{agent.bio}</p>
                )}
              </div>

              {/* Link to full profile */}
              <a
                href={`/agents/${agent.id}`}
                className="block w-full text-center text-sm text-gold hover:text-gold-bright border border-gold/30 rounded-card py-2 transition-colors hover:bg-gold/5"
              >
                View Full Profile →
              </a>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
