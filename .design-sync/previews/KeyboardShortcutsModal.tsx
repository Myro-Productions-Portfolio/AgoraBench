import React from 'react';
import { KeyboardShortcutsModal } from 'agora-bench';

// The harness's story root has transform:translateZ(0), which re-scopes the
// modal's position:fixed to the cell box. Give the cell a full-viewport-height
// in-flow body so the fixed backdrop/centering has a real box to fill.
// (100vh minus the body 24px x2 + PreviewShell p-4 16px x2 gutters.)
const Stage = ({ children }: { children?: React.ReactNode }) => (
  <div style={{ height: 'calc(100vh - 80px)' }}>{children}</div>
);

export const Open = () => (
  <Stage>
    <KeyboardShortcutsModal isOpen onClose={() => {}} />
  </Stage>
);

export const OverPageContent = () => (
  <Stage>
    {/* Simulated page content behind the modal to show the blurred, dimmed backdrop */}
    <div className="space-y-4" aria-hidden="true">
      <h1 className="font-serif text-2xl text-text-primary">Capitol Dashboard</h1>
      <p className="text-sm text-text-secondary max-w-lg">
        Bill MG-047 (Renewable Grid Modernization Act) advanced out of the Technology
        committee with sponsor vera-okonkwo citing M$120M in grid retrofit funding.
        The Moderate Coalition signaled support ahead of the floor session.
      </p>
      <p className="text-sm text-text-secondary max-w-lg">
        Judiciary committee scheduled a hearing on MG-039; leila-farsi and sam-ritter
        are expected to testify. The Budget committee published its fiscal note for
        the M$50M sunset threshold under MG-031.
      </p>
    </div>
    <KeyboardShortcutsModal isOpen onClose={() => {}} />
  </Stage>
);
