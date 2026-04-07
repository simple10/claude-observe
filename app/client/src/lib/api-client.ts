import { API_BASE } from '@/config/api';
import type { Project, Session, RecentSession, ServerAgent, ParsedEvent } from '@/types';

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getProjects: () => fetchJson<Project[]>('/projects'),
  getRecentSessions: (limit?: number) =>
    fetchJson<RecentSession[]>(`/sessions/recent${limit ? `?limit=${limit}` : ''}`),
  getSessions: (projectId: number) =>
    fetchJson<Session[]>(`/projects/${projectId}/sessions`),
  getSession: (sessionId: string) =>
    fetchJson<Session>(`/sessions/${encodeURIComponent(sessionId)}`),
  getAgent: (agentId: string) =>
    fetchJson<ServerAgent>(`/agents/${encodeURIComponent(agentId)}`),
  getAgents: (sessionId: string) =>
    fetchJson<ServerAgent[]>(`/sessions/${encodeURIComponent(sessionId)}/agents`),
  getEvents: (
    sessionId: string,
    filters?: {
      agentIds?: string[];
      type?: string;
      subtype?: string;
      search?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
    const params = new URLSearchParams();
    if (filters?.agentIds?.length) params.set('agent_id', filters.agentIds.join(','));
    if (filters?.type) params.set('type', filters.type);
    if (filters?.subtype) params.set('subtype', filters.subtype);
    if (filters?.search) params.set('search', filters.search);
    if (filters?.limit) params.set('limit', String(filters.limit));
    if (filters?.offset) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return fetchJson<ParsedEvent[]>(
      `/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`
    );
  },
  getThread: (eventId: number) =>
    fetchJson<ParsedEvent[]>(`/events/${eventId}/thread`),
  deleteSession: (sessionId: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }),
  clearSessionEvents: (sessionId: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
  deleteProject: (projectId: number) =>
    fetchJson<void>(`/projects/${projectId}`, { method: 'DELETE' }),
  deleteAllData: () =>
    fetch(`${API_BASE}/data`, { method: 'DELETE' }),
  updateAgentMetadata: (agentId: string, data: { agentType?: string; slug?: string }) =>
    fetch(`${API_BASE}/agents/${encodeURIComponent(agentId)}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  updateSessionSlug: (sessionId: string, slug: string) =>
    fetch(`${API_BASE}/sessions/${encodeURIComponent(sessionId)}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug }),
    }),
  renameProject: (projectId: number, name: string) =>
    fetch(`${API_BASE}/projects/${projectId}/rename`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  getChangelog: () => fetchJson<{ markdown: string }>('/changelog'),
};
