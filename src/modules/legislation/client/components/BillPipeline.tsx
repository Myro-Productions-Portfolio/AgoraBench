type ExtendedBillStatus = string;

interface PipelineStage {
  value: ExtendedBillStatus | 'all';
  label: string;
  count: number;
  terminal?: boolean;
}

interface BillPipelineProps {
  counts: Record<string, number>;
  activeFilter: ExtendedBillStatus | 'all';
  onFilter: (value: ExtendedBillStatus | 'all') => void;
}

const FLOW_STAGES: Array<{ value: string; label: string; terminal?: boolean }> = [
  { value: 'proposed', label: 'Proposed' },
  { value: 'committee', label: 'Committee' },
  { value: 'floor', label: 'Floor' },
  { value: 'passed', label: 'Passed' },
  { value: 'law', label: 'Law' },
];

const TERMINAL_STAGES: Array<{ value: string; label: string; terminal: true }> = [
  { value: 'vetoed', label: 'Vetoed', terminal: true },
  { value: 'tabled', label: 'Tabled', terminal: true },
  { value: 'presidential_veto', label: 'Pres. Veto', terminal: true },
];

const STAGE_COLORS: Record<string, string> = {
  proposed: 'border-blue-400/40 text-blue-400 bg-blue-400/10 hover:bg-blue-400/20',
  committee: 'border-yellow-400/40 text-yellow-400 bg-yellow-400/10 hover:bg-yellow-400/20',
  floor: 'border-purple-400/40 text-purple-400 bg-purple-400/10 hover:bg-purple-400/20',
  passed: 'border-green-400/40 text-green-400 bg-green-400/10 hover:bg-green-400/20',
  law: 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20',
  vetoed: 'border-red-400/40 text-red-400 bg-red-400/10 hover:bg-red-400/20',
  tabled: 'border-gray-400/40 text-gray-400 bg-gray-400/10 hover:bg-gray-400/20',
  presidential_veto: 'border-orange-400/40 text-orange-400 bg-orange-400/10 hover:bg-orange-400/20',
};

const ACTIVE_RING: Record<string, string> = {
  proposed: 'ring-2 ring-blue-400',
  committee: 'ring-2 ring-yellow-400',
  floor: 'ring-2 ring-purple-400',
  passed: 'ring-2 ring-green-400',
  law: 'ring-2 ring-emerald-400',
  vetoed: 'ring-2 ring-red-400',
  tabled: 'ring-2 ring-gray-400',
  presidential_veto: 'ring-2 ring-orange-400',
};

function StageButton({
  stage,
  isActive,
  onClick,
}: {
  stage: PipelineStage;
  isActive: boolean;
  onClick: () => void;
}) {
  const colors = STAGE_COLORS[stage.value] ?? 'border-border text-text-muted bg-black/10 hover:bg-white/5';
  const ring = isActive ? (ACTIVE_RING[stage.value] ?? 'ring-2 ring-gold') : '';

  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center px-3 py-2 rounded border text-center transition-all min-w-[72px] ${colors} ${ring}`}
      aria-pressed={isActive}
    >
      <span className="font-mono text-lg font-bold leading-none">{stage.count}</span>
      <span className="text-badge uppercase tracking-wide mt-0.5 opacity-80">{stage.label}</span>
    </button>
  );
}

export function BillPipeline({ counts, activeFilter, onFilter }: BillPipelineProps) {
  const flowStages: PipelineStage[] = FLOW_STAGES.map((s) => ({
    ...s,
    count: counts[s.value] ?? 0,
  }));

  const terminalStages: PipelineStage[] = TERMINAL_STAGES.map((s) => ({
    ...s,
    count: counts[s.value] ?? 0,
  }));

  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="mb-6 p-4 rounded border border-border bg-black/10">
      <div className="flex items-center gap-1 flex-wrap">
        {/* All button */}
        <button
          onClick={() => onFilter('all')}
          className={`flex flex-col items-center px-3 py-2 rounded border text-center transition-all min-w-[60px] border-border text-text-muted bg-black/10 hover:bg-white/5 ${activeFilter === 'all' ? 'ring-2 ring-gold' : ''}`}
          aria-pressed={activeFilter === 'all'}
        >
          <span className="font-mono text-lg font-bold leading-none">{total}</span>
          <span className="text-badge uppercase tracking-wide mt-0.5 opacity-80">All</span>
        </button>

        {/* Flow arrow */}
        <span className="text-text-muted text-xs mx-1">→</span>

        {/* Flow stages */}
        {flowStages.map((stage, i) => (
          <div key={stage.value} className="flex items-center gap-1">
            <StageButton
              stage={stage}
              isActive={activeFilter === stage.value}
              onClick={() => onFilter(stage.value)}
            />
            {i < flowStages.length - 1 && (
              <span className="text-text-muted text-xs">→</span>
            )}
          </div>
        ))}

        {/* Terminal separator */}
        {terminalStages.some((s) => s.count > 0) && (
          <>
            <span className="text-border mx-2 text-sm">|</span>
            {terminalStages
              .filter((s) => s.count > 0)
              .map((stage) => (
                <StageButton
                  key={stage.value}
                  stage={stage}
                  isActive={activeFilter === stage.value}
                  onClick={() => onFilter(stage.value)}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
