 Design Section 4: API Handshake with Spark Mission Control

  This is the contract that lets Spark MC plug models into our dojo. Two endpoints, as the Perplexity research outlined:

  Endpoint 1: POST /api/benchmark/run (Spark MC calls us)

  Spark MC (or any external system) triggers a benchmark run:

  Request:
  {
    scenarioId: "polarized-legislature",
    modelEndpoint: "http://192.168.3.20:8000/v1/chat/completions",  // or any OpenAI-compatible API
    modelName: "gpt-oss-20b-finetune-v3",
    modelBackend: "vllm",
    agentAssignment: "all" | "designated" | [list of agent IDs],
    runs: 3,          // repeat for statistical significance
    callbackUrl: "http://192.168.3.30:9010/api/pipeline/{id}/advance"  // optional: notify when done
  }

  Response:
  {
    runIds: ["run-abc", "run-def", "run-ghi"],
    status: "queued",
    estimatedDuration: "~15 minutes per run"
  }

  Endpoint 2: GET /api/benchmark/results/{runId} (Spark MC polls for results)

  Response:
  {
    runId: "run-abc",
    scenarioId: "polarized-legislature",
    status: "completed",
    modelName: "gpt-oss-20b-finetune-v3",
    configHash: "a1b2c3d4",
    metricsReport: { outcome: {...}, agent: {...}, coordination: {...}, composite: 78.4, grade: "B+" },
    rawDataUrl: "/api/benchmark/runs/run-abc/export"  // CSV/JSONL download
  }

  Endpoint 3: GET /api/benchmark/scenarios (Spark MC discovers available scenarios)

  Response:
  {
    scenarios: [
      { id: "baseline-governance", name: "Baseline Governance", difficulty: "easy", category: "outcome", ... },
      { id: "polarized-legislature", name: "Polarized Legislature", difficulty: "medium", ... },
      ...
    ]
  }

  Endpoint 4: POST /api/benchmark/agent-step (our runner calls external model)

  During a benchmark run, when an agent needs a decision, our Benchmark Runner calls the external model endpoint using the standard
  agent_step contract:

  Request to modelEndpoint:
  {
    agentId: "senator-jones",
    agoraId: "agora_senator_jones",
    observation: "You are in a floor vote on HR-47 'Infrastructure Modernization Act'. The bill increases spending by M$500K...",
    availableActions: ["vote_yea", "vote_nay", "vote_abstain"],
    roleMetadata: { alignment: "moderate", office: "congress_member", party: "Civic Alliance", whipDirection: "yea" },
    episodeId: "run-abc",
    tick: 42,
    configHash: "a1b2c3d4"
  }

  Expected Response:
  {
    chosenAction: "vote_yea",
    actionArgs: {},
    reasoning: "The infrastructure bill aligns with my moderate stance...",
    confidence: 0.87
  }

  This is compatible with Spark MC's vLLM endpoint — we format the agent_step as a chat completion prompt and parse the structured response,
  same pattern our ai.ts already uses. No changes needed on Ross's side.

  Integration flow:

  Spark MC Pipeline                    AgoraBench
  ─────────────────                    ──────────
  1. Fine-tune model on DGX
  2. POST /api/benchmark/run  ──────→  3. Queue benchmark run
     (model endpoint + scenario)        4. Instantiate scenario world
                                        5. Run ticks, calling model
                                           endpoint for decisions
                                        6. Compute metrics
  7. GET /api/benchmark/results ◄────  8. Return metrics report
     (poll or callback)
  9. If pass rate < target:
     loop back to step 1