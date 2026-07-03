// Preview wrapper for design-sync cards.
// Provides the contexts AgoraBench components assume at runtime:
// - MemoryRouter: CampaignCard/BillCard render react-router <Link>
// - AnimatePresence: capitol-map components animate via framer-motion
// - The dark app chrome: the app sets bg-capitol-deep/text-text-primary/font-sans
//   on <body>; previews need the same base so the dark-first palette reads correctly.
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';

export function PreviewShell({ children }: { children?: React.ReactNode }) {
  return (
    <MemoryRouter>
      <AnimatePresence>
        <div className="bg-capitol-deep text-text-primary font-sans antialiased p-4">
          {children}
        </div>
      </AnimatePresence>
    </MemoryRouter>
  );
}
