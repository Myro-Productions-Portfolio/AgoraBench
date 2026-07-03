// File: src/modules/legislation/client/components/ConstitutionDrawer.tsx
// Purpose: Slide-in reference panel rendering the Constitution of Agora
// (@shared/constitution). Opened from cited-article chips in the opinion
// reader on CasePage. Structural clone of the AgentDrawer slide-in, but
// fixed-positioned so it works on a normal scrolling page.

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CONSTITUTION } from '@shared/constitution';

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

export function articleRoman(n: number): string {
  return ROMAN[n - 1] ?? String(n);
}

interface ConstitutionDrawerProps {
  /** Article number to highlight and scroll to; null keeps the drawer closed. */
  articleNumber: number | null;
  onClose: () => void;
}

export function ConstitutionDrawer({ articleNumber, onClose }: ConstitutionDrawerProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (articleNumber === null) return;
    /* Wait for the slide-in before scrolling the cited article into view */
    const t = setTimeout(() => {
      highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 250);
    return () => clearTimeout(t);
  }, [articleNumber]);

  return (
    <AnimatePresence>
      {articleNumber !== null && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-40 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Drawer panel */}
          <motion.aside
            className="fixed right-0 top-0 bottom-0 z-50 w-80 max-w-[85vw] bg-capitol-card border-l border-border overflow-y-auto shadow-xl"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            aria-label="The Constitution of Agora"
          >
            {/* Close button */}
            <button
              className="absolute top-3 right-3 w-7 h-7 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-capitol-elevated transition-colors"
              onClick={onClose}
              type="button"
              aria-label="Close constitution panel"
            >
              <svg viewBox="0 0 16 16" fill="none" className="w-3.5 h-3.5">
                <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            </button>

            <div className="p-5 pt-14">
              <div className="text-center mb-5">
                <p className="text-badge text-text-muted uppercase tracking-widest mb-1">Founding Document</p>
                <h3 className="font-serif text-xl font-semibold text-stone">The Constitution of Agora</h3>
              </div>

              <div className="space-y-3">
                {CONSTITUTION.map((article) => {
                  const isCited = article.number === articleNumber;
                  return (
                    <div
                      key={article.number}
                      ref={isCited ? highlightRef : undefined}
                      className="rounded-card border p-4 transition-colors"
                      style={{
                        borderColor: isCited ? '#B8956A' : '#4E5058',
                        background: isCited ? 'rgba(184,149,106,0.08)' : 'transparent',
                        boxShadow: isCited ? '0 0 12px rgba(184,149,106,0.25)' : undefined,
                      }}
                    >
                      <div className="flex items-baseline gap-2 mb-1.5">
                        <span
                          className="font-serif text-sm font-semibold"
                          style={{ color: isCited ? '#D4A96A' : '#C9B99B' }}
                        >
                          Article {articleRoman(article.number)}
                        </span>
                        <span className="text-badge text-text-muted uppercase tracking-widest">
                          {article.title}
                        </span>
                      </div>
                      <p className="text-xs text-text-secondary leading-relaxed">{article.text}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
