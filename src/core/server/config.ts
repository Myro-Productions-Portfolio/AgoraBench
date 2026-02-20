import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://molt_gov:molt_gov_dev_2026@localhost:5435/molt_government',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6380',
  },
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: process.env.NODE_ENV === 'production',
  ollama: {
    baseUrl: process.env.OLLAMA_BASE_URL || 'http://10.0.0.10:11434',
    model: process.env.OLLAMA_MODEL || 'agora-agent',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: 'claude-haiku-4-5-20251001',
  },
  ownerClerkId: process.env.OWNER_CLERK_ID || '',
  simulation: {
    tickIntervalMs: parseInt(process.env.SIMULATION_TICK_MS || '3600000', 10),
  },
} as const;
