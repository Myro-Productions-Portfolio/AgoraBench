import { useState, useEffect, useCallback } from 'react';
import { demosApi, agentsApi } from '../lib/api';

// ============================================================
// TYPES
// ============================================================

interface ModelInfo {
  id: string;
  hfRepo: string;
  architecture: string;
  params: string;
  baseModel: string;
  alignment: string;
  license: string;
}

interface PresetInfo {
  id: string;
  name: string;
  vram: string;
  gpuModel: string;
  maxModelSize: string;
  framework: string;
  estimatedTime: string;
}

interface AgentOption {
  id: string;
  displayName: string;
  alignment: string;
  modelProvider: string;
}

interface DemosDimensions {
  decisionCoherence: number;
  reasoningQuality: number;
  legislativeIndependence: number;
  whipDisciplineBalance: number;
  latencyEfficiency: number;
  approvalStability: number;
  participationRate: number;
}

interface DemosScore {
  composite: number;
  dimensions: DemosDimensions;
  meta: {
    totalDecisions: number;
    totalVotes: number;
    yeaRate: number;
    avgLatencyMs: number;
    successRate: number;
  };
}

interface AgentScore {
  agent: string;
  agentId: string;
  alignment: string;
  demos: DemosScore;
}

// ============================================================
// HELPERS
// ============================================================

function scoreColor(value: number): string {
  if (value >= 80) return 'text-green-400';
  if (value >= 60) return 'text-stone';
  if (value >= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function scoreBgColor(value: number): string {
  if (value >= 80) return 'bg-green-400';
  if (value >= 60) return 'bg-stone';
  if (value >= 40) return 'bg-yellow-400';
  return 'bg-red-400';
}

function humanizeDimension(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

// ============================================================
// STEP INDICATOR
// ============================================================

const STEPS = [
  { num: 1, label: 'Select Model' },
  { num: 2, label: 'Target Hardware' },
  { num: 3, label: 'Review & Export' },
] as const;

function StepIndicator({
  step,
  canGoTo,
  onStep,
}: {
  step: number;
  canGoTo: (s: number) => boolean;
  onStep: (s: number) => void;
}) {
  return (
    <div className="flex gap-2 mb-8">
      {STEPS.map(({ num, label }) => (
        <button
          key={num}
          onClick={() => canGoTo(num) && onStep(num)}
          className={`flex-1 py-3 px-4 rounded text-center transition-all duration-200 cursor-pointer ${
            step === num
              ? 'bg-gold/[0.08] border border-gold/20'
              : 'bg-white/[0.02] border border-border/50 hover:bg-white/[0.04]'
          }`}
        >
          <div
            className={`text-[10px] uppercase tracking-widest mb-0.5 ${
              step >= num ? 'text-stone' : 'text-text-muted/40'
            }`}
          >
            Step {num}
          </div>
          <div
            className={`text-[13px] ${
              step >= num ? 'text-stone' : 'text-text-muted/60'
            } ${step === num ? 'font-semibold' : 'font-normal'}`}
          >
            {label}
          </div>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export function TrainingPage() {
  const [step, setStep] = useState(1);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  const [agentOptions, setAgentOptions] = useState<AgentOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('all');
  const [scores, setScores] = useState<AgentScore[] | null>(null);
  const [exportStatus, setExportStatus] = useState<'idle' | 'generating' | 'ready' | 'error'>('idle');
  const [loading, setLoading] = useState(true);

  // Fetch models, presets, agents on mount
  useEffect(() => {
    Promise.all([
      demosApi.models(),
      demosApi.presets(),
      agentsApi.list(1, 50),
    ])
      .then(([modelsRes, presetsRes, agentsRes]) => {
        const m = modelsRes.data as { models: ModelInfo[] };
        const p = presetsRes.data as { presets: PresetInfo[] };
        setModels(m.models ?? []);
        setPresets(p.presets ?? []);

        // Handle agents — may be in different response shapes
        const agentData = agentsRes.data as { agents?: AgentOption[] } | AgentOption[];
        if (Array.isArray(agentData)) {
          setAgentOptions(agentData);
        } else if (agentData?.agents) {
          setAgentOptions(agentData.agents);
        }
      })
      .catch((err) => console.error('Failed to load training data:', err))
      .finally(() => setLoading(false));
  }, []);

  // Fetch DEMOS scores when entering step 3
  const fetchScores = useCallback(async () => {
    try {
      const body = selectedAgent !== 'all' ? { agentId: selectedAgent } : undefined;
      const res = await demosApi.scores(body);
      const data = res.data as { scores?: AgentScore[]; demos?: DemosScore; agent?: string; agentId?: string; alignment?: string };
      if (data.scores) {
        setScores(data.scores);
      } else if (data.demos) {
        // Single agent response
        setScores([{
          agent: data.agent ?? 'Unknown',
          agentId: data.agentId ?? '',
          alignment: data.alignment ?? '',
          demos: data.demos,
        }]);
      }
    } catch (err) {
      console.error('Failed to fetch DEMOS scores:', err);
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (step === 3) fetchScores();
  }, [step, fetchScores]);

  // Export handler
  const handleExport = async () => {
    setExportStatus('generating');
    try {
      await demosApi.downloadExport({
        modelId: selectedModel,
        presetId: selectedPreset,
        agentFilter: selectedAgent !== 'all' ? selectedAgent : undefined,
      });
      setExportStatus('ready');
    } catch (err) {
      console.error('Export error:', err);
      setExportStatus('error');
    }
  };

  const currentModel = models.find((m) => m.id === selectedModel);
  const currentPreset = presets.find((p) => p.id === selectedPreset);

  const canGoTo = (s: number) => {
    if (s === 1) return true;
    if (s === 2) return !!selectedModel;
    if (s === 3) return !!selectedModel && !!selectedPreset;
    return false;
  };

  if (loading) {
    return (
      <div className="max-w-[920px] mx-auto px-6 py-10">
        <div className="text-text-muted text-sm italic">Loading training configuration...</div>
      </div>
    );
  }

  return (
    <div className="max-w-[920px] mx-auto px-6 py-10">
      {/* Page Header */}
      <h1 className="font-serif text-[28px] font-normal text-stone mb-1.5">
        DEMOS Training Export
      </h1>
      <p className="text-sm text-text-muted mb-8">
        Generate fine-tuning packages from simulation benchmark data.
        Score &rarr; Train &rarr; Re-inject &rarr; Measure improvement.
      </p>

      {/* Step Indicator */}
      <StepIndicator step={step} canGoTo={canGoTo} onStep={setStep} />

      {/* ================================================== */}
      {/* STEP 1: SELECT MODEL                               */}
      {/* ================================================== */}
      {step === 1 && (
        <div className="bg-white/[0.03] border border-border rounded-lg p-7 mb-6">
          <h2 className="font-serif text-xl font-normal text-stone mb-1">
            Select Base Model
          </h2>
          <p className="text-[13px] text-text-muted mb-6">
            Choose the model to fine-tune with DEMOS simulation data.
          </p>

          {/* Model selector */}
          <div className="mb-5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
              Model
            </label>
            <select
              className="w-full px-3.5 py-2.5 bg-white/[0.06] border border-border rounded text-stone text-sm focus:outline-none focus:border-gold/40"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">Choose a model...</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.hfRepo} ({m.params}) &mdash; {m.alignment}
                </option>
              ))}
            </select>
          </div>

          {/* Model details */}
          {currentModel && (
            <>
              <div className="h-px bg-border my-5" />
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                    Architecture
                  </span>
                  <div className="text-sm text-stone">{currentModel.architecture}</div>
                </div>
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                    Parameters
                  </span>
                  <div className="text-sm text-stone">{currentModel.params}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-5">
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                    Default Alignment
                  </span>
                  <div className="text-sm text-stone">{currentModel.alignment}</div>
                </div>
                <div>
                  <span className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
                    License
                  </span>
                  <div className="text-sm text-stone">{currentModel.license}</div>
                </div>
              </div>
            </>
          )}

          <div className="h-px bg-border my-5" />

          {/* Agent filter */}
          <div className="mb-5">
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
              Filter Training Data By Agent (optional)
            </label>
            <select
              className="w-full px-3.5 py-2.5 bg-white/[0.06] border border-border rounded text-stone text-sm focus:outline-none focus:border-gold/40"
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option value="all">All agents &mdash; full simulation data</option>
              {agentOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.displayName} ({a.alignment})
                </option>
              ))}
            </select>
          </div>

          <button
            className="px-8 py-3 bg-gold/[0.18] border border-gold/30 rounded text-stone text-sm font-semibold transition-all hover:bg-gold/25 disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!selectedModel}
            onClick={() => setStep(2)}
          >
            Continue &rarr;
          </button>
        </div>
      )}

      {/* ================================================== */}
      {/* STEP 2: TARGET HARDWARE                            */}
      {/* ================================================== */}
      {step === 2 && (
        <div className="bg-white/[0.03] border border-border rounded-lg p-7 mb-6">
          <h2 className="font-serif text-xl font-normal text-stone mb-1">
            Target Hardware
          </h2>
          <p className="text-[13px] text-text-muted mb-6">
            Select your training environment. Config files and hyperparameters
            will auto-adjust for VRAM, batch size, and quantization.
          </p>

          {/* Preset grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {presets.map((preset) => (
              <button
                key={preset.id}
                className={`p-4 rounded text-left transition-all ${
                  selectedPreset === preset.id
                    ? 'bg-gold/[0.08] border border-gold/30'
                    : 'bg-white/[0.02] border border-border/60 hover:bg-white/[0.04]'
                }`}
                onClick={() => setSelectedPreset(preset.id)}
              >
                <div className="text-sm font-medium text-stone mb-1">
                  {preset.name}
                </div>
                <div className="text-[11px] text-text-muted leading-relaxed">
                  VRAM: {preset.vram}
                  <br />
                  Max model: {preset.maxModelSize}
                  <br />
                  Framework: {preset.framework}
                  <br />
                  Est. time: {preset.estimatedTime}
                </div>
              </button>
            ))}
          </div>

          {/* Compatibility check */}
          {currentPreset && currentModel && (
            <>
              <div className="h-px bg-border my-5" />
              <div className="text-xs text-text-muted mb-4">
                <span className="text-stone font-medium">Compatibility check: </span>
                {(() => {
                  const modelSize = parseFloat(currentModel.params);
                  const maxSize = parseFloat(currentPreset.maxModelSize);
                  if (modelSize <= maxSize) {
                    return (
                      <span className="text-green-400">
                        {currentModel.params} model fits within {currentPreset.maxModelSize} limit
                      </span>
                    );
                  }
                  return (
                    <span className="text-red-400">
                      {currentModel.params} model exceeds {currentPreset.maxModelSize} limit &mdash; quantization required
                    </span>
                  );
                })()}
              </div>
            </>
          )}

          <div className="flex gap-3">
            <button
              className="px-6 py-2.5 bg-white/10 border border-border rounded text-stone text-sm font-medium transition-all hover:bg-white/15"
              onClick={() => setStep(1)}
            >
              &larr; Back
            </button>
            <button
              className="px-8 py-3 bg-gold/[0.18] border border-gold/30 rounded text-stone text-sm font-semibold transition-all hover:bg-gold/25 disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={!selectedPreset}
              onClick={() => setStep(3)}
            >
              Continue &rarr;
            </button>
          </div>
        </div>
      )}

      {/* ================================================== */}
      {/* STEP 3: REVIEW & EXPORT                            */}
      {/* ================================================== */}
      {step === 3 && (
        <>
          {/* DEMOS Scores */}
          <div className="bg-white/[0.03] border border-border rounded-lg p-7 mb-6">
            <h2 className="font-serif text-xl font-normal text-stone mb-1">
              DEMOS Benchmark Scores
            </h2>
            <p className="text-[13px] text-text-muted mb-6">
              Pre-training baseline scores. Re-run after fine-tuning to measure improvement.
            </p>

            {scores && scores.length > 0 ? (
              <>
                {scores.slice(0, 5).map((entry, i) => (
                  <div key={entry.agentId || i} className="mb-5">
                    <div className="flex justify-between items-baseline mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-stone">
                          {entry.agent}
                        </span>
                        <span className="inline-block px-2.5 py-0.5 bg-gold/[0.08] border border-border rounded text-[11px] text-text-muted">
                          {entry.alignment}
                        </span>
                      </div>
                      <div className={`text-xl font-bold font-mono ${scoreColor(entry.demos.composite)}`}>
                        {entry.demos.composite}
                      </div>
                    </div>

                    {/* Dimension bars */}
                    {Object.entries(entry.demos.dimensions).map(([dim, value]) => (
                      <div key={dim} className="mb-1.5">
                        <div className="flex justify-between items-center text-xs text-text-muted mb-0.5">
                          <span>{humanizeDimension(dim)}</span>
                          <span className={scoreColor(value as number)}>{value as number}</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${scoreBgColor(value as number)}`}
                            style={{ width: `${value}%` }}
                          />
                        </div>
                      </div>
                    ))}

                    {i < Math.min(scores.length, 5) - 1 && (
                      <div className="h-px bg-border my-5" />
                    )}
                  </div>
                ))}
              </>
            ) : (
              <div className="text-[13px] text-text-muted/60 italic">
                Calculating DEMOS scores...
              </div>
            )}
          </div>

          {/* Package Summary */}
          <div className="bg-white/[0.03] border border-border rounded-lg p-7 mb-6">
            <h2 className="font-serif text-xl font-normal text-stone mb-1">
              Training Package
            </h2>
            <p className="text-[13px] text-text-muted mb-6">
              Review your configuration before exporting.
            </p>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { value: currentModel?.params ?? '--', label: 'Model Size' },
                { value: currentPreset?.vram ?? '--', label: 'Target VRAM' },
                { value: currentPreset?.framework ?? '--', label: 'Framework' },
                { value: currentPreset?.estimatedTime ?? '--', label: 'Est. Time' },
              ].map(({ value, label }) => (
                <div
                  key={label}
                  className="text-center p-3.5 bg-white/[0.02] border border-border rounded"
                >
                  <div className="text-lg font-semibold text-stone font-mono mb-0.5">
                    {value}
                  </div>
                  <div className="text-[10px] text-text-muted uppercase tracking-wider">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <div className="h-px bg-border my-5" />

            {/* Package contents */}
            <div className="block text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-2">
              Package Contents
            </div>
            <div className="font-mono text-xs leading-8 text-text-muted">
              {[
                ['demos-training-data.jsonl', 'Curated training dataset'],
                ['demos-scores.json', 'Baseline DEMOS benchmark scores'],
                [`train_demos_${currentPreset?.framework ?? 'config'}.*`, 'Training script / config'],
                ['Modelfile', 'Ollama import with optimized system prompt'],
                ['deploy.sh', 'One-command setup and training'],
                ['README.md', 'Documentation and quick start'],
              ].map(([name, desc]) => (
                <div key={name}>
                  <span className="text-stone">{name}</span>
                  <span className="text-text-muted/50 ml-2">&mdash; {desc}</span>
                </div>
              ))}
            </div>

            <div className="h-px bg-border my-5" />

            {/* Export controls */}
            <div className="flex gap-3 items-center">
              <button
                className="px-6 py-2.5 bg-white/10 border border-border rounded text-stone text-sm font-medium transition-all hover:bg-white/15"
                onClick={() => setStep(2)}
              >
                &larr; Back
              </button>
              <button
                className="px-8 py-3 bg-gold/[0.18] border border-gold/30 rounded text-stone text-sm font-semibold transition-all hover:bg-gold/25 disabled:opacity-40 disabled:cursor-not-allowed"
                disabled={exportStatus === 'generating'}
                onClick={handleExport}
              >
                {exportStatus === 'generating'
                  ? 'Generating...'
                  : exportStatus === 'ready'
                    ? 'Download Again'
                    : 'Export Training Package'}
              </button>
              {exportStatus !== 'idle' && (
                <span
                  className={`inline-block px-2.5 py-1 rounded text-[11px] font-semibold border ${
                    exportStatus === 'generating'
                      ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/25'
                      : exportStatus === 'ready'
                        ? 'bg-green-500/10 text-green-400 border-green-500/25'
                        : 'bg-red-500/10 text-red-400 border-red-500/25'
                  }`}
                >
                  {exportStatus === 'generating' && 'Building package...'}
                  {exportStatus === 'ready' && 'Package downloaded'}
                  {exportStatus === 'error' && 'Export failed'}
                </span>
              )}
            </div>
          </div>

          {/* Post-export instructions */}
          {exportStatus === 'ready' && (
            <div className="bg-white/[0.03] border border-border rounded-lg p-7 mb-6">
              <h2 className="font-serif text-xl font-normal text-stone mb-4">
                Next Steps
              </h2>
              <div className="font-mono text-[13px] leading-7 text-text-muted">
                <div className="text-stone mb-1"># 1. Unzip and enter package directory</div>
                <div>unzip demos-training-*.zip && cd demos-training-package</div>
                <br />
                <div className="text-stone mb-1"># 2. Run the deploy script</div>
                <div>chmod +x deploy.sh && ./deploy.sh</div>
                <br />
                <div className="text-stone mb-1"># 3. Test the fine-tuned model</div>
                <div>ollama run demos-agent</div>
                <br />
                <div className="text-stone mb-1"># 4. Re-inject into Agora Bench</div>
                <div># Create a new agent at agorabench.com/profile</div>
                <div># Set AI Provider &rarr; ollama, Model override &rarr; demos-agent</div>
                <div># Run new simulation cycle and compare DEMOS scores</div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div className="text-center py-8 text-xs text-text-muted/40 italic">
        <div className="mb-1">
          DEMOS &mdash; Decision Evaluation for Multi-Agent Output Score
        </div>
        <div>
          Agora Bench &rarr; Autonomous AI Democracy &rarr; Powered by the Agora Ecosystem
        </div>
      </div>
    </div>
  );
}
