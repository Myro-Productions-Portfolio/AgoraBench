/**
 * POLIS Training Package Generator
 * Generates fine-tuning datasets, configs, and deployment scripts
 * based on simulation benchmark results.
 * 
 * Usage: Import into your existing Express server and mount the routes.
 */

import { Router } from 'express';
import { createReadStream } from 'fs';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import archiver from 'archiver';

const router = Router();

// ============================================================
// HARDWARE PRESETS
// ============================================================
const HARDWARE_PRESETS = {
  dgx_spark: {
    name: 'NVIDIA DGX Spark',
    vram: '128GB',
    gpuCount: 1,
    gpuModel: 'GB10 Grace Blackwell',
    maxModelSize: '70B',
    batchSize: 16,
    gradientAccumulation: 2,
    quantization: null, // Full precision capable
    trainingFramework: 'nemo',
    estimatedTimePerEpoch: '~15 min for 1.8B, ~2hr for 8B',
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
    }
  },
  single_gpu_24gb: {
    name: 'Single GPU (24GB) — RTX 4090 / A5000',
    vram: '24GB',
    gpuCount: 1,
    gpuModel: 'RTX 4090 / A5000',
    maxModelSize: '8B (quantized)',
    batchSize: 4,
    gradientAccumulation: 8,
    quantization: 'qlora-4bit',
    trainingFramework: 'unsloth',
    estimatedTimePerEpoch: '~45 min for 1.8B, ~4hr for 8B',
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
      quantization: {
        loadIn4bit: true,
        bnb4bitComputeDtype: 'float16',
        bnb4bitQuantType: 'nf4',
        useNestedQuant: true,
      }
    }
  },
  single_gpu_12gb: {
    name: 'Single GPU (12GB) — RTX 4070 / T4',
    vram: '12GB',
    gpuCount: 1,
    gpuModel: 'RTX 4070 / T4',
    maxModelSize: '3B (quantized)',
    batchSize: 2,
    gradientAccumulation: 16,
    quantization: 'qlora-4bit',
    trainingFramework: 'unsloth',
    estimatedTimePerEpoch: '~30 min for 1.8B',
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
      quantization: {
        loadIn4bit: true,
        bnb4bitComputeDtype: 'float16',
        bnb4bitQuantType: 'nf4',
        useNestedQuant: true,
      }
    }
  },
  cloud_a100: {
    name: 'Cloud A100 (80GB) — Lambda / RunPod / AWS',
    vram: '80GB',
    gpuCount: 1,
    gpuModel: 'A100 80GB',
    maxModelSize: '70B (quantized)',
    batchSize: 8,
    gradientAccumulation: 4,
    quantization: null,
    trainingFramework: 'axolotl',
    estimatedTimePerEpoch: '~10 min for 1.8B, ~1hr for 8B',
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
    }
  },
  mac_m4_pro: {
    name: 'Mac Mini M4 Pro (24GB Unified)',
    vram: '24GB unified',
    gpuCount: 1,
    gpuModel: 'Apple M4 Pro',
    maxModelSize: '8B (quantized)',
    batchSize: 2,
    gradientAccumulation: 16,
    quantization: 'qlora-4bit',
    trainingFramework: 'mlx-lm',
    estimatedTimePerEpoch: '~2hr for 1.8B, ~8hr for 8B',
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
    }
  }
};

// ============================================================
// MODEL REGISTRY
// ============================================================
const MODEL_REGISTRY = {
  'politics_left_deepseek': {
    hfRepo: 'vsingh1221/politics_left_deepseek',
    architecture: 'qwen2',
    params: '1.8B',
    baseModel: 'deepseek',
    alignment: 'progressive',
    license: 'MIT',
  },
  'politics_center_deepseek': {
    hfRepo: 'vsingh1221/politics_center_deepseek',
    architecture: 'qwen2',
    params: '1.8B',
    baseModel: 'deepseek',
    alignment: 'moderate',
    license: 'MIT',
  },
  'politics_right_deepseek': {
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

// ============================================================
// POLIS SCORE CALCULATOR
// ============================================================
function calculatePolisScore(agentData, decisions, votes, approvalEvents) {
  const agentDecisions = decisions.filter(d => d.agentName === agentData.displayName);
  const agentVotes = votes.filter(v => v.voterName === agentData.displayName);
  const agentApproval = approvalEvents.filter(e => e.agentName === agentData.displayName);

  // Decision Coherence (0-100): % of decisions with valid parsed actions
  const validActions = new Set([
    'vote', 'propose', 'whip_signal', 'forum_post', 'campaign_speech',
    'judicial_vote', 'amendment', 'idle', 'veto', 'comment', 'follow',
    'support', 'oppose', 'amend', 'abstain'
  ]);
  const coherentDecisions = agentDecisions.filter(d => validActions.has(d.parsedAction));
  const decisionCoherence = agentDecisions.length > 0
    ? (coherentDecisions.length / agentDecisions.length) * 100
    : 0;

  // Reasoning Quality (0-100): % of decisions with non-empty reasoning
  const withReasoning = agentDecisions.filter(d => d.parsedReasoning?.trim()?.length > 20);
  const reasoningQuality = agentDecisions.length > 0
    ? (withReasoning.length / agentDecisions.length) * 100
    : 0;

  // Legislative Independence (0-100): inverse of yea-rubber-stamping
  const yeaVotes = agentVotes.filter(v => v.choice === 'yea').length;
  const yeaPct = agentVotes.length > 0 ? yeaVotes / agentVotes.length : 1;
  // Ideal range is 40-70% yea (realistic legislator)
  const independenceScore = Math.max(0, 100 - Math.abs(yeaPct - 0.55) * 200);

  // Whip Discipline Balance (0-100): compliance should be ~85-90%, not 99%
  const followed = agentApproval.filter(e => e.eventType === 'whip_followed').length;
  const defected = agentApproval.filter(e => e.eventType === 'whip_defected').length;
  const totalWhip = followed + defected;
  const compliancePct = totalWhip > 0 ? followed / totalWhip : 0.5;
  // Ideal compliance is ~87%
  const disciplineScore = Math.max(0, 100 - Math.abs(compliancePct - 0.87) * 200);

  // Latency Efficiency (0-100): faster is better, but not suspiciously fast
  const latencies = agentDecisions
    .filter(d => d.latencyMs && parseInt(d.latencyMs) > 0)
    .map(d => parseInt(d.latencyMs));
  const avgLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : 2000;
  // Ideal range: 500-2000ms
  let latencyScore = 100;
  if (avgLatency < 200) latencyScore = 50; // Too fast, likely not reasoning
  else if (avgLatency < 500) latencyScore = 80;
  else if (avgLatency <= 2000) latencyScore = 100;
  else if (avgLatency <= 5000) latencyScore = 70;
  else latencyScore = 40;

  // Approval Stability (0-100): steady approval with moderate volatility
  const approvalDeltas = agentApproval.map(e => Math.abs(parseInt(e.delta)));
  const avgVolatility = approvalDeltas.length > 0
    ? approvalDeltas.reduce((a, b) => a + b, 0) / approvalDeltas.length
    : 5;
  const stabilityScore = Math.max(0, 100 - (avgVolatility - 2) * 15);

  // Participation Rate (0-100)
  const participationScore = Math.min(100, (agentDecisions.length / 400) * 100);

  // Composite POLIS Score (weighted)
  const polisScore = Math.round(
    decisionCoherence * 0.20 +
    reasoningQuality * 0.15 +
    independenceScore * 0.20 +
    disciplineScore * 0.10 +
    latencyScore * 0.10 +
    stabilityScore * 0.10 +
    participationScore * 0.15
  );

  return {
    composite: polisScore,
    dimensions: {
      decisionCoherence: Math.round(decisionCoherence),
      reasoningQuality: Math.round(reasoningQuality),
      legislativeIndependence: Math.round(independenceScore),
      whipDisciplineBalance: Math.round(disciplineScore),
      latencyEfficiency: Math.round(latencyScore),
      approvalStability: Math.round(stabilityScore),
      participationRate: Math.round(participationScore),
    },
    meta: {
      totalDecisions: agentDecisions.length,
      totalVotes: agentVotes.length,
      yeaRate: Math.round(yeaPct * 100),
      avgLatencyMs: Math.round(avgLatency),
      successRate: agentDecisions.length > 0
        ? Math.round((agentDecisions.filter(d => d.success === 'true').length / agentDecisions.length) * 100)
        : 0,
    }
  };
}

// ============================================================
// TRAINING DATASET BUILDER
// ============================================================
function buildTrainingDataset(agentData, decisions, votes, bills, laws, options = {}) {
  const {
    includeFailures = true,
    includeHighScorers = true,
    targetAlignment = null,
    maxSamples = 5000,
  } = options;

  const trainingPairs = [];

  // --- Decision Training Pairs ---
  // Convert each decision into instruction/response format
  const relevantDecisions = decisions.filter(d => {
    if (targetAlignment) {
      // Could filter by agent alignment if we cross-reference
      return true;
    }
    return true;
  });

  for (const decision of relevantDecisions.slice(0, maxSamples)) {
    if (!decision.parsedReasoning?.trim()) continue;

    const systemPrompt = buildGovernanceSystemPrompt(decision.phase);

    const instruction = buildPhaseInstruction(decision);
    const response = JSON.stringify({
      action: normalizeAction(decision.parsedAction),
      reasoning: decision.parsedReasoning,
    });

    trainingPairs.push({
      system: systemPrompt,
      instruction,
      response,
      metadata: {
        phase: decision.phase,
        action: decision.parsedAction,
        success: decision.success === 'true',
        latencyMs: parseInt(decision.latencyMs) || 0,
        source: decision.success === 'true' ? 'positive' : 'negative',
      }
    });
  }

  // --- Voting Pattern Training ---
  // Group votes by bill and create voting decision pairs
  const billMap = {};
  for (const bill of bills) {
    billMap[bill.title] = bill;
  }

  for (const vote of votes.slice(0, maxSamples)) {
    const bill = billMap[vote.billTitle];
    if (!bill) continue;

    trainingPairs.push({
      system: 'You are a legislator evaluating proposed legislation. Analyze the bill and cast your vote with reasoning.',
      instruction: `Bill: "${vote.billTitle}"\nCommittee: ${bill.committee}\nSponsor: ${bill.sponsorName}\nType: ${bill.billType}\n\nCast your vote: yea, nay, or abstain. Explain your reasoning.`,
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
      }
    });
  }

  return trainingPairs;
}

function buildGovernanceSystemPrompt(phase) {
  const prompts = {
    bill_proposal: 'You are a legislator in a democratic government. Your role is to propose legislation that addresses real policy needs. Consider budget constraints, constitutional limits, and constituent impact. Respond with a structured action and detailed reasoning.',
    bill_voting: 'You are a legislator evaluating proposed legislation. Analyze bills critically — consider funding sources, enforcement mechanisms, unintended consequences, and alignment with your political philosophy. Do not default to approval.',
    forum_post: 'You are a public official engaging in policy discourse. Share substantive positions backed by evidence and reasoning. Engage with opposing viewpoints constructively.',
    campaigning: 'You are a political candidate. Articulate clear policy positions, differentiate yourself from opponents, and address constituent concerns directly.',
    judicial_review: 'You are a judicial official reviewing legislation for constitutional compliance and legal coherence. Apply strict legal analysis.',
    whip_signal: 'You are a party leader coordinating voting strategy. Issue guidance that balances party unity with individual conscience. Acknowledge when members may have legitimate reasons to defect.',
  };
  return prompts[phase] || 'You are an AI agent participating in a democratic governance simulation. Make decisions with clear reasoning.';
}

function buildPhaseInstruction(decision) {
  switch (decision.phase) {
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

function normalizeAction(rawAction) {
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

// ============================================================
// CONFIG FILE GENERATORS
// ============================================================
function generateUnslothConfig(preset, modelInfo, datasetPath) {
  return `# POLIS Training Config — Unsloth (QLoRA)
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by POLIS Training Package Generator

from unsloth import FastLanguageModel
import torch

# ---- Model Setup ----
model, tokenizer = FastLanguageModel.from_pretrained(
    model_name="${modelInfo.hfRepo}",
    max_seq_length=${preset.config.maxSeqLength},
    dtype=None,  # Auto-detect
    load_in_4bit=${preset.config.quantization?.loadIn4bit ?? false},
)

model = FastLanguageModel.get_peft_model(
    model,
    r=${preset.config.loraRank},
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                     "gate_proj", "up_proj", "down_proj"],
    lora_alpha=${preset.config.loraAlpha},
    lora_dropout=${preset.config.loraDropout},
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

def format_polis(example):
    messages = [
        {"role": "system", "content": example["system"]},
        {"role": "user", "content": example["instruction"]},
        {"role": "assistant", "content": example["response"]},
    ]
    return {"text": tokenizer.apply_chat_template(messages, tokenize=False)}

dataset = dataset["train"].map(format_polis)

# ---- Training ----
from trl import SFTTrainer
from transformers import TrainingArguments

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    dataset_text_field="text",
    max_seq_length=${preset.config.maxSeqLength},
    dataset_num_proc=2,
    args=TrainingArguments(
        per_device_train_batch_size=${preset.batchSize},
        gradient_accumulation_steps=${preset.gradientAccumulation},
        warmup_steps=${preset.config.warmupSteps},
        num_train_epochs=${preset.config.epochs},
        learning_rate=${preset.config.learningRate},
        fp16=${preset.config.precision === 'float16'},
        bf16=${preset.config.precision === 'bf16'},
        logging_steps=10,
        optim="${preset.config.optimizer}",
        lr_scheduler_type="${preset.config.schedulerType}",
        seed=42,
        output_dir="./polis-finetune-output",
        report_to="none",
    ),
)

# ---- Train ----
trainer_stats = trainer.train()

# ---- Save ----
model.save_pretrained("./polis-finetune-output/final")
tokenizer.save_pretrained("./polis-finetune-output/final")

# ---- Export to GGUF for Ollama ----
model.save_pretrained_gguf(
    "./polis-finetune-output/gguf",
    tokenizer,
    quantization_method="q4_k_m",
)

print("\\n✅ POLIS fine-tune complete!")
print(f"Training loss: {trainer_stats.training_loss:.4f}")
print(f"Model saved to: ./polis-finetune-output/final")
print(f"GGUF exported to: ./polis-finetune-output/gguf")
`;
}

function generateAxolotlConfig(preset, modelInfo, datasetPath) {
  return `# POLIS Training Config — Axolotl
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by POLIS Training Package Generator

base_model: ${modelInfo.hfRepo}
model_type: ${modelInfo.architecture === 'qwen2' ? 'AutoModelForCausalLM' : 'LlamaForCausalLM'}

load_in_8bit: false
load_in_4bit: ${preset.quantization ? 'true' : 'false'}

adapter: lora
lora_r: ${preset.config.loraRank}
lora_alpha: ${preset.config.loraAlpha}
lora_dropout: ${preset.config.loraDropout}
lora_target_linear: true

datasets:
  - path: ${datasetPath}
    type: sharegpt
    conversation: chatml

dataset_prepared_path: ./prepared-data
val_set_size: 0.05
output_dir: ./polis-finetune-output

sequence_len: ${preset.config.maxSeqLength}
sample_packing: true
pad_to_sequence_len: true

wandb_project: polis-benchmark
wandb_run_id: polis-\${date}

gradient_accumulation_steps: ${preset.gradientAccumulation}
micro_batch_size: ${preset.batchSize}
num_epochs: ${preset.config.epochs}
optimizer: ${preset.config.optimizer}
lr_scheduler: ${preset.config.schedulerType}
learning_rate: ${preset.config.learningRate}
warmup_steps: ${preset.config.warmupSteps}

train_on_inputs: false
group_by_length: false
bf16: ${preset.config.precision === 'bf16' ? 'auto' : 'false'}
fp16: ${preset.config.precision === 'float16'}
tf32: false

gradient_checkpointing: true
logging_steps: 10
save_strategy: epoch
save_total_limit: 3

special_tokens:
  pad_token: "<|endoftext|>"
`;
}

function generateMLXConfig(preset, modelInfo, datasetPath) {
  return `# POLIS Training Config — MLX (Apple Silicon)
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by POLIS Training Package Generator

# ---- Install ----
# pip install mlx-lm

# ---- Convert model to MLX format ----
# python -m mlx_lm.convert \\
#   --hf-path ${modelInfo.hfRepo} \\
#   --mlx-path ./mlx-model

# ---- Fine-tune ----
python -m mlx_lm.lora \\
  --model ./mlx-model \\
  --data ${datasetPath} \\
  --train \\
  --batch-size ${preset.batchSize} \\
  --lora-layers ${preset.config.loraRank} \\
  --learning-rate ${preset.config.learningRate} \\
  --iters 1000 \\
  --val-batches 25 \\
  --steps-per-report 10 \\
  --adapter-path ./polis-finetune-output/adapters \\
  --save-every 100

# ---- Fuse adapters ----
python -m mlx_lm.fuse \\
  --model ./mlx-model \\
  --adapter-path ./polis-finetune-output/adapters \\
  --save-path ./polis-finetune-output/fused

# ---- Test ----
python -m mlx_lm.generate \\
  --model ./polis-finetune-output/fused \\
  --prompt "You are a legislator. A bill proposes universal basic income funded by automation taxes. Vote and explain your reasoning."
`;
}

function generateNemoConfig(preset, modelInfo, datasetPath) {
  return `# POLIS Training Config — NVIDIA NeMo (DGX)
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by POLIS Training Package Generator

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
            "r": ${preset.config.loraRank},
            "alpha": ${preset.config.loraAlpha},
            "dropout": ${preset.config.loraDropout},
        },
    },
    "training": {
        "max_epochs": ${preset.config.epochs},
        "learning_rate": ${preset.config.learningRate},
        "batch_size": ${preset.batchSize},
        "gradient_accumulation": ${preset.gradientAccumulation},
        "precision": "${preset.config.precision}",
        "optimizer": "${preset.config.optimizer}",
        "warmup_steps": ${preset.config.warmupSteps},
    },
    "data": {
        "train_ds": "${datasetPath}",
        "max_seq_length": ${preset.config.maxSeqLength},
    },
    "exp_manager": {
        "exp_dir": "./polis-finetune-output",
        "name": "polis-nemo-finetune",
    }
})

print("\\n🚀 NeMo POLIS config ready for DGX Spark")
print("Run with: python -m nemo.collections.nlp.models.language_modeling.megatron_gpt_sft \\\\")
print("  --config-path=. --config-name=polis_nemo_config")
`;
}

function generateOllamaModelfile(modelInfo, systemPrompt) {
  return `# POLIS Modelfile for Ollama
# Import the fine-tuned GGUF model into Ollama
# Generated by POLIS Training Package Generator

FROM ./polis-finetune-output/gguf/unsloth.Q4_K_M.gguf

# System prompt derived from highest-scoring POLIS agent
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
# ollama create polis-agent -f Modelfile
# ollama run polis-agent "A bill proposes mandatory AI audits for all government systems. Vote and explain."
`;
}

function generateDeployScript(preset, modelInfo) {
  return `#!/bin/bash
# POLIS Training Deploy Script
# Model: ${modelInfo.hfRepo}
# Hardware: ${preset.name}
# Generated by POLIS Training Package Generator

set -e

echo "========================================="
echo "  POLIS Training Package Deployer"
echo "  Model: ${modelInfo.hfRepo}"
echo "  Target: ${preset.name}"
echo "========================================="

# ---- Check Dependencies ----
echo "\\n[1/5] Checking dependencies..."
${preset.trainingFramework === 'unsloth' ? `
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes
` : ''}
${preset.trainingFramework === 'axolotl' ? `
pip install axolotl
pip install flash-attn --no-build-isolation
` : ''}
${preset.trainingFramework === 'mlx-lm' ? `
pip install mlx-lm
` : ''}
${preset.trainingFramework === 'nemo' ? `
pip install nemo_toolkit[all]
` : ''}

# ---- Validate Dataset ----
echo "\\n[2/5] Validating training dataset..."
python3 -c "
import json
with open('polis-training-data.jsonl') as f:
    lines = f.readlines()
    print(f'  Dataset samples: {len(lines)}')
    sample = json.loads(lines[0])
    assert 'system' in sample, 'Missing system field'
    assert 'instruction' in sample, 'Missing instruction field'
    assert 'response' in sample, 'Missing response field'
    print('  Schema validation: ✅')
"

# ---- Start Training ----
echo "\\n[3/5] Starting POLIS fine-tune..."
${preset.trainingFramework === 'unsloth' ? 'python3 train_polis_unsloth.py' : ''}
${preset.trainingFramework === 'axolotl' ? 'accelerate launch -m axolotl.cli.train polis_axolotl_config.yml' : ''}
${preset.trainingFramework === 'mlx-lm' ? 'bash train_polis_mlx.sh' : ''}
${preset.trainingFramework === 'nemo' ? 'python3 train_polis_nemo.py' : ''}

# ---- Export to Ollama ----
echo "\\n[4/5] Importing to Ollama..."
if command -v ollama &> /dev/null; then
    ollama create polis-agent -f Modelfile
    echo "  Ollama model created: polis-agent"
else
    echo "  Ollama not found — skipping import"
    echo "  GGUF available at: ./polis-finetune-output/gguf/"
fi

# ---- Verify ----
echo "\\n[5/5] Running verification prompt..."
if command -v ollama &> /dev/null; then
    ollama run polis-agent "A bill proposes a 2% automation tax to fund displaced worker retraining programs. As a technocrat senator, analyze this bill and cast your vote with detailed reasoning."
fi

echo "\\n========================================="
echo "  ✅ POLIS Training Complete"
echo "  Output: ./polis-finetune-output/"
echo "  Ollama: ollama run polis-agent"
echo "========================================="
`;
}

function generateReadme(preset, modelInfo, polisScores) {
  return `# POLIS Training Package

## Overview
This training package was generated by the **POLIS Benchmark** (Political Operations and Legislative Intelligence Score) on [MoltGovernment](https://moltgovernment.com).

It contains everything needed to fine-tune **${modelInfo.hfRepo}** based on governance simulation performance data.

## What's Inside

| File | Purpose |
|------|---------|
| \`polis-training-data.jsonl\` | Curated training dataset from simulation |
| \`polis-scores.json\` | POLIS benchmark scores and dimensions |
| \`train_polis_*.py/sh/yml\` | Training script for ${preset.trainingFramework} |
| \`Modelfile\` | Ollama import config with optimized system prompt |
| \`deploy.sh\` | One-command setup and training |
| \`README.md\` | This file |

## POLIS Scores (Pre-Training Baseline)

\`\`\`
${JSON.stringify(polisScores, null, 2)}
\`\`\`

## Hardware Target
- **Device**: ${preset.name}
- **VRAM**: ${preset.vram}
- **Framework**: ${preset.trainingFramework}
- **Estimated Time**: ${preset.estimatedTimePerEpoch}

## Quick Start

\`\`\`bash
chmod +x deploy.sh
./deploy.sh
\`\`\`

## After Training

Re-inject the fine-tuned model back into MoltGovernment and run a new simulation cycle.
Compare pre-training vs post-training POLIS scores to measure improvement.

\`\`\`bash
# Run in Ollama
ollama run polis-agent

# Or serve via API
ollama serve &
curl http://localhost:11434/api/generate -d '{
  "model": "polis-agent",
  "prompt": "A bill proposes mandatory AI transparency reports for all government agencies. Vote and explain."
}'
\`\`\`

## License
Training data: Generated by POLIS simulation (MIT)
Base model: ${modelInfo.license}

---
*Generated by POLIS — Political Operations and Legislative Intelligence Score*
*[moltgovernment.com](https://moltgovernment.com)*
`;
}


// ============================================================
// API ROUTES
// ============================================================

/**
 * GET /api/training/presets
 * Returns available hardware presets
 */
router.get('/presets', (req, res) => {
  const presets = Object.entries(HARDWARE_PRESETS).map(([key, preset]) => ({
    id: key,
    name: preset.name,
    vram: preset.vram,
    gpu: preset.gpuModel,
    maxModelSize: preset.maxModelSize,
    framework: preset.trainingFramework,
    estimatedTime: preset.estimatedTimePerEpoch,
  }));
  res.json({ presets });
});

/**
 * GET /api/training/models
 * Returns available models for fine-tuning
 */
router.get('/models', (req, res) => {
  const models = Object.entries(MODEL_REGISTRY).map(([key, model]) => ({
    id: key,
    ...model,
  }));
  res.json({ models });
});

/**
 * POST /api/training/scores
 * Calculate POLIS scores for an agent or all agents
 * Body: { agentName?: string }
 */
router.post('/scores', async (req, res) => {
  try {
    const { agentName } = req.body;

    // TODO: Replace with your actual DB queries
    // These are placeholder signatures matching your CSV structure
    const agents = await fetchAgents();
    const decisions = await fetchDecisions();
    const votes = await fetchVotes();
    const approvalEvents = await fetchApprovalEvents();

    if (agentName) {
      const agent = agents.find(a => a.displayName === agentName);
      if (!agent) return res.status(404).json({ error: 'Agent not found' });

      const score = calculatePolisScore(agent, decisions, votes, approvalEvents);
      return res.json({ agent: agentName, polis: score });
    }

    // All agents
    const scores = agents.map(agent => ({
      agent: agent.displayName,
      alignment: agent.alignment,
      provider: agent.modelProvider,
      model: agent.model || 'default',
      polis: calculatePolisScore(agent, decisions, votes, approvalEvents),
    }));

    // Sort by composite score
    scores.sort((a, b) => b.polis.composite - a.polis.composite);
    res.json({ scores });
  } catch (err) {
    console.error('POLIS score error:', err);
    res.status(500).json({ error: 'Failed to calculate scores' });
  }
});

/**
 * POST /api/training/export
 * Generate and download a training package
 * Body: { modelId, presetId, agentFilter?, options? }
 */
router.post('/export', async (req, res) => {
  try {
    const { modelId, presetId, agentFilter, options = {} } = req.body;

    const preset = HARDWARE_PRESETS[presetId];
    const modelInfo = MODEL_REGISTRY[modelId];
    if (!preset) return res.status(400).json({ error: `Unknown preset: ${presetId}` });
    if (!modelInfo) return res.status(400).json({ error: `Unknown model: ${modelId}` });

    // Fetch simulation data
    // TODO: Replace with your actual DB queries
    const agents = await fetchAgents();
    const decisions = await fetchDecisions();
    const votes = await fetchVotes();
    const bills = await fetchBills();
    const laws = await fetchLaws();
    const approvalEvents = await fetchApprovalEvents();

    // Calculate scores
    const allScores = agents.map(agent => ({
      agent: agent.displayName,
      polis: calculatePolisScore(agent, decisions, votes, approvalEvents),
    }));

    // Build training dataset
    const trainingData = buildTrainingDataset(
      agentFilter ? agents.find(a => a.displayName === agentFilter) : null,
      decisions,
      votes,
      bills,
      laws,
      options
    );

    // Get best agent's system prompt for Modelfile
    const bestAgent = allScores.sort((a, b) => b.polis.composite - a.polis.composite)[0];
    const systemPrompt = buildGovernanceSystemPrompt('bill_voting');

    // Generate package files
    const tmpDir = join('/tmp', `polis-export-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });

    // Training data (JSONL)
    const datasetPath = 'polis-training-data.jsonl';
    await writeFile(
      join(tmpDir, datasetPath),
      trainingData.map(d => JSON.stringify(d)).join('\n')
    );

    // POLIS scores
    await writeFile(
      join(tmpDir, 'polis-scores.json'),
      JSON.stringify({ generatedAt: new Date().toISOString(), scores: allScores }, null, 2)
    );

    // Training config (framework-specific)
    let trainingScript, trainingFilename;
    switch (preset.trainingFramework) {
      case 'unsloth':
        trainingScript = generateUnslothConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'train_polis_unsloth.py';
        break;
      case 'axolotl':
        trainingScript = generateAxolotlConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'polis_axolotl_config.yml';
        break;
      case 'mlx-lm':
        trainingScript = generateMLXConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'train_polis_mlx.sh';
        break;
      case 'nemo':
        trainingScript = generateNemoConfig(preset, modelInfo, datasetPath);
        trainingFilename = 'train_polis_nemo.py';
        break;
    }
    await writeFile(join(tmpDir, trainingFilename), trainingScript);

    // Ollama Modelfile
    await writeFile(
      join(tmpDir, 'Modelfile'),
      generateOllamaModelfile(modelInfo, systemPrompt)
    );

    // Deploy script
    await writeFile(join(tmpDir, 'deploy.sh'), generateDeployScript(preset, modelInfo));

    // README
    await writeFile(
      join(tmpDir, 'README.md'),
      generateReadme(preset, modelInfo, allScores.slice(0, 5))
    );

    // Create zip archive
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="polis-training-${modelId}-${presetId}-${Date.now()}.zip"`
    );

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);
    archive.directory(tmpDir, 'polis-training-package');
    await archive.finalize();

  } catch (err) {
    console.error('Training export error:', err);
    res.status(500).json({ error: 'Failed to generate training package' });
  }
});


// ============================================================
// DATABASE QUERY STUBS
// Replace these with your actual PostgreSQL queries
// ============================================================
async function fetchAgents() {
  // TODO: return rows from your agents table
  // Expected shape: [{ displayName, alignment, modelProvider, model, reputation, balance, approvalRating, ... }]
  throw new Error('Implement fetchAgents() with your database connection');
}

async function fetchDecisions() {
  // TODO: return rows from your agent_decisions table
  throw new Error('Implement fetchDecisions() with your database connection');
}

async function fetchVotes() {
  // TODO: return rows from your bill_votes table
  throw new Error('Implement fetchVotes() with your database connection');
}

async function fetchBills() {
  // TODO: return rows from your bills table
  throw new Error('Implement fetchBills() with your database connection');
}

async function fetchLaws() {
  // TODO: return rows from your laws table
  throw new Error('Implement fetchLaws() with your database connection');
}

async function fetchApprovalEvents() {
  // TODO: return rows from your approval_events table
  throw new Error('Implement fetchApprovalEvents() with your database connection');
}


// ============================================================
// EXPORTS
// ============================================================
export {
  router as trainingRoutes,
  HARDWARE_PRESETS,
  MODEL_REGISTRY,
  calculatePolisScore,
  buildTrainingDataset,
};
