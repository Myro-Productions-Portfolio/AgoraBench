// src/core/client/components/WikiDrawer.tsx
import { useState, useEffect, useCallback } from 'react';
import { WIKI_ARTICLE_MAP } from '../lib/wikiContent';
import { getWikiFontSize, setWikiFontSize, stepFontSize, FONT_SIZES, WikiFontSize } from '../lib/wikiPrefs';
import { WikiTree } from './WikiTree';
import { WikiArticle } from './WikiArticle';

interface WikiDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_ARTICLE_ID = 'overview';

export function WikiDrawer({ isOpen, onClose }: WikiDrawerProps) {
  const [articleId, setArticleId] = useState(DEFAULT_ARTICLE_ID);
  const [fontSize, setFontSize] = useState<WikiFontSize>(() => getWikiFontSize());

  const article = WIKI_ARTICLE_MAP[articleId] ?? WIKI_ARTICLE_MAP[DEFAULT_ARTICLE_ID];

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  function handleNavigate(id: string) {
    setArticleId(id);
  }

  function handleFontStep(delta: 1 | -1) {
    setFontSize((prev) => {
      const next = stepFontSize(prev, delta);
      setWikiFontSize(next);
      return next;
    });
  }

  const handleSectionVisible = useCallback(() => {
    // Section visibility is tracked by WikiArticle
  }, []);

  const fontIndex = FONT_SIZES.indexOf(fontSize);

  // Build breadcrumb from article eyebrow
  const breadcrumbParts = article.eyebrow.split(' / ');

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/45"
        style={{ top: '64px' }}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        className="fixed right-0 bottom-0 z-50 flex flex-col border-l border-border shadow-2xl"
        style={{
          top: '64px',
          width: '35vw',
          background: '#22252a',
          boxShadow: '-12px 0 40px rgba(0,0,0,0.5)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Wiki"
      >
        {/* Header */}
        <div
          className="h-[52px] flex items-center justify-between px-4 border-b border-border/40 flex-shrink-0"
          style={{ background: '#1e2124' }}
        >
          <div className="flex items-center gap-2.5">
            <span className="text-[16px] font-bold uppercase tracking-widest text-gold">Wiki</span>
            <div className="flex items-center gap-1 text-[12px] text-text-muted">
              {breadcrumbParts.map((part, i) => (
                <span key={i} className="flex items-center gap-1">
                  <span className="text-border">/</span>
                  <span className={i === breadcrumbParts.length - 1 ? 'text-text-secondary' : ''}>{part}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Font scale */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleFontStep(-1)}
                disabled={fontIndex === 0}
                className="w-[26px] h-[26px] flex items-center justify-center rounded border border-border/40 text-[11px] font-semibold text-text-muted hover:text-text-primary hover:border-border transition-colors disabled:opacity-25 disabled:cursor-default"
                aria-label="Decrease font size"
              >
                A−
              </button>
              <span className="text-[10px] text-text-muted min-w-[28px] text-center">{fontSize}px</span>
              <button
                onClick={() => handleFontStep(1)}
                disabled={fontIndex === FONT_SIZES.length - 1}
                className="w-[26px] h-[26px] flex items-center justify-center rounded border border-border/40 text-[11px] font-semibold text-text-muted hover:text-text-primary hover:border-border transition-colors disabled:opacity-25 disabled:cursor-default"
                aria-label="Increase font size"
              >
                A+
              </button>
            </div>

            {/* Close */}
            <button
              onClick={onClose}
              className="w-[26px] h-[26px] flex items-center justify-center rounded border border-border/40 text-[13px] text-text-muted hover:text-text-primary hover:border-border transition-colors"
              aria-label="Close wiki"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body: tree + article */}
        <div className="flex flex-1 overflow-hidden">
          <WikiTree
            activeArticleId={articleId}
            fontSize={fontSize}
            onNavigate={handleNavigate}
          />
          <WikiArticle
            article={article}
            fontSize={fontSize}
            onSectionVisible={handleSectionVisible}
            onNavigate={handleNavigate}
          />
        </div>
      </div>
    </>
  );
}
