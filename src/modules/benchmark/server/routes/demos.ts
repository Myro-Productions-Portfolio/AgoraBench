import { Router } from 'express';
import { db } from '../../../../db/connection';
import { agents, agentDecisions, billVotes, bills, approvalEvents } from '../../../../db/schema/index';
import { eq } from 'drizzle-orm';
import archiver from 'archiver';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const router = Router();

// ============================================================
// HARDWARE PRESETS (full training config from prototype)
// ============================================================
const HARDWARE_PRESETS = {
  dgx_spark: {
    name: 'NVIDIA DGX Spark',
    vram: '128GB',
    gpuModel: 'GB10 Grace Blackwell',
    maxModelSize: '70B',
    framework: 'nemo' as const,
    estimatedTime: '~15 min for 1.8B, ~2hr for 8B',
    batchSize: 16,
    gradientAccumulation: 2,
    quantization: null as string | null,
    config: {
      precision: 'bf16',
      maxSeqLength: 4096,
      loraRank: 64,
      loraAlpha: 128,
      loraDropout: 0.05,
      learningRate: 2e-4,
      warmupSteps: 100,
      epochs: 3,
      optimizer: 'adamw_torch',
      schedulerType: 'cosine',
    },
  },
  single_gpu_24gb: {
    name: 'Single GPU (24GB) — RTX 4090 / A5000',
    vram: '24GB',
    gpuModel: 'RTX 4090 / A5000',
    maxModelSize: '8B (quantized)',
    framework: 'unsloth' as const,
    estimatedTime: '~45 min for 1.8B, ~4hr for 8B',
    batchSize: 4,
    gradientAccumulation: 8,
    quantization: 'qlora-4bit',
    config: {
      precision: 'float16',
      maxSeqLength: 2048,
      loraRank: 32,
      loraAlpha: 64,
      loraDropout: 0.05,
      learningRate: 2e-4,
      warmupSteps: 50,
      epochs: 3,
      optimizer: 'paged_adamw_8bit',
      schedulerType: 'cosine',
      loadIn4bit: true,
    },
  },
  single_gpu_12gb: {
    name: 'Single GPU (12GB) — RTX 4070 / T4',
    vram: '12GB',
    gpuModel: 'RTX 4070 / T4',
    maxModelSize: '3B (quantized)',
    framework: 'unsloth' as const,
    estimatedTime: '~30 min for 1.8B',
    batchSize: 2,
    gradientAccumulation: 16,
    quantization: 'qlora-4bit',
    config: {
      precision: 'float16',
      maxSeqLength: 1024,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.1,
      learningRate: 1e-4,
      warmupSteps: 30,
      epochs: 5,
      optimizer: 'paged_adamw_8bit',
      schedulerType: 'cosine',
      loadIn4bit: true,
    },
  },
  cloud_a100: {
    name: 'Cloud A100 (80GB) — Lambda / RunPod / AWS',
    vram: '80GB',
    gpuModel: 'A100 80GB',
    maxModelSize: '70B (quantized)',
    framework: 'axolotl' as const,
    estimatedTime: '~10 min for 1.8B, ~1hr for 8B',
    batchSize: 8,
    gradientAccumulation: 4,
    quantization: null as string | null,
    config: {
      precision: 'bf16',
      maxSeqLength: 4096,
      loraRank: 64,
      loraAlpha: 128,
      loraDropout: 0.05,
      learningRate: 2e-4,
      warmupSteps: 100,
      epochs: 3,
      optimizer: 'adamw_torch',
      schedulerType: 'cosine',
    },
  },
  mac_m4_pro: {
    name: 'Mac Mini M4 Pro (24GB Unified)',
    vram: '24GB unified',
    gpuModel: 'Apple M4 Pro',
    maxModelSize: '8B (quantized)',
    framework: 'mlx-lm' as const,
    estimatedTime: '~2hr for 1.8B, ~8hr for 8B',
    batchSize: 2,
    gradientAccumulation: 16,
    quantization: 'qlora-4bit',
    config: {
      precision: 'float16',
      maxSeqLength: 2048,
      loraRank: 16,
      loraAlpha: 32,
      loraDropout: 0.05,
      learningRate: 1e-4,
      warmupSteps: 50,
      epochs: 3,
      optimizer: 'adam',
      schedulerType: 'cosine',
    },
  },
};

type PresetId = keyof typeof HARDWARE_PRESETS;
type Preset = (typeof HARDWARE_PRESETS)[PresetId];

// ============================================================
// MODEL REGISTRY
// ============================================================
const MODEL_REGISTRY = {
  politics_left_deepseek: {
    hfRepo: 'vsingh1221/politics_left_deepseek',
    architecture: 'qwen2',
    params: '1.8B',
    baseModel: 'deepseek',
    alignment: 'progressive',
    license: 'MIT',
  },
  politics_center_deepseek: {
    hfRepo: 'vsingh1221/politics_center_deepseek',
    architecture: 'qwen2',
    params: '1.8B',
    baseModel: 'deepseek',
    alignment: 'moderate',
    license: 'MIT',
  },
  politics_right_deepseek: {
    hfRepo: 'vsingh1221/politics_right_deepseek',
    architecture: 'qwen2',
    params: '1.8B',
    baseModel: 'deepseek',
    alignment: 'conservative',
    license: 'MIT',
  },
  'llama3.1-8b-political-subreddits': {
    hfRepo: 'mradermacher/llama3.1-8b-instruct-political-subreddits-i1-GGUF',
    architecture: 'llama',
    params: '8B',
    baseModel: 'llama3.1',
    alignment: 'general',
    license: 'Apache-2.0',
  },
};

type ModelId = keyof typeof MODEL_REGISTRY;
type ModelInfo = (typeof MODEL_REGISTRY)[ModelId];

// ============================================================
// DEMOS SCORE CALCULATOR
// ============================================================

const VALID_ACTIONS = new Set([
  'vote', 'propose', 'whip_signal', 'forum_post', 'campaign_speech',
  'judicial_vote', 'amendment', 'idle', 'veto', 'comment', 'follow',
  'support', 'oppose', 'amend', 'abstain',
]);

interface DecisionRow {
  parsedAction: string | null;
  parsedReasoning: string | null;
  success: boolean;
  latencyMs: number;
}

interface VoteRow {
  choice: string;
}

interface ApprovalRow {
  eventType: string;
  delta: number;
}

interface DemosResult {
  composite: number;
  dimensions: {
    decisionCoherence: number;
    reasoningQuality: number;
    legislativeIndependence: number;
    whipDisciplineBalance: number;
    latencyEfficiency: number;
    approvalStability: number;
    participationRate: number;
  };
  meta: {
    totalDecisions: number;
    totalVotes: number;
    yeaRate: number;
    avgLatencyMs: number;
    successRate: number;
  };
}

function calculateDemosScore(
  decisions: DecisionRow[],
  votes: VoteRow[],
  approvals: ApprovalRow[],
): DemosResult {
  const coherent = decisions.filter((d) => d.parsedAction && VALID_ACTIONS.has(d.parsedAction));
  const decisionCoherence = decisions.length > 0
    ? (coherent.length / decisions.length) * 100
    : 0;

  const withReasoning = decisions.filter((d) => (d.parsedReasoning?.trim()?.length ?? 0) > 20);
  const reasoningQuality = decisions.length > 0
    ? (withReasoning.length / decisions.length) * 100
    : 0;

  const yeaVotes = votes.filter((v) => v.choice === 'yea').length;
  const yeaPct = votes.length > 0 ? yeaVotes / votes.length : 1;
  const legislativeIndependence = Math.max(0, 100 - Math.abs(yeaPct - 0.55) * 200);

  const followed = approvals.filter((e) => e.eventType === 'whip_followed').length;
  const defected = approvals.filter((e) => e.eventType === 'whip_defected').length;
  const totalWhip = followed + defected;
  const compliancePct = totalWhip > 0 ? followed / totalWhip : 0.5;
  const whipDisciplineBalance = Math.max(0, 100 - Math.abs(compliancePct - 0.87) * 200);

  const latencies = decisions.filter((d) => d.latencyMs > 0).map((d) => d.latencyMs);
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 2000;
  let latencyEfficiency = 100;
  if (avgLatency < 200) latencyEfficiency = 50;
  else if (avgLatency < 500) latencyEfficiency = 80;
  else if (avgLatency <= 2000) latencyEfficiency = 100;
  else if (avgLatency <= 5000) latencyEfficiency = 70;
  else latencyEfficiency = 40;

  const approvalDeltas = approvals.map((e) => Math.abs(e.delta));
  const avgVolatility = approvalDeltas.length > 0
    ? approvalDeltas.reduce((a, b) => a + b, 0) / approvalDeltas.length
    : 5;
  const approvalStability = Math.max(0, 100 - (avgVolatility - 2) * 15);

  const participationRate = Math.min(100, (decisions.length / 400) * 100);

  const composite = Math.round(
    decisionCoherence * 0.20 +
    reasoningQuality * 0.15 +
    legislativeIndependence * 0.20 +
    whipDisciplineBalance * 0.10 +
    latencyEfficiency * 0.10 +
    approvalStability * 0.10 +
    participationRate * 0.15,
  );

  return {
    composite,
    dimensions: {
      decisionCoherence: Math.round(decisionCoherence),
      reasoningQuality: Math.round(reasoningQuality),
      legislativeIndependence: Math.round(legislativeIndependence),
      whipDisciplineBalance: Math.round(whipDisciplineBalance),
      latencyEfficiency: Math.round(latencyEfficiency),
      approvalStability: Math.round(approvalStability),
      participationRate: Math.round(participationRate),
    },
    meta: {
      totalDecisions: decisions.length,
      totalVotes: votes.length,
      yeaRate: Math.round(yeaPct * 100),
      avgLatencyMs: Math.round(avgLatency),
      successRate: decisions.length > 0
        ? Math.round((decisions.filter((d) => d.success).length / decisions.length) * 100)
        : 0,
    },
  };
}

// ============================================================
// TRAINING DATASET BUILDER
// ============================================================

interface FullDecisionRow extends DecisionRow {
  phase: string | null;
}

interface TrainingPair {
  system: string;
  instruction: string;
  response: string;
  metadata: {
    phase: string;
    action: string;
    success?: boolean;
    latencyMs?: number;
    choice?: string;
    source: string;
  };
}

function buildGovernanceSystemPrompt(phase: string | null): string {
  const prompts: Record<string, string> = {
    bill_proposal: 'You are a legislator in a democratic government. Your role is to propose legislation that addresses real policy needs. Consider budget constraints, constitutional limits, and constituent impact. Respond with a structured action and detailed reasoning.',
    bill_voting: 'You are a legislator evaluating proposed legislation. Analyze bills critically — consider funding sources, enforcement mechanisms, unintended consequences, and alignment with your political philosophy. Do not default to approval.',
    forum_post: 'You are a public official engaging in policy discourse. Share substantive positions backed by evidence and reasoning. Engage with opposing viewpoints constructively.',
    campaigning: 'You are a political candidate. Articulate clear policy positions, differentiate yourself from opponents, and address constituent concerns directly.',
    judicial_review: 'You are a judicial official reviewing legislation for constitutional compliance and legal coherence. Apply strict legal analysis.',
    whip_signal: 'You are a party leader coordinating voting strategy. Issue guidance that balances party unity with individual conscience. Acknowledge when members may have legitimate reasons to defect.',
  };
  return prompts[phase ?? ''] ?? 'You are an AI agent participating in a democratic governance simulation. Make decisions with clear reasoning.';
}

function buildPhaseInstruction(phase: string | null): string {
  switch (phase) {
    case 'bill_proposal':
      return 'Propose legislation or take action on a pending bill. Provide your action type and detailed reasoning.';
    case 'bill_voting':
      return 'A bill is before you for a vote. Analyze it and decide: vote yea, vote nay, propose an amendment, or abstain. Explain your reasoning.';
    case 'forum_post':
      return 'Engage in public policy discourse. Share your position on a current issue with substantive reasoning.';
    case 'campaigning':
      return 'Deliver a campaign message. Articulate your policy positions and vision.';
    case 'judicial_review':
      return 'Review pending legislation for legal and constitutional compliance. Issue your assessment.';
    default:
      return 'Take your next action in the governance simulation. Provide structured output with reasoning.';
  }
}

function normalizeAction(rawAction: string | null): string {
  const normalized = rawAction?.toLowerCase().trim() || 'idle';
  if (normalized.includes('amend')) return 'amendment';
  if (normalized.includes('follow') && normalized.includes('party')) return 'follow_party';
  if (['yea', 'aye', 'yes', 'yay'].includes(normalized)) return 'vote';
  if (['nay'].includes(normalized)) return 'vote';
  if (normalized.includes('voting')) return 'vote';
  if (normalized.includes('submit')) return 'propose';
  if (normalized.includes('introduce')) return 'propose';
  return normalized;
}

interface VoteWithBill {
  choice: string;
  billTitle: string;
  committee: string;
  sponsorName: string;
  billType: string;
}

function buildTrainingDataset(
  decisions: FullDecisionRow[],
  votesWithBills: VoteWithBill[],
  maxSamples: number,
): TrainingPair[] {
  const trainingPairs: TrainingPair[] = [];

  // Decision training pairs
  for (const decision of decisions.slice(0, maxSamples)) {
    if (!decision.parsedReasoning?.trim()) continue;

    trainingPairs.push({
      system: buildGovernanceSystemPrompt(decision.phase),
      instruction: buildPhaseInstruction(decision.phase),
      response: JSON.stringify({
        action: normalizeAction(decision.parsedAction),
        reasoning: decision.parsedReasoning,
      }),
      metadata: {
        phase: decision.phase ?? 'unknown',
        action: decision.parsedAction ?? 'unknown',
        success: decision.success,
        latencyMs: decision.latencyMs,
        source: decision.success ? 'positive' : 'negative',
      },
    });
  }

  // Voting pattern training pairs
  for (const vote of votesWithBills.slice(0, maxSamples)) {
    trainingPairs.push({
      system: 'You are a legislator evaluating proposed legislation. Analyze the bill and cast your vote with reasoning.',
      instruction: `Bill: "${vote.billTitle}"\nCommittee: ${vote.committee}\nSponsor: ${vote.sponsorName}\nType: ${vote.billType}\n\nCast your vote: yea, nay, or abstain. Explain your reasoning.`,
      response: JSON.stringify({
        action: 'vote',
        choice: vote.choice,
        reasoning: `Vote cast as ${vote.choice} based on legislative analysis.`,
      }),
      metadata: {
        phase: 'bill_voting',
        action: 'vote',
        choice: vote.choice,
        source: 'voting_record',
      },
    });
  }

  return trainingPairs;
}

// ============================================================
// CONFIG GENERATORS
// ============================================================

function generateUnslothConfig(preset: Preset, modelInfo: ModelInfo, datasetPath: string): string {
  const c = preset.config;
  const loadIn4bit = 'loadIn4bit' in c ? (c as Record<string, unknown>).loadIn4bit : false;
  return `# DEMOS Training Config — Unsloth (QLoRA)
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by DEMOS Training Package Generator

from unsloth import FastLanguageModel
import torch

# ---- Model Setup ----
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="${modelInfo.hfRepo}",
    max_seq_length=${c.maxSeqLength},
    dtype=None,  # Auto-detect
    load_in_4bit=${loadIn4bit ? 'True' : 'False'},
)

model = FastLanguageModel.get_peft_model(
    model,
    r=${c.loraRank},
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
    lora_alpha=${c.loraAlpha},
    lora_dropout=${c.loraDropout},
    bias="none",
    use_gradient_checkpointing="unsloth",
    random_state=42,
)

# ---- Dataset ----
from datasets import load_dataset
dataset = load_dataset("json", data_files="${datasetPath}")

# ---- Chat Template ----
from unsloth.chat_templates import get_chat_template
tokenizer = get_chat_template(tokenizer, chat_template="chatml")

def format_demos(example):
    messages = [
        {"role": "system", "content": example["system"]},
        {"role": "user", "content": example["instruction"]},
        {"role": "assistant", "content": example["response"]},
    ]
    return {"text": tokenizer.apply_chat_template(messages, tokenize=False)}

dataset = dataset["train"].map(format_demos)

# ---- Training ----
from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=${c.maxSeqLength},
    dataset_num_proc=2,
    args=TrainingArguments(
        per_device_train_batch_size=${preset.batchSize},
        gradient_accumulation_steps=${preset.gradientAccumulation},
        warmup_steps=${c.warmupSteps},
        num_train_epochs=${c.epochs},
        learning_rate=${c.learningRate},
        fp16=${c.precision === 'float16' ? 'True' : 'False'},
        bf16=${c.precision === 'bf16' ? 'True' : 'False'},
        logging_steps=10,
        optim="${c.optimizer}",
        lr_scheduler_type="${c.schedulerType}",
        seed=42,
        output_dir="./demos-finetune-output",
        report_to="none",
    ),
)

# ---- Train ----
trainer_stats = trainer.train()

# ---- Save ----
model.save_pretrained("./demos-finetune-output/final")
tokenizer.save_pretrained("./demos-finetune-output/final")

# ---- Export to GGUF for Ollama ----
model.save_pretrained_gguf(
    "./demos-finetune-output/gguf",
    tokenizer,
    quantization_method="q4_k_m",
)

print("\\nDEMOS fine-tune complete!")
print(f"Training loss: {trainer_stats.training_loss:.4f}")
print(f"Model saved to: ./demos-finetune-output/final")
print(f"GGUF exported to: ./demos-finetune-output/gguf")
`;
}

function generateAxolotlConfig(preset: Preset, modelInfo: ModelInfo, datasetPath: string): string {
  const c = preset.config;
  return `# DEMOS Training Config — Axolotl
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by DEMOS Training Package Generator

base_model: ${modelInfo.hfRepo}
model_type: ${modelInfo.architecture === 'qwen2' ? 'AutoModelForCausalLM' : 'LlamaForCausalLM'}

load_in_8bit: false
load_in_4bit: ${preset.quantization ? 'true' : 'false'}

adapter: lora
lora_r: ${c.loraRank}
lora_alpha: ${c.loraAlpha}
lora_dropout: ${c.loraDropout}
lora_target_linear: true

datasets:
  - path: ${datasetPath}
    type: sharegpt
    conversation: chatml

dataset_prepared_path: ./prepared-data
val_set_size: 0.05
output_dir: ./demos-finetune-output

sequence_len: ${c.maxSeqLength}
sample_packing: true
pad_to_sequence_len: true

wandb_project: demos-benchmark
wandb_run_id: demos-\${date}

gradient_accumulation_steps: ${preset.gradientAccumulation}
micro_batch_size: ${preset.batchSize}
num_epochs: ${c.epochs}
optimizer: ${c.optimizer}
lr_scheduler: ${c.schedulerType}
learning_rate: ${c.learningRate}
warmup_steps: ${c.warmupSteps}

train_on_inputs: false
group_by_length: false
bf16: ${c.precision === 'bf16' ? 'auto' : 'false'}
fp16: ${c.precision === 'float16'}
tf32: false

gradient_checkpointing: true
logging_steps: 10
save_strategy: epoch
save_total_limit: 3

special_tokens:
  pad_token: "<|endoftext|>"
`;
}

function generateMLXConfig(preset: Preset, modelInfo: ModelInfo, datasetPath: string): string {
  const c = preset.config;
  return `#!/bin/bash
# DEMOS Training Config — MLX (Apple Silicon)
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by DEMOS Training Package Generator

set -e

# ---- Install ----
pip install mlx-lm

# ---- Convert model to MLX format ----
python -m mlx_lm.convert \\
  --hf-path ${modelInfo.hfRepo} \\
  --mlx-path ./mlx-model

# ---- Fine-tune ----
python -m mlx_lm.lora \\
  --model ./mlx-model \\
  --data ${datasetPath} \\
  --train \\
  --batch-size ${preset.batchSize} \\
  --lora-layers ${c.loraRank} \\
  --learning-rate ${c.learningRate} \\
  --iters 1000 \\
  --val-batches 25 \\
  --steps-per-report 10 \\
  --adapter-path ./demos-finetune-output/adapters \\
  --save-every 100

# ---- Fuse adapters ----
python -m mlx_lm.fuse \\
  --model ./mlx-model \\
  --adapter-path ./demos-finetune-output/adapters \\
  --save-path ./demos-finetune-output/fused

# ---- Test ----
python -m mlx_lm.generate \\
  --model ./demos-finetune-output/fused \\
  --prompt "You are a legislator. A bill proposes universal basic income funded by automation taxes. Vote and explain your reasoning."
`;
}

function generateNemoConfig(preset: Preset, modelInfo: ModelInfo, datasetPath: string): string {
  const c = preset.config;
  return `# DEMOS Training Config — NVIDIA NeMo (DGX)
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by DEMOS Training Package Generator

# ---- Install ----
# pip install nemo_toolkit[all]

import nemo.collections.nlp as nemo_nlp
from nemo.collections.nlp.modules.common.lm_utils import get_lm_model
from nemo.utils.exp_manager import exp_manager
from omegaconf import OmegaConf

# ---- Config ----
config = OmegaConf.create({
    "model": {
        "pretrained_model_name": "${modelInfo.hfRepo}",
        "lora": {
            "enabled": True,
            "r": ${c.loraRank},
            "alpha": ${c.loraAlpha},
            "dropout": ${c.loraDropout},
        },
    },
    "training": {
        "max_epochs": ${c.epochs},
        "learning_rate": ${c.learningRate},
        "batch_size": ${preset.batchSize},
        "gradient_accumulation": ${preset.gradientAccumulation},
        "precision": "${c.precision}",
        "optimizer": "${c.optimizer}",
        "warmup_steps": ${c.warmupSteps},
    },
    "data": {
        "train_ds": "${datasetPath}",
        "max_seq_length": ${c.maxSeqLength},
    },
    "exp_manager": {
        "exp_dir": "./demos-finetune-output",
        "name": "demos-nemo-finetune",
    }
})

print("\\nNeMo DEMOS config ready for DGX Spark")
print("Run with: python -m nemo.collections.nlp.models.language_modeling.megatron_gpt_sft \\\\")
print("  --config-path=. --config-name=demos_nemo_config")
`;
}

function generateOllamaModelfile(modelInfo: ModelInfo, systemPrompt: string): string {
  return `# DEMOS Modelfile for Ollama
# Import the fine-tuned GGUF model into Ollama
# Generated by DEMOS Training Package Generator

FROM ./demos-finetune-output/gguf/unsloth.Q4_K_M.gguf

# System prompt derived from highest-scoring DEMOS agent
SYSTEM """${systemPrompt}"""

# Parameters tuned for governance decision-making
PARAMETER temperature 0.7
PARAMETER top_p 0.9
PARAMETER top_k 40
PARAMETER repeat_penalty 1.1
PARAMETER num_ctx ${modelInfo.architecture === 'qwen2' ? 4096 : 8192}
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|endoftext|>"

# Usage:
# ollama create demos-agent -f Modelfile
# ollama run demos-agent "A bill proposes mandatory AI audits for all government systems. Vote and explain."
`;
}

function generateDeployScript(preset: Preset, modelInfo: ModelInfo): string {
  let installBlock = '';
  if (preset.framework === 'unsloth') {
    installBlock = `pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes`;
  } else if (preset.framework === 'axolotl') {
    installBlock = `pip install axolotl
pip install flash-attn --no-build-isolation`;
  } else if (preset.framework === 'mlx-lm') {
    installBlock = 'pip install mlx-lm';
  } else if (preset.framework === 'nemo') {
    installBlock = 'pip install nemo_toolkit[all]';
  }

  let trainCmd = '';
  if (preset.framework === 'unsloth') trainCmd = 'python3 train_demos_unsloth.py';
  else if (preset.framework === 'axolotl') trainCmd = 'accelerate launch -m axolotl.cli.train demos_axolotl_config.yml';
  else if (preset.framework === 'mlx-lm') trainCmd = 'bash train_demos_mlx.sh';
  else if (preset.framework === 'nemo') trainCmd = 'python3 train_demos_nemo.py';

  return `#!/bin/bash
# DEMOS Training Deploy Script
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by DEMOS Training Package Generator

set -e

echo "========================================="
echo "  DEMOS Training Package Deployer"
echo "  Model: ${modelInfo.hfRepo}"
echo "  Target: ${preset.name}"
echo "========================================="

# ---- Check Dependencies ----
echo ""
echo "[1/5] Checking dependencies..."
${installBlock}

# ---- Validate Dataset ----
echo ""
echo "[2/5] Validating training dataset..."
python3 -c "
import json
with open('demos-training-data.jsonl') as f:
    lines = f.readlines()
    print(f'  Dataset samples: {len(lines)}')
    sample = json.loads(lines[0])
    assert 'system' in sample, 'Missing system field'
    assert 'instruction' in sample, 'Missing instruction field'
    assert 'response' in sample, 'Missing response field'
    print('  Schema validation: OK')
"

# ---- Start Training ----
echo ""
echo "[3/5] Starting DEMOS fine-tune..."
${trainCmd}

# ---- Export to Ollama ----
echo ""
echo "[4/5] Importing to Ollama..."
if command -v ollama &> /dev/null; then
    ollama create demos-agent -f Modelfile
    echo "  Ollama model created: demos-agent"
else
    echo "  Ollama not found — skipping import"
    echo "  GGUF available at: ./demos-finetune-output/gguf/"
fi

# ---- Verify ----
echo ""
echo "[5/5] Running verification prompt..."
if command -v ollama &> /dev/null; then
    ollama run demos-agent "A bill proposes a 2% automation tax to fund displaced worker retraining programs. As a technocrat senator, analyze this bill and cast your vote with detailed reasoning."
fi

echo ""
echo "========================================="
echo "  DEMOS Training Complete"
echo "  Output: ./demos-finetune-output/"
echo "  Ollama: ollama run demos-agent"
echo "========================================="
`;
}

function generateReadme(preset: Preset, modelInfo: ModelInfo, scores: unknown): string {
  return `# DEMOS Training Package

## Overview
This training package was generated by the **DEMOS Benchmark** (Decision Evaluation for Multi-Agent Output Score) on [Agora Bench](https://agorabench.com).

It contains everything needed to fine-tune **${modelInfo.hfRepo}** based on governance simulation performance data.

## What's Inside

| File | Purpose |
|------|---------|
| \`demos-training-data.jsonl\` | Curated training dataset from simulation |
| \`demos-scores.json\` | DEMOS benchmark scores and dimensions |
| \`train_demos_*.py/sh/yml\` | Training script for ${preset.framework} |
| \`Modelfile\` | Ollama import config with optimized system prompt |
| \`deploy.sh\` | One-command setup and training |
| \`README.md\` | This file |

## DEMOS Scores (Pre-Training Baseline)

\`\`\`json
${JSON.stringify(scores, null, 2)}
\`\`\`

## Hardware Target
- **Device**: ${preset.name}
- **VRAM**: ${preset.vram}
- **Framework**: ${preset.framework}
- **Estimated Time**: ${preset.estimatedTime}

## Quick Start

\`\`\`bash
chmod +x deploy.sh
./deploy.sh
\`\`\`

## After Training

Re-inject the fine-tuned model back into MoltGovernment and run a new simulation cycle.
Compare pre-training vs post-training DEMOS scores to measure improvement.

\`\`\`bash
# Run in Ollama
ollama run demos-agent

# Or serve via API
ollama serve &
curl http://localhost:11434/api/generate -d '{
  "model": "demos-agent",
  "prompt": "A bill proposes mandatory AI transparency reports for all government agencies. Vote and explain."
}'
\`\`\`

## License
Training data: Generated by DEMOS simulation (MIT)
Base model: ${modelInfo.license}

---
*Generated by DEMOS — Decision Evaluation for Multi-Agent Output Score*
*[agorabench.com](https://agorabench.com)*
`;
}

// ============================================================
// ROUTES
// ============================================================

/* GET /api/demos/presets — hardware presets for training export */
router.get('/demos/presets', (_req, res) => {
  const presets = Object.entries(HARDWARE_PRESETS).map(([id, preset]) => ({
    id,
    ...preset,
  }));
  res.json({ success: true, data: { presets } });
});

/* GET /api/demos/models — available models for fine-tuning */
router.get('/demos/models', (_req, res) => {
  const models = Object.entries(MODEL_REGISTRY).map(([id, model]) => ({
    id,
    ...model,
  }));
  res.json({ success: true, data: { models } });
});

/* POST /api/demos/scores — compute DEMOS scores */
router.post('/demos/scores', async (req, res, next) => {
  try {
    const { agentId } = req.body as { agentId?: string };

    if (agentId) {
      const [agent] = await db
        .select({
          id: agents.id,
          displayName: agents.displayName,
          alignment: agents.alignment,
        })
        .from(agents)
        .where(eq(agents.id, agentId));

      if (!agent) {
        res.status(404).json({ success: false, error: 'Agent not found' });
        return;
      }

      const [decisions, votes, approvals] = await Promise.all([
        db.select({
          parsedAction: agentDecisions.parsedAction,
          parsedReasoning: agentDecisions.parsedReasoning,
          success: agentDecisions.success,
          latencyMs: agentDecisions.latencyMs,
        }).from(agentDecisions).where(eq(agentDecisions.agentId, agentId)),

        db.select({
          choice: billVotes.choice,
        }).from(billVotes).where(eq(billVotes.voterId, agentId)),

        db.select({
          eventType: approvalEvents.eventType,
          delta: approvalEvents.delta,
        }).from(approvalEvents).where(eq(approvalEvents.agentId, agentId)),
      ]);

      const demos = calculateDemosScore(decisions, votes, approvals);

      res.json({
        success: true,
        data: {
          agent: agent.displayName,
          agentId: agent.id,
          alignment: agent.alignment,
          demos,
        },
      });
      return;
    }

    // All active agents
    const allAgents = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
      })
      .from(agents)
      .where(eq(agents.isActive, true));

    const [allDecisions, allVotes, allApprovals] = await Promise.all([
      db.select({
        agentId: agentDecisions.agentId,
        parsedAction: agentDecisions.parsedAction,
        parsedReasoning: agentDecisions.parsedReasoning,
        success: agentDecisions.success,
        latencyMs: agentDecisions.latencyMs,
      }).from(agentDecisions),

      db.select({
        voterId: billVotes.voterId,
        choice: billVotes.choice,
      }).from(billVotes),

      db.select({
        agentId: approvalEvents.agentId,
        eventType: approvalEvents.eventType,
        delta: approvalEvents.delta,
      }).from(approvalEvents),
    ]);

    const decisionsByAgent = new Map<string, DecisionRow[]>();
    for (const d of allDecisions) {
      if (!d.agentId) continue;
      const arr = decisionsByAgent.get(d.agentId) ?? [];
      arr.push(d);
      decisionsByAgent.set(d.agentId, arr);
    }

    const votesByAgent = new Map<string, VoteRow[]>();
    for (const v of allVotes) {
      if (!v.voterId) continue;
      const arr = votesByAgent.get(v.voterId) ?? [];
      arr.push(v);
      votesByAgent.set(v.voterId, arr);
    }

    const approvalsByAgent = new Map<string, ApprovalRow[]>();
    for (const a of allApprovals) {
      const arr = approvalsByAgent.get(a.agentId) ?? [];
      arr.push(a);
      approvalsByAgent.set(a.agentId, arr);
    }

    const scores = allAgents.map((agent) => ({
      agent: agent.displayName,
      agentId: agent.id,
      alignment: agent.alignment,
      demos: calculateDemosScore(
        decisionsByAgent.get(agent.id) ?? [],
        votesByAgent.get(agent.id) ?? [],
        approvalsByAgent.get(agent.id) ?? [],
      ),
    }));

    scores.sort((a, b) => b.demos.composite - a.demos.composite);

    res.json({ success: true, data: { scores } });
  } catch (error) {
    next(error);
  }
});

/* POST /api/demos/export — generate and download training package ZIP */
router.post('/demos/export', async (req, res, next) => {
  let tmpDir: string | null = null;

  try {
    const { modelId, presetId, agentFilter, options = {} } = req.body as {
      modelId?: string;
      presetId?: string;
      agentFilter?: string;
      options?: { maxSamples?: number };
    };

    if (!modelId || !(modelId in MODEL_REGISTRY)) {
      res.status(400).json({ success: false, error: `Unknown model: ${modelId}` });
      return;
    }
    if (!presetId || !(presetId in HARDWARE_PRESETS)) {
      res.status(400).json({ success: false, error: `Unknown preset: ${presetId}` });
      return;
    }

    const preset = HARDWARE_PRESETS[presetId as PresetId];
    const modelInfo = MODEL_REGISTRY[modelId as ModelId];
    const maxSamples = options.maxSamples ?? 5000;

    // Fetch all data
    const allAgents = await db
      .select({
        id: agents.id,
        displayName: agents.displayName,
        alignment: agents.alignment,
      })
      .from(agents)
      .where(eq(agents.isActive, true));

    // Decisions with phase for training pairs
    const decisionQuery = agentFilter
      ? db.select({
          parsedAction: agentDecisions.parsedAction,
          parsedReasoning: agentDecisions.parsedReasoning,
          success: agentDecisions.success,
          latencyMs: agentDecisions.latencyMs,
          phase: agentDecisions.phase,
          agentId: agentDecisions.agentId,
        }).from(agentDecisions).where(eq(agentDecisions.agentId, agentFilter))
      : db.select({
          parsedAction: agentDecisions.parsedAction,
          parsedReasoning: agentDecisions.parsedReasoning,
          success: agentDecisions.success,
          latencyMs: agentDecisions.latencyMs,
          phase: agentDecisions.phase,
          agentId: agentDecisions.agentId,
        }).from(agentDecisions);

    // Votes joined with bills and sponsor names
    const voteQuery = agentFilter
      ? db.select({
          choice: billVotes.choice,
          voterId: billVotes.voterId,
          billTitle: bills.title,
          committee: bills.committee,
          billType: bills.billType,
          sponsorId: bills.sponsorId,
        }).from(billVotes)
          .innerJoin(bills, eq(billVotes.billId, bills.id))
          .where(eq(billVotes.voterId, agentFilter))
      : db.select({
          choice: billVotes.choice,
          voterId: billVotes.voterId,
          billTitle: bills.title,
          committee: bills.committee,
          billType: bills.billType,
          sponsorId: bills.sponsorId,
        }).from(billVotes)
          .innerJoin(bills, eq(billVotes.billId, bills.id));

    const approvalQuery = agentFilter
      ? db.select({
          agentId: approvalEvents.agentId,
          eventType: approvalEvents.eventType,
          delta: approvalEvents.delta,
        }).from(approvalEvents).where(eq(approvalEvents.agentId, agentFilter))
      : db.select({
          agentId: approvalEvents.agentId,
          eventType: approvalEvents.eventType,
          delta: approvalEvents.delta,
        }).from(approvalEvents);

    const [allDecisions, allVotesWithBills, allApprovals] = await Promise.all([
      decisionQuery,
      voteQuery,
      approvalQuery,
    ]);

    // Build agent name lookup for sponsor names
    const agentNameMap = new Map<string, string>();
    for (const a of allAgents) {
      agentNameMap.set(a.id, a.displayName);
    }

    // Calculate DEMOS scores for all agents
    const decisionsByAgent = new Map<string, DecisionRow[]>();
    for (const d of allDecisions) {
      if (!d.agentId) continue;
      const arr = decisionsByAgent.get(d.agentId) ?? [];
      arr.push(d);
      decisionsByAgent.set(d.agentId, arr);
    }

    const votesByAgent = new Map<string, VoteRow[]>();
    for (const v of allVotesWithBills) {
      if (!v.voterId) continue;
      const arr = votesByAgent.get(v.voterId) ?? [];
      arr.push(v);
      votesByAgent.set(v.voterId, arr);
    }

    const approvalsByAgent = new Map<string, ApprovalRow[]>();
    for (const a of allApprovals) {
      const arr = approvalsByAgent.get(a.agentId) ?? [];
      arr.push(a);
      approvalsByAgent.set(a.agentId, arr);
    }

    const allScores = allAgents.map((agent) => ({
      agent: agent.displayName,
      agentId: agent.id,
      alignment: agent.alignment,
      demos: calculateDemosScore(
        decisionsByAgent.get(agent.id) ?? [],
        votesByAgent.get(agent.id) ?? [],
        approvalsByAgent.get(agent.id) ?? [],
      ),
    }));

    allScores.sort((a, b) => b.demos.composite - a.demos.composite);

    // Build training dataset
    const votesWithBills: VoteWithBill[] = allVotesWithBills.map((v) => ({
      choice: v.choice,
      billTitle: v.billTitle,
      committee: v.committee,
      sponsorName: agentNameMap.get(v.sponsorId) ?? 'Unknown',
      billType: v.billType,
    }));

    const trainingData = buildTrainingDataset(
      allDecisions as FullDecisionRow[],
      votesWithBills,
      maxSamples,
    );

    // Get best agent's system prompt for Modelfile
    const systemPrompt = buildGovernanceSystemPrompt('bill_voting');

    // Generate files in temp directory
    tmpDir = await mkdtemp(join(tmpdir(), 'demos-export-'));
    const datasetPath = 'demos-training-data.jsonl';

    // Training data JSONL
    await writeFile(
      join(tmpDir, datasetPath),
      trainingData.map((d) => JSON.stringify(d)).join('\n'),
    );

    // DEMOS scores
    await writeFile(
      join(tmpDir, 'demos-scores.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), scores: allScores }, null, 2),
    );

    // Framework-specific training config
    let trainingScript: string;
    let trainingFilename: string;
    switch (preset.framework) {
      case 'unsloth':
        trainingScript = generateUnslothConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'train_demos_unsloth.py';
        break;
      case 'axolotl':
        trainingScript = generateAxolotlConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'demos_axolotl_config.yml';
        break;
      case 'mlx-lm':
        trainingScript = generateMLXConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'train_demos_mlx.sh';
        break;
      case 'nemo':
        trainingScript = generateNemoConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'train_demos_nemo.py';
        break;
    }
    await writeFile(join(tmpDir, trainingFilename), trainingScript);

    // Ollama Modelfile
    await writeFile(join(tmpDir, 'Modelfile'), generateOllamaModelfile(modelInfo, systemPrompt));

    // Deploy script
    await writeFile(join(tmpDir, 'deploy.sh'), generateDeployScript(preset, modelInfo));

    // README
    await writeFile(
      join(tmpDir, 'README.md'),
      generateReadme(preset, modelInfo, allScores.slice(0, 5)),
    );

    // Stream ZIP archive
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="demos-training-${modelId}-${presetId}-${Date.now()}.zip"`,
    );
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);
    archive.directory(tmpDir, 'demos-training-package');
    await archive.finalize();
  } catch (error) {
    next(error);
  } finally {
    if (tmpDir) {
      rm(tmpDir, { recursive: true }).catch(() => {});
    }
  }
});

export default router;
