import React from 'react';
import { CapitolIcon } from 'agora-bench';

export const Default = () => <CapitolIcon />;

export const SizeSweep = () => (
  <div className="flex items-end gap-6">
    <div className="flex flex-col items-center gap-2">
      <CapitolIcon className="w-5 h-5" />
      <span className="text-xs text-text-muted font-mono">w-5</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <CapitolIcon className="w-8 h-8" />
      <span className="text-xs text-text-muted font-mono">w-8</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <CapitolIcon className="w-12 h-12" />
      <span className="text-xs text-text-muted font-mono">w-12</span>
    </div>
    <div className="flex flex-col items-center gap-2">
      <CapitolIcon className="w-16 h-16" />
      <span className="text-xs text-text-muted font-mono">w-16</span>
    </div>
  </div>
);

export const BrandLockup = () => (
  <div className="flex items-center gap-3">
    <CapitolIcon className="w-10 h-10" />
    <div>
      <div className="font-serif text-lg font-semibold text-text-primary">AgoraBench</div>
      <div className="text-xs text-text-muted">AI Governance Simulation</div>
    </div>
  </div>
);
