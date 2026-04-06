// src/core/client/components/WikiArticle.tsx
import { useEffect, useRef } from 'react';
import { WikiArticle as WikiArticleType } from '../lib/wikiContent';
import { WikiFontSize } from '../lib/wikiPrefs';

interface WikiArticleProps {
  article: WikiArticleType;
  fontSize: WikiFontSize;
  onSectionVisible: (sectionId: string) => void;
  onNavigate: (articleId: string, sectionId?: string) => void;
}

export function WikiArticle({ article, fontSize, onSectionVisible, onNavigate }: WikiArticleProps) {
  const paneRef = useRef<HTMLDivElement>(null);

  // Scroll tracking — update active section as user scrolls
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane) return;
    const handler = () => {
      const scrollTop = pane.scrollTop;
      let current = article.sections[0]?.id ?? '';
      for (const section of article.sections) {
        const el = pane.querySelector<HTMLElement>(`#ws-${section.id}`);
        if (el && el.offsetTop - 80 <= scrollTop) current = section.id;
      }
      onSectionVisible(current);
    };
    pane.addEventListener('scroll', handler, { passive: true });
    return () => pane.removeEventListener('scroll', handler);
  }, [article, onSectionVisible]);

  // Reset scroll to top when article changes
  useEffect(() => {
    if (paneRef.current) paneRef.current.scrollTop = 0;
    if (article.sections[0]) onSectionVisible(article.sections[0].id);
  }, [article.id]);

  const bodyStyle = { fontSize: `${fontSize}px`, lineHeight: '1.8' };
  const subtitleStyle = { fontSize: `${fontSize + 1}px` };
  const h3Style = { fontSize: `${fontSize - 1}px` };
  const codeStyle = { fontSize: `${fontSize - 2}px` };

  return (
    <div ref={paneRef} className="flex-1 overflow-y-auto px-7 py-6">
      {/* Eyebrow */}
      <p className="text-[10px] uppercase tracking-widest text-text-muted mb-2">{article.eyebrow}</p>

      {/* Title */}
      <h1 className="text-[22px] font-semibold text-text-primary mb-2 leading-snug">{article.title}</h1>

      {/* Subtitle */}
      <p className="text-text-secondary mb-8" style={subtitleStyle}>{article.subtitle}</p>

      {/* Sections */}
      <div className="text-text-secondary" style={bodyStyle}>
        {article.sections.map((section, i) => (
          <div key={section.id} id={`ws-${section.id}`} className={i > 0 ? 'mt-8' : ''}>
            {i > 0 && (
              <h3
                className="font-bold uppercase tracking-wider text-text-primary mb-3"
                style={h3Style}
              >
                {section.heading}
              </h3>
            )}
            <p>{section.body}</p>
          </div>
        ))}
      </div>

      {/* Prev / Next */}
      {(article.prev || article.next) && (
        <div className="flex justify-between mt-12 pt-5 border-t border-border/40">
          {article.prev ? (
            <button
              onClick={() => onNavigate(article.prev!.id)}
              className="flex flex-col gap-1 px-4 py-2.5 border border-border/40 rounded hover:border-gold/30 transition-colors text-left max-w-[45%]"
            >
              <span className="text-[10px] uppercase tracking-wider text-text-muted">← Previous</span>
              <span className="text-text-secondary" style={codeStyle}>{article.prev.title}</span>
            </button>
          ) : <div />}
          {article.next && (
            <button
              onClick={() => onNavigate(article.next!.id)}
              className="flex flex-col gap-1 px-4 py-2.5 border border-border/40 rounded hover:border-gold/30 transition-colors text-right max-w-[45%]"
            >
              <span className="text-[10px] uppercase tracking-wider text-text-muted">Next →</span>
              <span className="text-text-secondary" style={codeStyle}>{article.next.title}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
