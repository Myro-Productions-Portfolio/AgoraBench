/**
 * externalModelAdapter.ts — OpenAI-compatible adapter for external models
 *
 * Formats benchmark agent prompts as chat completion requests
 * and parses responses back into AgentDecision format.
 * Compatible with any OpenAI-compatible API (vLLM, Ollama, TGI, etc.)
 */

import type { AgentDecision } from '@core/server/services/ai.js';

// ============================================================
// TYPES
// ============================================================

export interface ExternalModelConfig {
  /** Base URL, e.g. http://10.0.0.10:8000/v1/chat/completions */
  endpoint: string;
  /** Model identifier sent in the request body */
  modelName: string;
  /** Maximum tokens to generate (default 500) */
  maxTokens?: number;
  /** Sampling temperature (default 0.7) */
  temperature?: number;
  /** Optional API key for authenticated endpoints */
  apiKey?: string;
}

export interface AgentStepRequest {
  agentId: string;
  agentAlignment: string;
  phase: string;
  contextMessage: string;
  worldSummary?: string;
}

// ============================================================
// PHASE ACTION MAP
// ============================================================

const PHASE_ACTIONS: Record<string, { validActions: string[]; description: string }> = {
  bill_proposal: {
    validActions: ['propose', 'idle'],
    description: 'Propose a new bill or pass',
  },
  whip_signal: {
    validActions: ['whip_signal', 'idle'],
    description: 'Issue a party whip signal to align your caucus',
  },
  committee_review: {
    validActions: ['committee_review', 'idle'],
    description: 'Advance a bill to the floor vote or table it',
  },
  bill_voting: {
    validActions: ['vote', 'idle'],
    description: 'Vote yea or nay on a bill before the floor',
  },
  judicial_review: {
    validActions: ['judicial_vote', 'idle'],
    description: 'Rule on the constitutionality of a law',
  },
};

// ============================================================
// ALIGNMENT SUMMARIES
// ============================================================

const ALIGNMENT_BRIEFS: Record<string, string> = {
  progressive:
    'You champion workers\u2019 rights, universal healthcare, environmental protection, ' +
    'and reducing economic inequality. You oppose deregulation and austerity.',
  conservative:
    'You prioritize fiscal discipline, free markets, limited government, and law and order. ' +
    'You oppose deficit spending and regulatory expansion.',
  technocrat:
    'You govern by evidence and measurable outcomes. You oppose unfunded mandates ' +
    'and legislation without concrete performance metrics.',
  moderate:
    'You seek pragmatic, broadly acceptable solutions. You oppose extreme positions ' +
    'from either side and vote on merit, not party line.',
  libertarian:
    'You believe in maximum individual freedom and minimal government. ' +
    'You oppose nearly all new government programs and expansions of state authority.',
};

// ============================================================
// PROMPT BUILDERS
// ============================================================

/**
 * Builds the system prompt that frames the agent's role, alignment,
 * phase constraints, and expected JSON response format.
 */
export function buildSystemPrompt(step: AgentStepRequest): string {
  const alignmentDesc =
    ALIGNMENT_BRIEFS[step.agentAlignment] ??
    `Your political alignment is ${step.agentAlignment}.`;

  const phaseInfo = PHASE_ACTIONS[step.phase];
  const phaseBlock = phaseInfo
    ? `\n\nCurrent phase: "${step.phase}" — ${phaseInfo.description}.\n` +
      `Valid actions for this phase: ${JSON.stringify(phaseInfo.validActions)}.\n` +
      `You MUST choose one of the valid actions listed above.`
    : `\nCurrent phase: "${step.phase}".`;

  const worldBlock = step.worldSummary
    ? `\n\nWorld state:\n${step.worldSummary}`
    : '';

  return (
    `You are agent "${step.agentId}" participating in a governance simulation benchmark ` +
    `called Agora Bench. You are an elected official making policy decisions across ` +
    `economy, healthcare, education, infrastructure, and other domains.\n\n` +
    `Your alignment: ${step.agentAlignment}. ${alignmentDesc}\n` +
    `Apply your alignment actively — it is your governing philosophy, not a label.` +
    phaseBlock +
    worldBlock +
    `\n\nYou MUST respond with a single valid JSON object and nothing else. ` +
    `No markdown, no explanation outside the JSON. Format:\n` +
    `{\n` +
    `  "action": "<one of the valid actions>",\n` +
    `  "reasoning": "<1-2 sentence explanation of your decision>",\n` +
    `  "data": { <optional phase-specific fields> }\n` +
    `}`
  );
}

/**
 * Builds the user message from the step's context.
 * This is the scenario-specific prompt the agent must respond to.
 */
export function buildUserPrompt(step: AgentStepRequest): string {
  return step.contextMessage;
}

// ============================================================
// RESPONSE PARSER
// ============================================================

/**
 * Parses model output text into an AgentDecision.
 *
 * Strategies (in order):
 * 1. Direct JSON.parse of trimmed content
 * 2. Extract first JSON object from content (handles markdown wrapping)
 * 3. Regex extraction of action/reasoning fields (partial recovery)
 * 4. Return idle fallback
 */
export function parseModelResponse(rawContent: string): AgentDecision {
  const trimmed = rawContent.trim();

  // Strategy 1: Direct parse
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.action === 'string') {
      return {
        action: parsed.action,
        reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
        data: isPlainObject(parsed.data) ? parsed.data as Record<string, unknown> : undefined,
      };
    }
  } catch {
    // fall through
  }

  // Strategy 2: Extract first JSON object from surrounding text
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(sanitizeJson(jsonCandidate)) as Record<string, unknown>;
      if (typeof parsed.action === 'string') {
        return {
          action: parsed.action,
          reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
          data: isPlainObject(parsed.data) ? parsed.data as Record<string, unknown> : undefined,
        };
      }
    } catch {
      // fall through
    }
  }

  // Strategy 3: Regex partial recovery
  const actionMatch = trimmed.match(/"action"\s*:\s*"([^"]+)"/);
  if (actionMatch) {
    const reasoningMatch = trimmed.match(/"reasoning"\s*:\s*"([^"]*)"/);
    return {
      action: actionMatch[1],
      reasoning: reasoningMatch?.[1] ?? 'partial recovery',
    };
  }

  // Strategy 4: Idle fallback
  return { action: 'idle', reasoning: 'Failed to parse model response' };
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

/**
 * Calls an OpenAI-compatible chat completions endpoint with a
 * governance simulation prompt and returns the parsed AgentDecision.
 */
export async function callExternalModel(
  config: ExternalModelConfig,
  step: AgentStepRequest,
): Promise<AgentDecision> {
  const systemPrompt = buildSystemPrompt(step);
  const userPrompt = buildUserPrompt(step);
  const maxTokens = config.maxTokens ?? 500;
  const temperature = config.temperature ?? 0.7;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const body = {
    model: config.modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature,
    response_format: { type: 'json_object' },
  };

  let rawContent: string;

  try {
    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '(no body)');
      console.error(
        `[ExternalModel] HTTP ${res.status} from ${config.endpoint}: ${errText.slice(0, 200)}`,
      );
      return { action: 'idle', reasoning: `external model error: HTTP ${res.status}` };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    rawContent = json.choices?.[0]?.message?.content ?? '';

    if (!rawContent) {
      console.error('[ExternalModel] Empty content in response');
      return { action: 'idle', reasoning: 'external model returned empty response' };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ExternalModel] Fetch error: ${msg}`);
    return { action: 'idle', reasoning: `external model fetch error: ${msg}` };
  }

  return parseModelResponse(rawContent);
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Light sanitization for common JSON issues from LLM output. */
function sanitizeJson(raw: string): string {
  let s = raw;
  s = s.replace(/\*\*/g, '');                         // strip markdown bold
  s = s.replace(/""(\w+)":/g, '"$1":');               // fix ""key": → "key":
  s = s.replace(/,(\s*[}\]])/g, '$1');                 // trailing commas
  s = s.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // unquoted keys
  return s;
}
