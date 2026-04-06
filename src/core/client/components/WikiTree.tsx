// src/core/client/components/WikiTree.tsx
import { useState } from 'react';
import { WIKI_TREE, WikiFolder, WikiLeaf, searchWiki, WikiSearchResult } from '../lib/wikiContent';
import { WikiFontSize } from '../lib/wikiPrefs';

interface WikiTreeProps {
  activeArticleId: string;
  fontSize: WikiFontSize;
  onNavigate: (articleId: string, sectionId?: string) => void;
}

export function WikiTree({ activeArticleId, fontSize, onNavigate }: WikiTreeProps) {
  const [query, setQuery] = useState('');
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => {
    const defaultOpen = new Set<string>();
    for (const group of WIKI_TREE) {
      for (const item of group.items) {
        if (item.type === 'folder' && item.defaultOpen) defaultOpen.add(item.label);
      }
    }
    return defaultOpen;
  });

  const leafStyle = { fontSize: `${fontSize - 1}px` };
  const folderStyle = { fontSize: `${fontSize - 1}px` };

  function toggleFolder(label: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  function handleNavigate(articleId: string, sectionId?: string) {
    setQuery('');
    onNavigate(articleId, sectionId);
  }

  const searchResults: WikiSearchResult[] = query.trim() ? searchWiki(query) : [];
  const isSearching = query.trim().length > 0;

  return (
    <div className="flex flex-col w-[200px] flex-shrink-0 border-r border-border/40" style={{ background: '#1e2124' }}>
      {/* Search */}
      <div className="p-2.5 border-b border-border/40">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search wiki..."
          style={{ fontSize: `${fontSize - 1}px` }}
          className="w-full bg-black/40 border border-border/40 rounded px-2.5 py-1.5 text-text-secondary placeholder:text-text-muted outline-none focus:border-gold/30 transition-colors"
        />
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {isSearching ? (
          /* Search results */
          searchResults.length === 0 ? (
            <p className="px-3 py-4 text-text-muted text-center" style={leafStyle}>No results</p>
          ) : (
            searchResults.map((r, i) => (
              <button
                key={i}
                onClick={() => handleNavigate(r.articleId, r.sectionId)}
                className="w-full text-left px-3 py-2 border-b border-border/20 hover:bg-white/[0.03] transition-colors"
              >
                <p className="font-semibold text-text-secondary" style={leafStyle}>{r.articleTitle}</p>
                <p className="text-text-muted mt-0.5 line-clamp-2" style={{ fontSize: `${fontSize - 3}px` }}>{r.snippet}</p>
              </button>
            ))
          )
        ) : (
          /* Tree */
          WIKI_TREE.map((group) => (
            <div key={group.label}>
              <p className="px-3 pt-3 pb-1 text-[9px] uppercase tracking-widest text-text-muted select-none">
                {group.label}
              </p>
              {group.items.map((item) => (
                item.type === 'leaf' ? (
                  <LeafItem
                    key={item.label}
                    leaf={item}
                    isActive={activeArticleId === item.articleId}
                    style={leafStyle}
                    onNavigate={handleNavigate}
                    indent={false}
                  />
                ) : (
                  <FolderItem
                    key={item.label}
                    folder={item}
                    isOpen={openFolders.has(item.label)}
                    activeArticleId={activeArticleId}
                    folderStyle={folderStyle}
                    leafStyle={leafStyle}
                    onToggle={() => toggleFolder(item.label)}
                    onNavigate={handleNavigate}
                  />
                )
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function LeafItem({
  leaf, isActive, style, onNavigate, indent,
}: {
  leaf: WikiLeaf;
  isActive: boolean;
  style: React.CSSProperties;
  onNavigate: (articleId: string, sectionId?: string) => void;
  indent: boolean;
}) {
  return (
    <button
      onClick={() => onNavigate(leaf.articleId, leaf.sectionId)}
      style={style}
      className={`w-full text-left flex items-center gap-1.5 py-1 transition-all border-l-2 ${
        indent ? 'pl-7 pr-3' : 'pl-3 pr-3'
      } ${
        isActive
          ? 'text-gold border-l-gold bg-gold/[0.04]'
          : 'text-text-muted border-l-transparent hover:text-text-secondary hover:bg-white/[0.03]'
      }`}
    >
      <span className="opacity-40 text-[9px]">▸</span>
      {leaf.label}
    </button>
  );
}

function FolderItem({
  folder, isOpen, activeArticleId, folderStyle, leafStyle, onToggle, onNavigate,
}: {
  folder: WikiFolder;
  isOpen: boolean;
  activeArticleId: string;
  folderStyle: React.CSSProperties;
  leafStyle: React.CSSProperties;
  onToggle: () => void;
  onNavigate: (articleId: string, sectionId?: string) => void;
}) {
  return (
    <>
      <button
        onClick={onToggle}
        style={folderStyle}
        className="w-full text-left flex items-center gap-1.5 px-3 py-1.5 text-text-secondary hover:text-text-primary transition-colors"
      >
        <span
          className="text-[9px] text-text-muted transition-transform duration-150"
          style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}
        >
          ▶
        </span>
        <span className="font-medium">{folder.label}</span>
      </button>
      {isOpen && folder.children.map((leaf) => (
        <LeafItem
          key={leaf.label}
          leaf={leaf}
          isActive={activeArticleId === leaf.articleId}
          style={leafStyle}
          onNavigate={onNavigate}
          indent={true}
        />
      ))}
    </>
  );
}
