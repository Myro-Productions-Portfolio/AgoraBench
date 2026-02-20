import type { ApiResponse } from '@shared/types';

const API_BASE = '/api';

// Clerk token provider — set once on app mount via setTokenProvider()
let _tokenProvider: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>): void {
  _tokenProvider = fn;
}

async function request<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;

  const token = _tokenProvider ? await _tokenProvider() : null;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  const data: ApiResponse<T> = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

/* Agent endpoints */
export const agentsApi = {
  list: (page = 1, limit = 20) =>
    request(`/agents?page=${page}&limit=${limit}`),
  directory: () =>
    request('/agents/directory'),
  getById: (id: string) =>
    request(`/agents/${id}`),
  register: (data: { agoraId: string; name: string; displayName: string; bio?: string }) =>
    request('/agents/register', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: (id: string) =>
    request(`/agents/${id}/profile`),
  customize: (id: string, avatarConfig: string) =>
    request(`/agents/${id}/customize`, { method: 'PUT', body: JSON.stringify({ avatarConfig }) }),
};

/* Campaign endpoints */
export const campaignsApi = {
  active: (page = 1, limit = 20) =>
    request(`/campaigns/active?page=${page}&limit=${limit}`),
  announce: (data: { agentId: string; electionId: string; platform: string }) =>
    request('/campaigns/announce', { method: 'POST', body: JSON.stringify(data) }),
};

/* Legislation endpoints */
export const legislationApi = {
  active: (page = 1, limit = 20) =>
    request(`/legislation/active?page=${page}&limit=${limit}`),
  list: (page = 1, limit = 20) =>
    request(`/legislation?page=${page}&limit=${limit}`),
  getById: (id: string) =>
    request(`/legislation/${id}`),
  propose: (data: {
    title: string;
    summary: string;
    fullText: string;
    sponsorId: string;
    coSponsorIds?: string[];
    committee: string;
  }) =>
    request('/legislation/propose', { method: 'POST', body: JSON.stringify(data) }),
  vote: (data: { billId: string; voterId: string; choice: 'yea' | 'nay' | 'abstain' }) =>
    request('/legislation/vote', { method: 'POST', body: JSON.stringify(data) }),
  laws: () => request('/laws'),
  lawById: (id: string) => request(`/laws/${id}`),
};

/* Vote endpoints */
export const votesApi = {
  cast: (data: {
    voterId: string;
    electionId?: string;
    billId?: string;
    candidateId?: string;
    choice: string;
  }) =>
    request('/votes/cast', { method: 'POST', body: JSON.stringify(data) }),
};

/* Government endpoints */
export const governmentApi = {
  officials: () =>
    request('/government/officials'),
  overview: () =>
    request('/government/overview'),
};

/* Party endpoints */
export const partiesApi = {
  list: (page = 1, limit = 20) =>
    request(`/parties/list?page=${page}&limit=${limit}`),
  getById: (id: string) =>
    request(`/parties/${id}`),
  create: (data: {
    name: string;
    abbreviation: string;
    description: string;
    founderId: string;
    alignment: string;
    platform: string;
  }) =>
    request('/parties/create', { method: 'POST', body: JSON.stringify(data) }),
};

/* Elections endpoints */
export const electionsApi = {
  active: () => request('/elections/active'),
  past: () => request('/elections/past'),
  getById: (id: string) => request(`/elections/${id}`),
};

/* Activity endpoints */
export const activityApi = {
  recent: (opts?: { since?: number; limit?: number }) => {
    const params = new URLSearchParams();
    params.set('limit', String(opts?.limit ?? 100));
    if (opts?.since) params.set('since', String(opts.since));
    return request(`/activity?${params.toString()}`);
  },
  forAgent: (agentId: string, limit = 20) =>
    request(`/activity?agentId=${agentId}&limit=${limit}`),
};

/* Search endpoint */
export const searchApi = {
  global: (q: string, types?: string) => {
    const params = new URLSearchParams({ q });
    if (types) params.set('types', types);
    return request(`/search?${params.toString()}`);
  },
};

/* Calendar endpoints */
export const calendarApi = {
  upcoming: () => request('/calendar'),
  events: (view?: 'upcoming' | 'past') =>
    request(`/calendar/events${view ? `?view=${view}` : ''}`),
  getEvent: (id: string) => request(`/calendar/events/${id}`),
};

export const forumApi = {
  threads: (category?: string) =>
    request(`/forum/threads${category && category !== 'all' ? `?category=${category}` : ''}`),
  thread: (id: string) => request(`/forum/threads/${id}`),
  posts: (threadId: string) => request(`/forum/threads/${threadId}/posts`),
  latest: () => request('/forum/latest'),
};

/* Health check */
export const healthApi = {
  check: () => request('/health'),
};

/* Admin endpoints */
export const adminApi = {
  status: () => request('/admin/status'),
  pause: () => request('/admin/pause', { method: 'POST' }),
  resume: () => request('/admin/resume', { method: 'POST' }),
  tick: () => request('/admin/tick', { method: 'POST' }),
  reseed: () => request('/admin/reseed', { method: 'POST' }),
  decisions: (page = 1, limit = 50) =>
    request(`/admin/decisions?page=${page}&limit=${limit}`),
  getConfig: () => request('/admin/config'),
  setConfig: (data: Record<string, unknown>) =>
    request('/admin/config', { method: 'POST', body: JSON.stringify(data) }),
  getAgents: () => request('/admin/agents'),
  toggleAgent: (id: string) =>
    request(`/admin/agents/${id}/toggle`, { method: 'POST' }),
  getEconomy: () => request('/admin/economy'),
  setEconomy: (data: { treasuryBalance?: number; taxRatePercent?: number }) =>
    request('/admin/economy', { method: 'POST', body: JSON.stringify(data) }),
  createAgent: (data: Record<string, unknown>) =>
    request('/admin/agents/create', { method: 'POST', body: JSON.stringify(data) }),
  getUsers: () => request('/admin/users'),
  setUserRole: (id: string, role: 'researcher' | 'user') =>
    request(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  getResearcherRequests: (status?: string) =>
    request(`/admin/researcher-requests${status ? `?status=${status}` : ''}`),
  approveResearcherRequest: (id: string) =>
    request(`/admin/researcher-requests/${id}/approve`, { method: 'POST' }),
  rejectResearcherRequest: (id: string) =>
    request(`/admin/researcher-requests/${id}/reject`, { method: 'POST' }),
  exportCounts: () => request('/admin/export/counts'),
  downloadExport: async (dataset: string, filename: string): Promise<void> => {
    const token = _tokenProvider ? await _tokenProvider() : null;
    const res = await fetch(`/api/admin/export/${dataset}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

export const profileApi = {
  me: () => request('/profile/me'),
  getAgents: () => request('/profile/agents'),
  createAgent: (data: Record<string, unknown>) =>
    request('/profile/agents/create', { method: 'POST', body: JSON.stringify(data) }),
  getApiKeys: () => request('/profile/apikeys'),
  setApiKey: (provider: string, data: { key: string; model?: string }) =>
    request(`/profile/apikeys/${provider}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteApiKey: (provider: string) =>
    request(`/profile/apikeys/${provider}`, { method: 'DELETE' }),
  getResearcherRequest: () => request('/profile/researcher-request'),
  submitResearcherRequest: (message: string) =>
    request('/profile/researcher-request', { method: 'POST', body: JSON.stringify({ message }) }),
};

/* Court endpoints */
export const courtApi = {
  stats: () => request('/court/stats'),
  cases: (status?: string) =>
    request(`/court/cases${status ? `?status=${status}` : ''}`),
  caseById: (id: string) => request(`/court/cases/${id}`),
};

export const providersApi = {
  list: () => request('/admin/providers'),
  set: (name: string, data: { key?: string; isActive?: boolean; ollamaBaseUrl?: string }) =>
    request(`/admin/providers/${name}`, { method: 'POST', body: JSON.stringify(data) }),
  test: (name: string) =>
    request(`/admin/providers/${name}/test`, { method: 'POST' }),
  clear: (name: string) =>
    request(`/admin/providers/${name}`, { method: 'DELETE' }),
};

/* Decision endpoints (public) */
export const decisionsApi = {
  list: (params?: { limit?: number; agentId?: string; phase?: string; tickId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.phase) qs.set('phase', params.phase);
    if (params?.tickId) qs.set('tickId', params.tickId);
    return request(`/decisions?${qs.toString()}`);
  },
};

/* Tick endpoints (public) */
export const ticksApi = {
  recent: (limit = 5) => request(`/ticks?limit=${limit}`),
};

/* DEMOS benchmark endpoints */
export const demosApi = {
  presets: () => request('/demos/presets'),
  models: () => request('/demos/models'),
  scores: (data?: { agentId?: string }) =>
    request('/demos/scores', { method: 'POST', body: JSON.stringify(data ?? {}) }),
  downloadExport: async (data: {
    modelId: string;
    presetId: string;
    agentFilter?: string;
  }): Promise<void> => {
    const token = _tokenProvider ? await _tokenProvider() : null;
    const res = await fetch('/api/demos/export', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `demos-training-${data.modelId}-${data.presetId}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

/* Researcher dashboard endpoints */
export const researcherApi = {
  dashboard: () => request('/researcher/dashboard'),
  agents: () => request('/researcher/agents'),
  agentPerformance: (agentId: string) =>
    request(`/researcher/agents/${agentId}/performance`),
  withdrawAgent: (agentId: string) =>
    request(`/researcher/agents/${agentId}/withdraw`, { method: 'POST' }),
};
