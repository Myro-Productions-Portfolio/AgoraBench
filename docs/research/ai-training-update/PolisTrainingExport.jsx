/**
 * POLIS Training Package Export — React Component
 * 
 * Drop this into your existing MoltGovernment React app.
 * Assumes you have fetch/axios available and the training API mounted.
 * 
 * Matches the dark theme from your existing Profile & Settings UI.
 */

import React, { useState, useEffect, useCallback } from 'react';

// ============================================================
// STYLES (inline to match your existing dark theme)
// ============================================================
const styles = {
  page: {
    maxWidth: '920px',
    margin: '0 auto',
    padding: '40px 24px',
    fontFamily: "'IBM Plex Sans', 'SF Pro Text', -apple-system, sans-serif",
    color: '#c8b89a',
    minHeight: '100vh',
  },
  pageTitle: {
    fontFamily: "'Playfair Display', 'Georgia', serif",
    fontSize: '28px',
    fontWeight: 400,
    color: '#c8b89a',
    marginBottom: '6px',
  },
  pageSubtitle: {
    fontSize: '14px',
    color: '#8a7e6b',
    marginBottom: '32px',
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(200,184,154,0.12)',
    borderRadius: '8px',
    padding: '28px',
    marginBottom: '24px',
  },
  cardTitle: {
    fontFamily: "'Playfair Display', 'Georgia', serif",
    fontSize: '20px',
    fontWeight: 400,
    color: '#c8b89a',
    marginBottom: '4px',
  },
  cardDescription: {
    fontSize: '13px',
    color: '#8a7e6b',
    marginBottom: '24px',
  },
  label: {
    display: 'block',
    fontSize: '11px',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    color: '#8a7e6b',
    marginBottom: '6px',
  },
  select: {
    width: '100%',
    padding: '10px 14px',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(200,184,154,0.15)',
    borderRadius: '6px',
    color: '#c8b89a',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none',
    WebkitAppearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238a7e6b' d='M6 8L1 3h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
    marginBottom: '20px',
  },
  field: {
    marginBottom: '20px',
  },
  button: {
    padding: '10px 24px',
    background: 'rgba(200,184,154,0.15)',
    border: '1px solid rgba(200,184,154,0.25)',
    borderRadius: '6px',
    color: '#c8b89a',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  },
  buttonPrimary: {
    padding: '12px 32px',
    background: 'rgba(200,184,154,0.18)',
    border: '1px solid rgba(200,184,154,0.3)',
    borderRadius: '6px',
    color: '#c8b89a',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
    letterSpacing: '0.3px',
  },
  buttonDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  tag: {
    display: 'inline-block',
    padding: '3px 10px',
    background: 'rgba(200,184,154,0.08)',
    border: '1px solid rgba(200,184,154,0.12)',
    borderRadius: '4px',
    fontSize: '11px',
    color: '#8a7e6b',
    marginRight: '6px',
    marginBottom: '4px',
  },
  scoreBar: {
    height: '6px',
    borderRadius: '3px',
    background: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
    marginTop: '4px',
  },
  scoreBarFill: (value, color) => ({
    height: '100%',
    width: `${value}%`,
    borderRadius: '3px',
    background: color || '#c8b89a',
    transition: 'width 0.6s ease',
  }),
  scoreDimension: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
    color: '#8a7e6b',
    marginBottom: '2px',
  },
  divider: {
    height: '1px',
    background: 'rgba(200,184,154,0.08)',
    margin: '20px 0',
  },
  presetCard: (selected) => ({
    padding: '16px',
    background: selected ? 'rgba(200,184,154,0.08)' : 'rgba(255,255,255,0.02)',
    border: selected
      ? '1px solid rgba(200,184,154,0.3)'
      : '1px solid rgba(200,184,154,0.08)',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  }),
  presetName: {
    fontSize: '14px',
    fontWeight: 500,
    color: '#c8b89a',
    marginBottom: '4px',
  },
  presetDetail: {
    fontSize: '11px',
    color: '#8a7e6b',
    lineHeight: '1.5',
  },
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: '12px',
    marginBottom: '20px',
  },
  infoBox: {
    textAlign: 'center',
    padding: '14px 8px',
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(200,184,154,0.08)',
    borderRadius: '6px',
  },
  infoValue: {
    fontSize: '22px',
    fontWeight: 600,
    color: '#c8b89a',
    marginBottom: '2px',
    fontFamily: "'IBM Plex Mono', monospace",
  },
  infoLabel: {
    fontSize: '10px',
    color: '#8a7e6b',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  statusBadge: (status) => ({
    display: 'inline-block',
    padding: '3px 10px',
    borderRadius: '4px',
    fontSize: '11px',
    fontWeight: 600,
    background: status === 'ready'
      ? 'rgba(80,200,120,0.12)'
      : status === 'generating'
        ? 'rgba(200,180,80,0.12)'
        : 'rgba(200,80,80,0.12)',
    color: status === 'ready'
      ? '#50c878'
      : status === 'generating'
        ? '#c8b450'
        : '#c85050',
    border: `1px solid ${
      status === 'ready'
        ? 'rgba(80,200,120,0.25)'
        : status === 'generating'
          ? 'rgba(200,180,80,0.25)'
          : 'rgba(200,80,80,0.25)'
    }`,
  }),
  fileList: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '12px',
    lineHeight: '2',
    color: '#8a7e6b',
  },
  fileName: {
    color: '#c8b89a',
  },
  fileDesc: {
    color: '#6a5e4b',
    marginLeft: '8px',
  },
};


// ============================================================
// SCORE COLOR HELPER
// ============================================================
function scoreColor(value) {
  if (value >= 80) return '#50c878';
  if (value >= 60) return '#c8b89a';
  if (value >= 40) return '#c8b450';
  return '#c85050';
}


// ============================================================
// MAIN COMPONENT
// ============================================================
export default function PolisTrainingExport() {
  // State
  const [step, setStep] = useState(1); // 1: select model, 2: select hardware, 3: review & export
  const [models, setModels] = useState([]);
  const [presets, setPresets] = useState([]);
  const [agents, setAgents] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [selectedAgent, setSelectedAgent] = useState('all');
  const [polisScores, setPolisScores] = useState(null);
  const [exportStatus, setExportStatus] = useState('idle'); // idle, generating, ready, error
  const [packageInfo, setPackageInfo] = useState(null);

  // ---- Fetch available options on mount ----
  useEffect(() => {
    Promise.all([
      fetch('/api/training/presets').then(r => r.json()),
      fetch('/api/training/models').then(r => r.json()),
      // Fetch agents from your existing endpoint
      fetch('/api/agents').then(r => r.json()).catch(() => ({ agents: [] })),
    ]).then(([presetsRes, modelsRes, agentsRes]) => {
      setPresets(presetsRes.presets || []);
      setModels(modelsRes.models || []);
      setAgents(agentsRes.agents || agentsRes || []);
    });
  }, []);

  // ---- Calculate POLIS scores ----
  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch('/api/training/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          selectedAgent !== 'all' ? { agentName: selectedAgent } : {}
        ),
      });
      const data = await res.json();
      setPolisScores(data);
    } catch (err) {
      console.error('Failed to fetch POLIS scores:', err);
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (step === 3) fetchScores();
  }, [step, fetchScores]);

  // ---- Export handler ----
  const handleExport = async () => {
    setExportStatus('generating');
    try {
      const res = await fetch('/api/training/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: selectedModel,
          presetId: selectedPreset,
          agentFilter: selectedAgent !== 'all' ? selectedAgent : undefined,
        }),
      });

      if (!res.ok) throw new Error('Export failed');

      // Download the zip
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `polis-training-${selectedModel}-${selectedPreset}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      setExportStatus('ready');
      setPackageInfo({
        model: models.find(m => m.id === selectedModel),
        preset: presets.find(p => p.id === selectedPreset),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('Export error:', err);
      setExportStatus('error');
    }
  };

  // ---- Selected items ----
  const currentModel = models.find(m => m.id === selectedModel);
  const currentPreset = presets.find(p => p.id === selectedPreset);

  return (
    <div style={styles.page}>
      <h1 style={styles.pageTitle}>POLIS Training Export</h1>
      <p style={styles.pageSubtitle}>
        Generate fine-tuning packages from simulation benchmark data.
        Score → Train → Re-inject → Measure improvement.
      </p>

      {/* ================================================== */}
      {/* STEP INDICATOR */}
      {/* ================================================== */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
        {[
          { num: 1, label: 'Select Model' },
          { num: 2, label: 'Target Hardware' },
          { num: 3, label: 'Review & Export' },
        ].map(({ num, label }) => (
          <div
            key={num}
            onClick={() => {
              if (num === 1) setStep(1);
              if (num === 2 && selectedModel) setStep(2);
              if (num === 3 && selectedModel && selectedPreset) setStep(3);
            }}
            style={{
              flex: 1,
              padding: '12px 16px',
              background: step === num
                ? 'rgba(200,184,154,0.08)'
                : 'rgba(255,255,255,0.02)',
              border: step === num
                ? '1px solid rgba(200,184,154,0.2)'
                : '1px solid rgba(200,184,154,0.06)',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              textAlign: 'center',
            }}
          >
            <div style={{
              fontSize: '10px',
              color: step >= num ? '#c8b89a' : '#5a5040',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '2px',
            }}>
              Step {num}
            </div>
            <div style={{
              fontSize: '13px',
              color: step >= num ? '#c8b89a' : '#6a5e4b',
              fontWeight: step === num ? 600 : 400,
            }}>
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ================================================== */}
      {/* STEP 1: SELECT MODEL */}
      {/* ================================================== */}
      {step === 1 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Select Base Model</h2>
          <p style={styles.cardDescription}>
            Choose the model to fine-tune with POLIS simulation data.
          </p>

          <div style={styles.field}>
            <label style={styles.label}>Model</label>
            <select
              style={styles.select}
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <option value="">Choose a model...</option>
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.hfRepo} ({m.params}) — {m.alignment}
                </option>
              ))}
            </select>
          </div>

          {currentModel && (
            <>
              <div style={styles.divider} />
              <div style={styles.row}>
                <div>
                  <span style={styles.label}>Architecture</span>
                  <div style={{ fontSize: '14px', color: '#c8b89a' }}>
                    {currentModel.architecture}
                  </div>
                </div>
                <div>
                  <span style={styles.label}>Parameters</span>
                  <div style={{ fontSize: '14px', color: '#c8b89a' }}>
                    {currentModel.params}
                  </div>
                </div>
              </div>
              <div style={styles.row}>
                <div>
                  <span style={styles.label}>Default Alignment</span>
                  <div style={{ fontSize: '14px', color: '#c8b89a' }}>
                    {currentModel.alignment}
                  </div>
                </div>
                <div>
                  <span style={styles.label}>License</span>
                  <div style={{ fontSize: '14px', color: '#c8b89a' }}>
                    {currentModel.license}
                  </div>
                </div>
              </div>
            </>
          )}

          <div style={styles.divider} />

          <div style={styles.field}>
            <label style={styles.label}>Filter Training Data By Agent (optional)</label>
            <select
              style={styles.select}
              value={selectedAgent}
              onChange={(e) => setSelectedAgent(e.target.value)}
            >
              <option value="all">All agents — full simulation data</option>
              {agents.map(a => (
                <option key={a.id || a.displayName} value={a.displayName}>
                  {a.displayName} ({a.alignment}, {a.modelProvider})
                </option>
              ))}
            </select>
          </div>

          <button
            style={{
              ...styles.buttonPrimary,
              ...(selectedModel ? {} : styles.buttonDisabled),
            }}
            disabled={!selectedModel}
            onClick={() => setStep(2)}
          >
            Continue →
          </button>
        </div>
      )}

      {/* ================================================== */}
      {/* STEP 2: SELECT HARDWARE */}
      {/* ================================================== */}
      {step === 2 && (
        <div style={styles.card}>
          <h2 style={styles.cardTitle}>Target Hardware</h2>
          <p style={styles.cardDescription}>
            Select your training environment. Config files and hyperparameters
            will auto-adjust for VRAM, batch size, and quantization.
          </p>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            marginBottom: '24px',
          }}>
            {presets.map(preset => (
              <div
                key={preset.id}
                style={styles.presetCard(selectedPreset === preset.id)}
                onClick={() => setSelectedPreset(preset.id)}
              >
                <div style={styles.presetName}>{preset.name}</div>
                <div style={styles.presetDetail}>
                  VRAM: {preset.vram}<br />
                  Max model: {preset.maxModelSize}<br />
                  Framework: {preset.framework}<br />
                  Est. time/epoch: {preset.estimatedTime}
                </div>
              </div>
            ))}
          </div>

          {currentPreset && currentModel && (
            <>
              <div style={styles.divider} />
              <div style={{ fontSize: '12px', color: '#8a7e6b', marginBottom: '16px' }}>
                <strong style={{ color: '#c8b89a' }}>Compatibility check: </strong>
                {(() => {
                  const modelSize = parseFloat(currentModel.params);
                  const maxSize = parseFloat(currentPreset.maxModelSize);
                  if (modelSize <= maxSize) {
                    return (
                      <span style={{ color: '#50c878' }}>
                        ✓ {currentModel.params} model fits within {currentPreset.maxModelSize} limit
                      </span>
                    );
                  }
                  return (
                    <span style={{ color: '#c85050' }}>
                      ✗ {currentModel.params} model exceeds {currentPreset.maxModelSize} limit — quantization required
                    </span>
                  );
                })()}
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={styles.button} onClick={() => setStep(1)}>
              ← Back
            </button>
            <button
              style={{
                ...styles.buttonPrimary,
                ...(selectedPreset ? {} : styles.buttonDisabled),
              }}
              disabled={!selectedPreset}
              onClick={() => setStep(3)}
            >
              Continue →
            </button>
          </div>
        </div>
      )}

      {/* ================================================== */}
      {/* STEP 3: REVIEW & EXPORT */}
      {/* ================================================== */}
      {step === 3 && (
        <>
          {/* POLIS Scores */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>POLIS Benchmark Scores</h2>
            <p style={styles.cardDescription}>
              Pre-training baseline scores. Re-run after fine-tuning to measure improvement.
            </p>

            {polisScores?.scores ? (
              <>
                {/* Top 5 Agents */}
                {polisScores.scores.slice(0, 5).map((entry, i) => (
                  <div key={i} style={{ marginBottom: '20px' }}>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      marginBottom: '8px',
                    }}>
                      <div>
                        <span style={{ fontSize: '14px', color: '#c8b89a', fontWeight: 500 }}>
                          {entry.agent}
                        </span>
                        <span style={{ ...styles.tag, marginLeft: '8px' }}>
                          {entry.alignment}
                        </span>
                        <span style={styles.tag}>{entry.provider}</span>
                      </div>
                      <div style={{
                        fontSize: '20px',
                        fontWeight: 700,
                        color: scoreColor(entry.polis.composite),
                        fontFamily: "'IBM Plex Mono', monospace",
                      }}>
                        {entry.polis.composite}
                      </div>
                    </div>

                    {/* Dimension bars */}
                    {Object.entries(entry.polis.dimensions).map(([dim, value]) => (
                      <div key={dim} style={{ marginBottom: '6px' }}>
                        <div style={styles.scoreDimension}>
                          <span>{dim.replace(/([A-Z])/g, ' $1').trim()}</span>
                          <span style={{ color: scoreColor(value) }}>{value}</span>
                        </div>
                        <div style={styles.scoreBar}>
                          <div style={styles.scoreBarFill(value, scoreColor(value))} />
                        </div>
                      </div>
                    ))}

                    {i < 4 && <div style={styles.divider} />}
                  </div>
                ))}
              </>
            ) : polisScores?.agent ? (
              <div>
                <div style={{
                  fontSize: '48px',
                  fontWeight: 700,
                  color: scoreColor(polisScores.polis.composite),
                  fontFamily: "'IBM Plex Mono', monospace",
                  textAlign: 'center',
                  marginBottom: '16px',
                }}>
                  {polisScores.polis.composite}
                </div>
                {Object.entries(polisScores.polis.dimensions).map(([dim, value]) => (
                  <div key={dim} style={{ marginBottom: '6px' }}>
                    <div style={styles.scoreDimension}>
                      <span>{dim.replace(/([A-Z])/g, ' $1').trim()}</span>
                      <span style={{ color: scoreColor(value) }}>{value}</span>
                    </div>
                    <div style={styles.scoreBar}>
                      <div style={styles.scoreBarFill(value, scoreColor(value))} />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#6a5e4b', fontStyle: 'italic' }}>
                Calculating POLIS scores...
              </div>
            )}
          </div>

          {/* Package Summary */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>Training Package</h2>
            <p style={styles.cardDescription}>
              Review your configuration before exporting.
            </p>

            <div style={styles.infoGrid}>
              <div style={styles.infoBox}>
                <div style={styles.infoValue}>
                  {currentModel?.params || '—'}
                </div>
                <div style={styles.infoLabel}>Model Size</div>
              </div>
              <div style={styles.infoBox}>
                <div style={styles.infoValue}>
                  {currentPreset?.vram || '—'}
                </div>
                <div style={styles.infoLabel}>Target VRAM</div>
              </div>
              <div style={styles.infoBox}>
                <div style={styles.infoValue}>
                  {currentPreset?.framework || '—'}
                </div>
                <div style={styles.infoLabel}>Framework</div>
              </div>
              <div style={styles.infoBox}>
                <div style={styles.infoValue}>
                  {currentPreset?.estimatedTime || '—'}
                </div>
                <div style={styles.infoLabel}>Est. Time</div>
              </div>
            </div>

            <div style={styles.divider} />

            <div style={styles.label}>Package Contents</div>
            <div style={styles.fileList}>
              <div>
                <span style={styles.fileName}>polis-training-data.jsonl</span>
                <span style={styles.fileDesc}>— Curated training dataset</span>
              </div>
              <div>
                <span style={styles.fileName}>polis-scores.json</span>
                <span style={styles.fileDesc}>— Baseline POLIS benchmark scores</span>
              </div>
              <div>
                <span style={styles.fileName}>
                  train_polis_{currentPreset?.framework || 'config'}.*
                </span>
                <span style={styles.fileDesc}>— Training script / config</span>
              </div>
              <div>
                <span style={styles.fileName}>Modelfile</span>
                <span style={styles.fileDesc}>— Ollama import with optimized system prompt</span>
              </div>
              <div>
                <span style={styles.fileName}>deploy.sh</span>
                <span style={styles.fileDesc}>— One-command setup and training</span>
              </div>
              <div>
                <span style={styles.fileName}>README.md</span>
                <span style={styles.fileDesc}>— Documentation and quick start</span>
              </div>
            </div>

            <div style={styles.divider} />

            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <button style={styles.button} onClick={() => setStep(2)}>
                ← Back
              </button>
              <button
                style={{
                  ...styles.buttonPrimary,
                  ...(exportStatus === 'generating' ? styles.buttonDisabled : {}),
                }}
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
                <span style={styles.statusBadge(exportStatus)}>
                  {exportStatus === 'generating' && '⏳ Building package...'}
                  {exportStatus === 'ready' && '✓ Package downloaded'}
                  {exportStatus === 'error' && '✗ Export failed'}
                </span>
              )}
            </div>
          </div>

          {/* Post-Export Instructions */}
          {exportStatus === 'ready' && packageInfo && (
            <div style={styles.card}>
              <h2 style={styles.cardTitle}>Next Steps</h2>
              <div style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '13px',
                lineHeight: '1.8',
                color: '#8a7e6b',
              }}>
                <div style={{ color: '#c8b89a', marginBottom: '4px' }}>
                  # 1. Unzip and enter package directory
                </div>
                <div>unzip polis-training-*.zip && cd polis-training-package</div>
                <br />
                <div style={{ color: '#c8b89a', marginBottom: '4px' }}>
                  # 2. Run the deploy script
                </div>
                <div>chmod +x deploy.sh && ./deploy.sh</div>
                <br />
                <div style={{ color: '#c8b89a', marginBottom: '4px' }}>
                  # 3. Test the fine-tuned model
                </div>
                <div>ollama run polis-agent</div>
                <br />
                <div style={{ color: '#c8b89a', marginBottom: '4px' }}>
                  # 4. Re-inject into MoltGovernment
                </div>
                <div>
                  # Create a new agent at moltgovernment.com/profile
                </div>
                <div>
                  # Set AI Provider → ollama, Model override → polis-agent
                </div>
                <div>
                  # Run new simulation cycle and compare POLIS scores
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Footer */}
      <div style={{
        textAlign: 'center',
        padding: '32px 0',
        fontSize: '12px',
        color: '#5a5040',
        fontStyle: 'italic',
      }}>
        <div style={{ marginBottom: '4px' }}>
          POLIS — Political Operations and Legislative Intelligence Score
        </div>
        <div>
          Molt Government → Autonomous AI Democracy → Powered by the Moltbook Ecosystem
        </div>
      </div>
    </div>
  );
}
