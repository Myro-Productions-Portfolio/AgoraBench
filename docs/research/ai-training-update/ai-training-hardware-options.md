# Complete AI training hardware reference for 2025–2026

**Every GPU, accelerator, and cloud instance for LLM fine-tuning — with specs, pricing, and recommended configurations for a training script generator.** This reference covers consumer through data center hardware, cloud pricing across 10+ providers, Apple Silicon, dedicated AI accelerators, and per-VRAM-tier LoRA/QLoRA best practices. All specs are current as of February 2026.

The single most important constraint for LLM fine-tuning is **VRAM, not compute**. A 24GB RTX 3090 can fine-tune models a 16GB RTX 4080 cannot. Memory bandwidth is the second constraint, particularly for token generation. This report provides the precise numbers needed to auto-generate training configurations based on detected hardware.

---

## Consumer NVIDIA GPUs: the backbone of individual fine-tuning

### RTX 30 Series (Ampere — 3rd Gen Tensor Cores)

| GPU | VRAM | Bandwidth | FP16 Dense TFLOPS | TDP | BF16 | FP8 | Street Price |
|-----|------|-----------|-------------------|-----|------|-----|-------------|
| RTX 3090 | 24 GB GDDR6X | 936 GB/s | 71 | 350W | ✅ | ❌ | $650–900 (used) |
| RTX 3090 Ti | 24 GB GDDR6X | 1,008 GB/s | 80 | 450W | ✅ | ❌ | $800–1,100 (used) |

### RTX 40 Series (Ada Lovelace — 4th Gen Tensor Cores)

All RTX 40 series support **BF16, FP8, INT8, INT4, TF32**.

| GPU | VRAM | Bandwidth | FP16 Dense TFLOPS | TDP | MSRP | Street Price |
|-----|------|-----------|-------------------|-----|------|-------------|
| RTX 4060 | 8 GB GDDR6 | 272 GB/s | 30 | 115W | $299 | $280–320 |
| RTX 4060 Ti 8GB | 8 GB GDDR6 | 288 GB/s | 44 | 160W | $399 | $370–420 |
| RTX 4060 Ti 16GB | 16 GB GDDR6 | 288 GB/s | 44 | 165W | $499 | $470–520 |
| RTX 4070 | 12 GB GDDR6X | 504 GB/s | 58 | 200W | $549 | $500–570 |
| RTX 4070 Ti | 12 GB GDDR6X | 504 GB/s | 80 | 285W | $799 | $550–650 (EOL) |
| RTX 4070 Ti Super | 16 GB GDDR6X | 672 GB/s | 88 | 285W | $799 | $750–850 |
| RTX 4080 | 16 GB GDDR6X | 717 GB/s | 98 | 320W | $1,199 | $850–1,000 (EOL) |
| RTX 4080 Super | 16 GB GDDR6X | 736 GB/s | 104 | 320W | $999 | $950–1,050 |
| RTX 4090 | 24 GB GDDR6X | 1,008 GB/s | 165 | 450W | $1,599 | $1,800–2,500 |

### RTX 50 Series (Blackwell — 5th Gen Tensor Cores)

All RTX 50 series add **FP4 and FP6** support alongside BF16, FP8, INT8, INT4.

| GPU | VRAM | Bandwidth | FP16 Dense TFLOPS | TDP | MSRP | Street Price |
|-----|------|-----------|-------------------|-----|------|-------------|
| RTX 5070 | 12 GB GDDR7 | 672 GB/s | 62 | 250W | $549 | $550–800 |
| RTX 5070 Ti | 16 GB GDDR7 | 896 GB/s | 88 | 300W | $749 | $750–1,100 |
| RTX 5080 | 16 GB GDDR7 | 960 GB/s | 113 | 360W | $999 | $1,000–1,400 |
| RTX 5090 | 32 GB GDDR7 | 1,792 GB/s | 210 | 575W | $1,999 | $2,500–3,500 |

Supply constraints inflated RTX 50 street prices well above MSRP throughout 2025. The **RTX 5090** is the first consumer GPU with 32GB, enabling LoRA fine-tuning on 8B models with large batch sizes and no quantization.

### Consumer NVIDIA fine-tuning capacity

| GPU | VRAM | Max LoRA (r=16) | Max QLoRA 4-bit | QLoRA Needed? | 1.8B LoRA Time | 8B LoRA/QLoRA Time |
|-----|------|----------------|----------------|---------------|---------------|-------------------|
| RTX 4060 | 8 GB | ~1.5–2B | ~3–5B | Yes, always | ~3–4 hr | ~15–24 hr (QLoRA, not recommended) |
| RTX 4060 Ti 8GB | 8 GB | ~1.5–2B | ~3–5B | Yes, always | ~2–3 hr | ~12–20 hr (QLoRA) |
| RTX 4060 Ti 16GB | 16 GB | ~3–4B | ~8–13B | ≥4B models | ~2–3 hr | ~8–12 hr (QLoRA) |
| RTX 4070 | 12 GB | ~2–3B | ~7–8B | ≥3B models | ~1.5–2 hr | ~6–10 hr (QLoRA) |
| RTX 4070 Ti Super | 16 GB | ~3–4B | ~8–13B | ≥4B models | ~50–80 min | ~4–6 hr (QLoRA) |
| RTX 4080 Super | 16 GB | ~3–4B | ~8–13B | ≥4B models | ~40–60 min | ~3–5 hr (QLoRA) |
| RTX 4090 | 24 GB | ~7–8B | ~13–20B | ≥8B models | ~25–40 min | ~1.5–3 hr (LoRA) |
| RTX 3090 | 24 GB | ~7–8B | ~13–20B | ≥8B models | ~1–1.5 hr | ~3–5 hr (LoRA) |
| RTX 5070 | 12 GB | ~2–3B | ~7–8B | ≥3B models | ~1–1.5 hr | ~5–8 hr (QLoRA) |
| RTX 5070 Ti | 16 GB | ~3–4B | ~8–13B | ≥4B models | ~45–70 min | ~3–5 hr (QLoRA) |
| RTX 5080 | 16 GB | ~3–4B | ~8–13B | ≥4B models | ~35–50 min | ~2.5–4 hr (QLoRA) |
| RTX 5090 | 32 GB | ~8–10B | ~20–33B | ≥10B models | ~18–28 min | ~1–2 hr (LoRA) |

All times assume **~5,000 samples, 3 epochs, seq_len 512, Unsloth framework with gradient checkpointing**. Batch sizes: 1–2 for 8GB, 2–4 for 12GB, 4–8 for 16GB, 8–16 for 24GB, 16–32 for 32GB. Recommended framework for all consumer NVIDIA: **Unsloth** (2–5× faster, 60–70% less VRAM).

---

## Consumer AMD GPUs and the ROCm reality

AMD skipped "RX 8000" for desktop — RDNA 4 launched as the **RX 9000 series**. AMD RDNA 3/4 GPUs use packed math for FP16/BF16 (2× FP32 rate).

| GPU | VRAM | Bandwidth | FP16 TFLOPS | TDP | Precision | Street Price |
|-----|------|-----------|-------------|-----|-----------|-------------|
| RX 7900 XTX | 24 GB GDDR6 | 960 GB/s | 123 | 355W | FP16, BF16, INT8. No FP8 | $650–750 |
| RX 7900 XT | 20 GB GDDR6 | 800 GB/s | 103 | 315W | FP16, BF16, INT8. No FP8 | $550–650 |
| RX 9070 XT | 16 GB GDDR6 | 640 GB/s | 97 | 304W | FP16, BF16, **FP8**, INT8 | $600–850 |
| RX 9070 | 16 GB GDDR6 | 640 GB/s | 82 | 220W | FP16, BF16, **FP8**, INT8 | $550–670 |
| RX 9060 XT | 8/16 GB GDDR6 | 320 GB/s | 53 | 150W | FP16, BF16, FP8, INT8 | $299–349 |

**ROCm compatibility status (2025–2026):** PyTorch ROCm has first-class Linux support for RX 7900+ and RX 9000 series. Windows support remains preview-only. Key limitations include **10–20% lower training throughput** than equivalent NVIDIA CUDA, significantly more complex installation, spotty bitsandbytes support for QLoRA, and no NVLink equivalent for multi-GPU. Framework recommendation: **PyTorch ROCm on Linux via Docker** (`rocm/pytorch`). The RX 7900 XTX at **$650–750 with 24GB** is exceptional value if you can tolerate the software friction.

| AMD GPU | Max LoRA | Max QLoRA | 1.8B Time | 8B Time |
|---------|----------|-----------|-----------|---------|
| RX 7900 XTX (24GB) | ~10–11B | ~30B | ~15–25 min | ~1–2 hr (LoRA) |
| RX 7900 XT (20GB) | ~8–9B | ~20–25B | ~18–30 min | ~1.5–2.5 hr |
| RX 9070 XT (16GB) | ~7B | ~13–15B | ~20–35 min | ~2–3 hr (QLoRA) |

---

## Professional and workstation NVIDIA GPUs

### Ampere A-Series (3rd Gen Tensor Cores — BF16 ✅, FP8 ❌)

| GPU | VRAM | Bandwidth | FP16 Tensor TFLOPS | TDP | NVLink | Price |
|-----|------|-----------|-------------------|-----|--------|-------|
| RTX A4000 | 16 GB GDDR6 ECC | 448 GB/s | 77 | 140W | ❌ | $800–1,100 |
| RTX A4500 | 20 GB GDDR6 ECC | 640 GB/s | 95 | 200W | ✅ 2-way | $2,000–2,500 |
| RTX A5000 | 24 GB GDDR6 ECC | 768 GB/s | 111 | 230W | ✅ 2-way | $1,800–2,500 |
| RTX A6000 | 48 GB GDDR6 ECC | 768 GB/s | 155 | 300W | ✅ 2-way | $3,000–4,500 |

The RTX A6000's **48GB with NVLink** (pooling to 96GB across two cards) makes it uniquely valuable for multi-GPU training of models that don't fit on consumer cards.

### Ada Lovelace Workstation (4th Gen Tensor Cores — BF16 ✅, FP8 ✅)

| GPU | VRAM | Bandwidth | FP16 Tensor TFLOPS | TDP | NVLink | Price |
|-----|------|-----------|-------------------|-----|--------|-------|
| RTX 4000 Ada | 20 GB GDDR6 ECC | 280 GB/s | 214 | 130W | ❌ | ~$1,250 |
| RTX 5000 Ada | 32 GB GDDR6 ECC | 576 GB/s | 261 | 250W | ❌ | ~$4,000 |
| RTX 6000 Ada | 48 GB GDDR6 ECC | 960 GB/s | 365 | 300W | ❌ | $6,500–7,500 |

**Critical note:** Ada workstation cards **dropped NVLink support** — a significant regression from Ampere A-series. For NVLink multi-GPU, use A-series or data center GPUs.

### Data Center Inference/Training (Ada Lovelace)

| GPU | VRAM | Bandwidth | FP16 TFLOPS | FP8 TFLOPS (sparse) | TDP | Transformer Engine | Price |
|-----|------|-----------|-------------|---------------------|-----|--------------------|-------|
| L4 | 24 GB GDDR6 | 300 GB/s | 121 (sparse) | 485 | 72W | ❌ | $2,500–3,500 |
| L40 | 48 GB GDDR6 ECC | 864 GB/s | 362 (sparse) | 724 | 300W | ❌ | $7,000–8,000 |
| L40S | 48 GB GDDR6 ECC | 864 GB/s | 366 (sparse) | **1,466** | 350W | ✅ | $7,500–8,500 |

The **L40S** is the key differentiator here — its Transformer Engine enables dynamic FP8↔FP16 casting, delivering **2× the FP8 performance** of L40 despite identical memory specs. None of these support NVLink or MIG.

### Workstation/professional fine-tuning capacity

| GPU | VRAM | Max LoRA | Max QLoRA | 1.8B Time | 8B Time |
|-----|------|----------|-----------|-----------|---------|
| RTX A4000 (16GB) | 16 GB | ~7B | ~13–15B | ~30–45 min | ~2.5–4 hr (QLoRA) |
| RTX A6000 (48GB) | 48 GB | ~22B | ~70B | ~15–25 min | ~1–1.5 hr (LoRA) |
| RTX 5000 Ada (32GB) | 32 GB | ~14B | ~40–45B | ~10–15 min | ~40–60 min (LoRA) |
| RTX 6000 Ada (48GB) | 48 GB | ~22B | ~70B | ~7–12 min | ~30–50 min (LoRA) |
| L4 (24GB) | 24 GB | ~10–11B | ~30B | ~25–40 min | ~2–3 hr |
| L40S (48GB) | 48 GB | ~22B | ~70B | ~8–12 min | ~30–45 min (LoRA) |

---

## NVIDIA data center GPUs: the training workhorses

### Individual GPU specifications

| GPU | VRAM | Bandwidth | FP16/BF16 TFLOPS (dense) | FP8 TFLOPS (dense) | TDP | NVLink | Price (purchase) | Cloud $/hr |
|-----|------|-----------|-------------------------|--------------------|----|--------|-----------------|-----------|
| A100 40GB PCIe | 40 GB HBM2 | 1,555 GB/s | 312 (sparse) | N/A | 250W | 600 GB/s (bridge) | $5K–8K (used) | $1.00–1.50 |
| A100 80GB SXM | 80 GB HBM2e | 2,039 GB/s | 312 (sparse) | N/A | 400W | 600 GB/s | $12K–18K (used) | $1.50–2.50 |
| H100 80GB PCIe | 80 GB HBM2e | 2,000 GB/s | 757 (dense) | 1,513 (dense) | 350W | 600 GB/s (bridge) | $25K–30K | $2.00–3.00 |
| H100 80GB SXM | 80 GB HBM3 | 3,350 GB/s | 990 (dense) | 1,979 (dense) | 700W | 900 GB/s | $30K–40K | $2.00–4.00 |
| H200 141GB SXM | 141 GB HBM3e | 4,800 GB/s | 990 (dense) | 1,979 (dense) | 700W | 900 GB/s | $35K–45K | $2.50–3.50 |
| B100 192GB | 192 GB HBM3e | 8,000 GB/s | 1,800 (dense) | 3,500 (dense) | 700W | 1,800 GB/s | ~$30K–35K | Limited |
| B200 192GB SXM | 192 GB HBM3e | 8,000 GB/s | 2,250 (dense) | 4,500 (dense) | 1,000W | 1,800 GB/s | $45K–50K | ~$4–6 |
| GB200 Superchip | 384 GB (2×B200) | 16,000 GB/s | ~4,500 combined | ~9,000 combined | ~2,700W | 1,800 GB/s/GPU | ~$60K–70K | Enterprise |
| GB300 Superchip | 576 GB (2×B300) | ~16,000 GB/s | ~4,500 (sparse) | 9,000 (sparse) | ~3,100W | 1,800 GB/s/GPU | Not disclosed | Enterprise |

**H100 PCIe vs SXM:** The SXM variant uses **HBM3** (3,350 GB/s) while PCIe uses **HBM2e** (2,000 GB/s) — a 67% bandwidth difference often overlooked. The SXM also delivers ~30% higher TFLOPS.

**Blackwell generation (B100/B200/B300)** introduces native **FP4 and FP6** precision. B200 requires **liquid cooling** at 1,000W. B300 (Blackwell Ultra) pushes to **270–288GB HBM3e** at 1,400W but sacrifices nearly all FP64 capability — purely AI-optimized.

Precision support: A100 (FP32, TF32, FP16, BF16, INT8), H100/H200 add **FP8 with Transformer Engine**, B200/B300 add **FP4, FP6**.

### Data center fine-tuning capacity

| GPU | VRAM | Max LoRA (BF16) | Max QLoRA 4-bit | 1.8B LoRA Time | 8B LoRA Time |
|-----|------|----------------|----------------|---------------|-------------|
| A100 40GB | 40 GB | ~13B | ~30–33B | ~15–25 min | ~50–90 min |
| A100 80GB | 80 GB | ~30B | ~65–70B | ~12–20 min | ~40–70 min |
| H100 80GB SXM | 80 GB | ~30B | ~65–70B | ~8–15 min | ~25–45 min |
| H200 141GB | 141 GB | ~55–60B | ~120–130B | ~7–12 min | ~20–35 min |
| B200 192GB | 192 GB | ~70–80B | ~150–170B | ~4–8 min | ~12–20 min |

### DGX systems

| System | GPUs | Total GPU Memory | AI Perf | Interconnect | Price |
|--------|------|-----------------|---------|-------------|-------|
| **DGX Spark** | 1× GB10 | 128 GB LPDDR5x (unified) | 1 PFLOPS FP4 | ConnectX-8, NVLink-C2C for 2-unit clustering | **$3,999** |
| **DGX Station** (GB300) | 1× GB300 Superchip | 784 GB (288GB HBM3e + 496GB LPDDR5X) | 20 PFLOPS | NVLink-C2C, ConnectX-8 800Gbps | ~$100K+ (est.) |
| **DGX A100** | 8× A100 80GB | 640 GB HBM2e | 5 PFLOPS FP16 | NVLink 3.0 + 6× NVSwitch | $149K–199K |
| **DGX H100** | 8× H100 80GB | 640 GB HBM3 | 32 PFLOPS FP8 | NVLink 4.0 + 4× NVSwitch Gen3 | $300K–500K |
| **DGX B200** | 8× B200 | 1,440 GB HBM3e | ~3× DGX H100 | NVLink 5.0, liquid-cooled | $500K+ (est.) |
| **DGX SuperPOD** | Up to 576 GPUs | Varies | Up to 11.5 EXAFLOPS FP4 | NVSwitch + InfiniBand/Spectrum-X | Multi-million |

The **DGX Spark** at $3,999 is remarkable — a Mac Mini–sized device with 128GB unified memory and 1 PFLOPS FP4. Good for inference and light fine-tuning of models up to ~200B (quantized), but its **273 GB/s LPDDR5x bandwidth** is vastly lower than HBM-based data center GPUs.

---

## AMD Instinct: the NVIDIA alternative in data centers

| GPU | Memory | Bandwidth | FP16/BF16 TFLOPS | FP8 TFLOPS | TDP | Interconnect | Price |
|-----|--------|-----------|-------------------|------------|-----|-------------|-------|
| MI250X | 128 GB HBM2e | 3,277 GB/s | 383 | N/A | 500W | Infinity Fabric 800 GB/s | $10K–15K |
| MI300X | 192 GB HBM3 | 5,300 GB/s | 1,307 | 2,615 | 750W | Infinity Fabric 896 GB/s | $20K–25K |
| MI325X | 256 GB HBM3E | 6,000 GB/s | 1,307 | 2,615 | 1,000W | Infinity Fabric | $25K–30K |
| MI350X | 288 GB HBM3E | 8,000 GB/s | ~2,300 | ~4,600 | 1,000W | 4th Gen Infinity Fabric | $30K–40K |

The **MI300X** competes directly with H100 — offering **2.4× more memory** (192 vs 80GB) with competitive FP16 TFLOPS (1,307 vs 990 dense). The MI325X bumps to 256GB. MI350X (CDNA 4, shipped June 2025) adds native FP4/FP6 and doubles BF16 throughput. **ROCm 7.x** delivers ~3× training throughput improvement over ROCm 6 on MI300X, with day-zero framework support for MI350.

AMD Instinct precision: MI250X (FP16, BF16, INT8 — no FP8/TF32), MI300X adds (TF32, FP8 FNUZ variant), MI350X adds (FP4, FP6).

| AMD GPU | Max LoRA | Max QLoRA | 1.8B Time | 8B Time |
|---------|----------|-----------|-----------|---------|
| MI250X (128GB) | ~60–65B | ~130B | ~20–40 min | ~1.5–3 hr |
| MI300X (192GB) | ~90B | ~180B | ~10–25 min | ~45 min–1.5 hr |
| MI325X (256GB) | ~120B | ~250B | ~10–20 min | ~40 min–1.5 hr |
| MI350X (288GB) | ~130B | ~260B+ | ~5–15 min | ~20–50 min |

---

## Apple Silicon: unified memory changes the game

Apple Silicon uses **Unified Memory Architecture (UMA)** — all memory is available to the GPU as effective VRAM. A Mac with 128GB has 128GB available for model loading. No M4 Ultra exists; Apple skipped to M5 Ultra (expected 2026).

### Chip specifications

| Chip | Max Memory | Bandwidth | GPU Cores | FP32 TFLOPS | FP16 TFLOPS (est.) | Neural Engine |
|------|-----------|-----------|-----------|-------------|--------------------|----|
| M1 Pro | 32 GB | 200 GB/s | 16 | 5.2 | ~10.4 | 11 TOPS |
| M1 Max | 64 GB | 400 GB/s | 32 | 10.4 | ~20.8 | 11 TOPS |
| M1 Ultra | 128 GB | 800 GB/s | 64 | 20.8 | ~41.6 | 22 TOPS |
| M2 Pro | 32 GB | 200 GB/s | 19 | 6.8 | ~13.6 | 15.8 TOPS |
| M2 Max | 96 GB | 400 GB/s | 38 | 13.6 | ~27.2 | 15.8 TOPS |
| M2 Ultra | 192 GB | 800 GB/s | 76 | 27.2 | ~54.4 | 31.6 TOPS |
| M3 Pro | 36 GB | 150 GB/s | 18 | 6.4 | ~12.8 | ~18 TOPS |
| M3 Max | 128 GB | 400 GB/s | 40 | 14.1 | ~28.3 | ~18 TOPS |
| M3 Ultra | 512 GB | ~800 GB/s | 80 | 28.3 | ~57 | ~36 TOPS |
| M4 | 32 GB | 120 GB/s | 10 | 4.3 | ~8.5 | 38 TOPS |
| M4 Pro | 64 GB | 273 GB/s | 20 | 8.6 | ~17 | 38 TOPS |
| M4 Max | 128 GB | 546 GB/s | 40 | 17.2 | ~34 | 38 TOPS |

Apple Silicon supports **FP32, FP16, BF16 (M4+ native), INT8, INT4**. No FP8 or TF32 hardware acceleration. No tensor cores — training is **3–5× slower** than equivalent NVIDIA for same model sizes.

### Best Mac configurations for training

| Config | Price | Memory | Best For |
|--------|-------|--------|----------|
| Mac mini M4 Pro, 64GB | ~$1,800 | 64 GB | 7–8B LoRA, 35B QLoRA |
| Mac Studio M4 Max 40-GPU, 128GB | $3,699 | 128 GB | 50B LoRA, 200B QLoRA |
| Mac Studio M3 Ultra 80-GPU, 192GB | ~$6,499 | 192 GB | 70B LoRA, 300B+ QLoRA |
| Mac Studio M3 Ultra 80-GPU, 512GB | $14,099 | 512 GB | 200B+ LoRA, 600B+ QLoRA |

### Model capacity by unified memory

| Memory | Max LoRA (FP16) | Max QLoRA (4-bit) | 1.8B Time | 8B Time |
|--------|----------------|-------------------|-----------|---------|
| 16 GB | ~3B | ~14–20B | ~1–2 hr | Not practical |
| 24 GB | ~7B | ~25–35B | ~40–60 min | ~4–8 hr (QLoRA) |
| 32 GB | ~8B | ~35–45B | ~30–50 min | ~3–6 hr (QLoRA) |
| 64 GB | ~20B | ~90–100B | ~20–40 min | ~2–4 hr |
| 96 GB | ~35B | ~140B | ~15–30 min | ~1.5–3 hr |
| 128 GB | ~50B | ~200B | ~15–25 min | ~1–2 hr |
| 192 GB | ~70B | ~300B | ~10–20 min | ~1–2 hr |
| 512 GB | ~200B+ | ~600B+ | <10 min | <1 hr |

**Recommended framework:** **MLX + mlx-lm** (purpose-built for Apple Silicon, 2–3× faster than PyTorch MPS). PyTorch MPS backend remains beta with no bitsandbytes/QLoRA support. MLX supports LoRA and QLoRA via `mlx_lm.lora`. Limitations: no CUDA, no FlashAttention, no DeepSpeed, no multi-node training.

---

## Cloud GPU instances: pricing across all major providers

### AWS EC2 (post-June 2025 price cuts — up to 45% reduction)

| Instance | GPU | Count | Total VRAM | On-Demand $/hr | Spot $/hr |
|----------|-----|-------|-----------|---------------|----------|
| p3.2xlarge | V100 | 1 | 16 GB | ~$3.06 | ~$0.92 |
| p3.16xlarge | V100 | 8 | 128 GB | ~$24.48 | ~$7.34 |
| p4d.24xlarge | A100 40GB | 8 | 320 GB | ~$21.95 | ~$7.04 |
| p4de.24xlarge | A100 80GB | 8 | 640 GB | ~$27.45 | ~$8.79 |
| p5.48xlarge | H100 80GB | 8 | 640 GB | ~$31.44 | ~$9.43 |
| p5e.48xlarge | H200 141GB | 8 | 1,128 GB | ~$38–42 | Contact |
| p5en.48xlarge | H200 141GB | 8 | 1,128 GB | ~$35–40 | Contact |
| g5.xlarge | A10G | 1 | 24 GB | ~$1.01 | ~$0.34 |
| g5.12xlarge | A10G | 4 | 96 GB | ~$5.67 | ~$1.70 |
| g6.xlarge | L4 | 1 | 24 GB | ~$0.81 | ~$0.27 |
| g6.48xlarge | L4 | 8 | 192 GB | ~$13.35 | ~$4.54 |
| trn1.2xlarge | Trainium | 1 | 32 GB | ~$1.34 | — |
| trn1.32xlarge | Trainium | 16 | 512 GB | ~$21.50 | — |
| trn2.48xlarge | Trainium2 | 16 | 1.5 TiB | ~$21.50 | — |

**G6e instances** use L40S (48GB each) — roughly 50–80% more than G6. **Inf2 is inference-only** — not for training. **P6-B200** (Blackwell) launched May 2025 via Capacity Blocks. Trainium2 offers **30–40% better price-performance** than P5en but requires Neuron SDK.

### Google Cloud

| Instance | GPU | Count | Total VRAM | On-Demand $/hr |
|----------|-----|-------|-----------|---------------|
| a2-highgpu-1g | A100 40GB | 1 | 40 GB | ~$3.67 |
| a2-highgpu-8g | A100 40GB | 8 | 320 GB | ~$29.39 |
| a2-ultragpu-1g | A100 80GB | 1 | 80 GB | ~$5.00 |
| a2-ultragpu-8g | A100 80GB | 8 | 640 GB | ~$40.00 |
| a3-highgpu-1g | H100 80GB | 1 | 80 GB | ~$3.00–3.68 |
| a3-highgpu-8g | H100 80GB | 8 | 640 GB | ~$24.00–29.39 |
| g2-standard-4 | L4 | 1 | 24 GB | ~$0.84 |
| g2-standard-96 | L4 | 8 | 192 GB | ~$9.87 |

**Google Cloud TPU pricing (per chip-hour):** TPU v4: $3.22 | TPU v5e: **$1.20** | TPU v5p: $4.20 | Trillium (v6e): $2.70. The **v5e at $1.20/chip-hr** is the cost-efficiency leader for JAX-compatible workloads.

### Microsoft Azure

| Instance | GPU | Count | Total VRAM | On-Demand $/hr | Spot $/hr |
|----------|-----|-------|-----------|---------------|----------|
| NC24ads_A100_v4 | A100 80GB | 1 | 80 GB | ~$3.67 | ~$1.15 |
| NC96ads_A100_v4 | A100 80GB | 4 | 320 GB | ~$14.69 | ~$4.60 |
| NC40ads_H100_v5 | H100 80GB | 1 | 80 GB | ~$6.98 | ~$2.09 |
| ND96asr_v4 | A100 40GB | 8 | 320 GB | ~$27.20 | ~$8.16 |
| ND96amsr_A100_v4 | A100 80GB | 8 | 640 GB | ~$32.77 | ~$9.83 |
| ND96isr_H100_v5 | H100 80GB | 8 | 640 GB | ~$98.32 | ~$18.17 |

Azure's H100 pricing is **3–4× higher** than AWS/GCP at list price, though spot instances narrow the gap. Azure's strength is enterprise integration and InfiniBand networking.

### Specialized cloud providers — where the real value is

**H100 80GB SXM price comparison ($/GPU/hr):**

| Provider | On-Demand | Spot/Community | Reserved |
|----------|----------|---------------|---------|
| **Vast.ai** | ~$1.55 | ~$0.75–1.00 | Up to 50% off |
| **RunPod** | $1.50 (community) / $2.69 (secure) | 50–70% off | Contact |
| **Lambda Labs** | $3.44 (8×) / $3.78 (1×) | N/A | $2.19–2.29 (cluster) |
| **Modal** | ~$3.95 (serverless) | N/A | N/A |
| **CoreWeave** | ~$6.15 (HGX) | N/A | Up to 60% off |
| **Together AI** | ~$2.50–3.50 (cluster) | N/A | Custom |
| **AWS** | ~$3.93 (P5, per-GPU) | ~$1.18 | ~$2.16 (1yr) |
| **GCP** | ~$3.00–3.68 | ~$2.25 | ~$2.10–2.58 |

**A100 80GB SXM price comparison ($/GPU/hr):**

| Provider | On-Demand | Lowest Available |
|----------|----------|-----------------|
| **Vast.ai** | ~$0.67 | ~$0.35 (interruptible) |
| **RunPod** | $0.79 (community) | $0.60 (PCIe) |
| **Lambda Labs** | $1.79 (8×) | $1.29 (40GB) |
| **Modal** | ~$2.50 | — |
| **CoreWeave** | ~$2.21 (GPU only) | ~$0.88 (committed) |

**Provider-specific notes:**

- **Lambda Labs**: No egress fees, Lambda Stack pre-installed, InfiniBand networking, 50% academic discount reported. B200 at $5.74/GPU/hr. 1-Click Clusters for 16–2,000+ GPUs
- **RunPod**: Per-second billing, no egress fees, community cloud has cheapest rates. RTX 4090 at **$0.20–0.39/hr**, RTX 3090 at **$0.11/hr**
- **Vast.ai**: Peer-to-peer marketplace with variable reliability. H100 as low as **$1.49/hr** during sales. Best for fault-tolerant, budget-constrained research
- **CoreWeave**: Kubernetes-native, à la carte pricing (GPU + CPU + RAM separate). Strong for enterprise HPC
- **Together AI**: Fine-tuning API charges per token processed. LoRA SFT for models up to 16B: **~$0.30–0.50/M tokens**. Supports 100B+ models. $25 free credits
- **Modal**: True serverless with per-second billing, sub-second cold starts, $30/month free credits. L4 at **$0.80/hr**, H100 at **$3.95/hr**

### Estimating fine-tuning costs for an 8B model on 5,000 samples

| Platform | Instance | Time | Total Cost |
|----------|----------|------|-----------|
| RunPod RTX 4090 | Community | ~2–4 hr | **$0.40–1.56** |
| GCP g2-standard-4 (L4) | On-demand | ~2.5–4 hr | **$2.10–3.36** |
| AWS g5.xlarge (A10G) | On-demand | ~2.5–4 hr | **$2.52–4.02** |
| RunPod A100 80GB | Community | ~40–70 min | **$0.53–0.92** |
| Lambda A100 80GB | 1× instance | ~40–70 min | **$1.19–2.09** |
| AWS p5 (8×H100) | Per-GPU share | ~5–15 min | **$2.62–7.86** |
| Together AI API | LoRA SFT | Minutes | **~$3–8** (token-based) |

---

## Dedicated AI training hardware beyond GPUs

### Google TPU

| TPU | HBM | Bandwidth | BF16 TFLOPS | Price/chip/hr | Max LoRA | 8B Time |
|-----|-----|-----------|-------------|--------------|----------|---------|
| v4 | 32 GB | ~1,200 GB/s | 275 | $3.22 | ~13B | ~1–2.5 hr |
| v5e | 16 GB | ~819 GB/s | 197 | **$1.20** | ~7B | ~2–4 hr |
| v5p | 95 GB | ~2,800 GB/s | 459 | $4.20 | ~40–45B | ~30 min–1 hr |
| v6e (Trillium) | 32 GB | ~1,600 GB/s | 918 | $2.70 | ~13B | ~25–50 min |

TPUs require **JAX** (preferred) or PyTorch/XLA. XLA compiler auto-optimizes for TPU hardware. Best with batch sizes that are multiples of **128** and feature dimensions aligned with 128×128 systolic arrays. The v6e (Trillium) delivers **4.7× the performance** of v5e per chip. Key users: Anthropic (Claude), Google DeepMind (Gemini).

### Intel Gaudi

| Chip | HBM | Bandwidth | BF16 TFLOPS | FP8 TFLOPS | TDP | Price |
|------|-----|-----------|-------------|------------|-----|-------|
| Gaudi 2 | 96 GB HBM2e | 2,450 GB/s | 432 | 865 | 600W | ~$8,125/chip |
| Gaudi 3 | 128 GB HBM2e | 3,670 GB/s | 1,835 | 1,835 | 600–1,200W | ~$15,625/chip |

Gaudi 3's BF16 reaches **93% of H100** (1,835 vs 1,979 TFLOPS) at roughly **half the price**. However, Intel revised 2025 shipment targets down 30%, and the software ecosystem (SynapseAI) remains less mature. Framework: **Optimum Habana** for HuggingFace integration. Available on IBM Cloud and Intel Tiber Developer Cloud.

### Cerebras Wafer-Scale Engine

| System | Transistors | Cores | On-Chip SRAM | Compute | External Memory | Power |
|--------|------------|-------|-------------|---------|----------------|-------|
| CS-2 (WSE-2) | 2.6T | 850,000 | 40 GB | ~75 PFLOPS | Up to 1.2 PB (MemoryX) | ~23 kW |
| CS-3 (WSE-3) | **4 trillion** | 900,000 | 40 GB | **125 PFLOPS** | Up to 1.2 PB (MemoryX) | ~23 kW |

Cerebras uses a **weight streaming architecture** — entire model weights live in off-chip MemoryX units and stream to the wafer for computation. This eliminates complex tensor/pipeline parallelism. A single CS-3 can train models up to **24 trillion parameters**. Near-perfect linear scaling across clusters. Multi-million dollar systems; primarily for large-scale pre-training.

### Groq LPU — inference only

Groq's LPU is **explicitly designed for inference, NOT training**. ~230 MB on-chip SRAM per chip (no HBM), optimized for deterministic low-latency token generation. Delivers 300–750 tokens/sec on Llama 2 70B. Not relevant for any fine-tuning or training workloads.

### SambaNova SN40L

The SN40L Reconfigurable Dataflow Unit uses a **three-tier memory system**: 520 MB on-chip SRAM + 64 GB HBM (~2 TB/s) + up to 1.5 TB DDR per socket. Delivers **638 BF16 TFLOPS** per socket. A 16-socket node reaches 10.2 BF16 PFLOPS in an air-cooled, 10 kW rack — dramatically lower power than GPU alternatives at ~140 kW. Supports both training and inference. Sold as full-stack enterprise solution.

---

## Multi-GPU training: interconnects and parallelism

### NVLink generation comparison

| Generation | Architecture | Per-GPU Bandwidth | Key Systems |
|------------|-------------|-------------------|-------------|
| NVLink 3.0 | Ampere (A100) | 600 GB/s | DGX A100 |
| NVLink 4.0 | Hopper (H100/H200) | 900 GB/s | DGX H100 |
| NVLink 5.0 | Blackwell (B200/B300) | **1,800 GB/s** | DGX B200, GB200 NVL72 |

**NVLink 5.0 is 14× PCIe Gen5** (128 GB/s). NVSwitch creates fully-connected all-to-all GPU fabrics — required for 4+ GPU systems needing full-mesh connectivity. Consumer/workstation GPUs do not use NVSwitch.

**When NVLink matters:** Tensor parallelism (sharding layers across GPUs) and pipeline parallelism require NVLink. For **LoRA fine-tuning with data parallelism**, PCIe is often sufficient because gradient syncs are small.

### Parallelism strategy selection

- **Data Parallelism (DDP):** Model fits on 1 GPU; replicate and split data. Use for LoRA fine-tuning scale-out
- **FSDP/DeepSpeed ZeRO:** Model doesn't fit on 1 GPU; shard parameters across GPUs. FSDP is up to 5× faster than ZeRO-3 for models ≤10B; ZeRO scales more smoothly for 70B+
- **Tensor Parallelism:** Split individual layers across GPUs. Requires NVLink. Use within nodes
- **Pipeline Parallelism:** Split sequential layers across GPUs. Tolerates higher latency. Use across nodes
- **3D Parallelism (TP + PP + DP):** For frontier-scale 100B+ training. Megatron-LM, NeMo

---

## Precision format support matrix

| Format | Ampere (A100, RTX 30) | Ada (RTX 40, L40S) | Hopper (H100/H200) | Blackwell (B200) | CDNA2 (MI250X) | CDNA3 (MI300X) | CDNA4 (MI350X) | Apple Silicon |
|--------|----------------------|--------------------|--------------------|------------------|---------------|----------------|----------------|-------------|
| FP32 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| TF32 | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| FP16 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| BF16 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ (M4+) |
| FP8 | ❌ | ✅ | ✅ (TE) | ✅ | ❌ | ✅ (FNUZ) | ✅ | ❌ |
| FP6 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| FP4 | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ✅ | ❌ |
| INT8 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| INT4 | ✅ (sw) | ✅ (sw) | ✅ (sw) | ✅ | ❌ | ✅ (sw) | ✅ | ✅ (sw) |

---

## LoRA/QLoRA best practices by VRAM tier

These configurations are tuned for **2025 best practices** using Unsloth or equivalent optimized frameworks. Target modules for LLaMA-style architectures: `q_proj, k_proj, v_proj, o_proj, gate_proj, up_proj, down_proj`.

| Parameter | 8 GB | 12 GB | 16 GB | 24 GB | 32 GB | 48 GB | 64 GB | 80 GB+ |
|-----------|------|-------|-------|-------|-------|-------|-------|--------|
| **Max model** | 3B (QLoRA) | 8B (QLoRA) | 8B (QLoRA) | 8B (LoRA) / 20B (QLoRA) | 14B (LoRA) / 30B (QLoRA) | 30B (LoRA) / 70B (QLoRA) | 70B (QLoRA) | 70B (LoRA) |
| **QLoRA required?** | Always | For 8B+ | For 8B+ | For >8B | For >14B | For >30B | For >30B | No |
| **LoRA rank (r)** | 8 | 8–16 | 16 | 16–32 | 32 | 32–64 | 64 | 64–128 |
| **LoRA alpha** | 8–16 | 16–32 | 16–32 | 32–64 | 32–64 | 64–128 | 128 | 128–256 |
| **LoRA dropout** | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Micro batch size** | 1 | 1–2 | 2 | 2–4 | 4–8 | 4–8 | 8–16 | 8–16 |
| **Grad accum steps** | 8–16 | 8 | 4–8 | 4 | 2–4 | 2–4 | 2 | 1–2 |
| **Effective batch** | 8–16 | 8–16 | 8–16 | 8–16 | 16–32 | 16–32 | 16–32 | 16–32 |
| **Max seq length** | 512–1024 | 1024–2048 | 2048 | 2048–4096 | 4096–8192 | 8192–16384 | 16K–32K | 32K–131K+ |
| **Optimizer** | paged_adamw_8bit | paged_adamw_8bit | adamw_8bit | adamw_8bit | adamw_8bit | AdamW | AdamW | AdamW |
| **Grad checkpoint** | Yes ("unsloth") | Yes ("unsloth") | Yes | Yes | Optional | Optional | Optional | No |
| **Flash Attention 2** | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes |
| **Quant type** | nf4 | nf4 | nf4 | nf4 (if QLoRA) | nf4 (if QLoRA) | nf4 (if QLoRA) | nf4 (if QLoRA) | N/A |
| **Learning rate** | 1e-4 to 2e-4 | 1e-4 to 2e-4 | 1e-4 to 2e-4 | 5e-5 to 2e-4 | 5e-5 to 2e-4 | 5e-5 to 2e-4 | 5e-5 to 1e-4 | 5e-5 to 1e-4 |

**NF4** (NormalFloat4) is preferred over FP4 for QLoRA quantization. LoRA dropout of **0** is optimal for Unsloth (enables kernel fusion). Epochs should be **1–3** to avoid overfitting.

---

## Recommended frameworks by hardware class

| Hardware Class | Primary Framework | Alternatives |
|---------------|-------------------|-------------|
| Consumer NVIDIA (8–24GB) | **Unsloth** (2–5× faster, 60–70% VRAM savings) | Axolotl, TRL + PEFT |
| Professional NVIDIA (24–48GB) | **Axolotl** or **Unsloth** | NeMo, TRL + DeepSpeed |
| Data Center NVIDIA (40–80GB+) | **NeMo + Megatron-LM** | DeepSpeed ZeRO, FSDP, Unsloth |
| AMD Consumer (ROCm) | **PyTorch ROCm + PEFT** (Linux Docker) | Unsloth (AMD support added 2025) |
| AMD Instinct | **PyTorch ROCm + DeepSpeed** | Megatron-LM, HuggingFace |
| Apple Silicon | **MLX + mlx-lm** | PyTorch MPS (beta, slower) |
| Google TPU | **JAX** (preferred) | PyTorch/XLA, TensorFlow |
| AWS Trainium | **Neuron SDK + optimum-neuron** | PyTorch via TorchNeuron |
| Intel Gaudi | **Optimum Habana + SynapseAI** | PyTorch (device="hpu") |

### Unsloth performance specifics

Unsloth delivers **2–2.7× training speedup** with **60–74% VRAM reduction** and mathematically exact results (zero accuracy loss). Key settings: `use_gradient_checkpointing="unsloth"` (30% less VRAM than standard), `lora_dropout=0` (enables kernel fusion), padding-free training auto-enabled. Supports NVIDIA CUDA 7.0+, AMD ROCm, and Intel. MoE models see **7–12× speedups**. Verified VRAM examples: Llama 3.1 8B QLoRA drops from ~12GB to ~7–9GB; Qwen3-4B QLoRA from ~6GB to ~3GB.

---

## Conclusion: what these numbers mean for a training script generator

Three rules should drive the auto-configuration logic. First, **VRAM determines feasibility** — use the max model size tables to select LoRA vs QLoRA vs "not possible" for each hardware-model combination. Second, **bandwidth determines speed** — the 1,792 GB/s of an RTX 5090 vs 272 GB/s of an RTX 4060 means roughly 6× throughput difference independent of compute TFLOPS. Third, **framework selection is hardware-dependent** — Unsloth for NVIDIA consumer/professional, MLX for Apple Silicon, JAX for TPU, and Neuron SDK for Trainium are not interchangeable.

For the configuration file, the highest-leverage preset tiers are: **8GB** (QLoRA mandatory, rank 8, batch 1, seq 512), **12–16GB** (QLoRA for 8B+, rank 16, batch 2), **24GB** (LoRA for ≤8B, QLoRA for larger, rank 16–32, batch 4–8), **48GB** (LoRA for ≤30B, rank 32–64, batch 8), and **80GB+** (LoRA for nearly anything, rank 64–128, batch 16). Cloud pricing has dropped **50–70% since 2023** — H100 rentals now start at $1.50/GPU/hr on community platforms and $2–4/hr on hyperscalers, making even 8×H100 fine-tuning runs cost under $10 for an 8B model.