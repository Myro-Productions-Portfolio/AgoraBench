import React from 'react';
import { CollapsibleSection } from 'agora-bench';

const ConfigRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between items-center py-2 border-b border-border-lighter last:border-b-0 text-sm">
    <span className="text-text-secondary">{label}</span>
    <span className="font-mono text-sm text-gold">{value}</span>
  </div>
);

export const SimulationEngine = () => (
  <div style={{ width: 520 }}>
    <CollapsibleSection
      id="preview-sim-engine"
      title="Simulation Engine"
      subtitle="Tick cadence, phase toggles, and pacing"
    >
      <div>
        <ConfigRow label="Tick interval" value="90 min" />
        <ConfigRow label="Active phases" value="17 / 17" />
        <ConfigRow label="Pause state" value="Running" />
        <ConfigRow label="Last tick" value="14:32 UTC" />
      </div>
    </CollapsibleSection>
  </div>
);

export const WithBadge = () => (
  <div style={{ width: 520 }}>
    <CollapsibleSection
      id="preview-dwe"
      title="Dynamic Weight Engines"
      subtitle="Adaptive weights replacing flat constants across tick phases"
      badge={<span className="badge-passed">10 active</span>}
    >
      <div>
        <ConfigRow label="Economy pressure" value="0.42" />
        <ConfigRow label="Coalition gravity" value="0.71" />
        <ConfigRow label="Approval decay" value="0.08" />
      </div>
    </CollapsibleSection>
  </div>
);

export const Collapsed = () => (
  <div style={{ width: 520 }}>
    <CollapsibleSection
      id="preview-danger-zone"
      title="Danger Zone"
      subtitle="Reset elections, wipe relationships, reseed agents"
      defaultOpen={false}
    >
      <div>
        <ConfigRow label="Never rendered" value="collapsed" />
      </div>
    </CollapsibleSection>
  </div>
);

export const StackedSections = () => (
  <div className="space-y-4" style={{ width: 520 }}>
    <CollapsibleSection
      id="preview-stack-elections"
      title="Elections"
      subtitle="Cycle length and campaign rules"
      badge={<span className="badge-committee">cycle 12</span>}
    >
      <div>
        <ConfigRow label="Election cycle" value="30 ticks" />
        <ConfigRow label="Campaign spend cap" value="M$25,000" />
      </div>
    </CollapsibleSection>
    <CollapsibleSection
      id="preview-stack-treasury"
      title="Treasury"
      subtitle="Government revenue and spending programs"
    >
      <div>
        <ConfigRow label="Balance" value="M$2,481,300" />
        <ConfigRow label="Tax rate" value="4.5%" />
        <ConfigRow label="Active programs" value="6" />
      </div>
    </CollapsibleSection>
  </div>
);
