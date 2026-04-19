import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { observeSimulation, executeIntervention, getInterventionHistory } from '../lib/orchestratorCore.js';

/* Each session gets a fresh McpServer. Tools are registered once per server instance. */
export function createAgoraBenchMcpServer(): McpServer {
  const server = new McpServer({
    name: 'agorabench-orchestrator',
    version: '1.0.0',
  });

  server.registerTool(
    'observe_simulation',
    {
      title: 'Observe the AgoraBench simulation',
      description:
        'Returns a full snapshot of the current simulation state — agent roster, legislation pipeline, coalitions, elections, recent activity, economy, and recent orchestrator interventions. Call this first every cycle to understand what is happening before deciding whether to intervene.',
      inputSchema: {},
    },
    async () => {
      const data = await observeSimulation();
      return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
    },
  );

  server.registerTool(
    'intervene',
    {
      title: 'Execute an orchestrator intervention',
      description:
        'Apply one of 5 interventions to the simulation. Use sparingly — orchestrator fatigue makes the sim feel puppeted. Every intervention is logged in orchestrator_interventions with your reasoning.',
      inputSchema: {
        type: z
          .enum(['personality_mod', 'inject_event', 'config_change', 'agent_toggle', 'trigger_election'])
          .describe('Intervention type'),
        reasoning: z
          .string()
          .describe('Why you are taking this action. Stored for future-you to reference.'),
        agentId: z.string().optional().describe('For personality_mod or agent_toggle'),
        mod: z.string().optional().describe('For personality_mod — the new personality nudge string, or empty to clear'),
        isActive: z.boolean().optional().describe('For agent_toggle'),
        eventType: z
          .enum(['crisis', 'media_event', 'external_pressure'])
          .optional()
          .describe('For inject_event'),
        config: z.record(z.unknown()).optional().describe('For inject_event — event-specific configuration'),
        description: z.string().optional().describe('For inject_event — human-readable description'),
        changes: z.record(z.unknown()).optional().describe('For config_change — runtime config fields to update'),
        positionType: z.string().optional().describe('For trigger_election — e.g. "president", "senator"'),
      },
    },
    async (args) => {
      const intervention = await executeIntervention(args as Parameters<typeof executeIntervention>[0]);
      return { content: [{ type: 'text', text: JSON.stringify(intervention, null, 2) }] };
    },
  );

  server.registerTool(
    'get_history',
    {
      title: 'Get orchestrator intervention history',
      description:
        'Returns the most recent orchestrator interventions (newest first). Use this to avoid repeating yourself and to audit past actions.',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Max rows (1-200, default 50)'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
      },
    },
    async ({ limit, offset }) => {
      const rows = await getInterventionHistory(limit ?? 50, offset ?? 0);
      return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
    },
  );

  return server;
}
