// app2/server/src/index.ts
import {
  initDatabase, upsertProject, upsertSession, upsertAgent,
  updateAgentStatus, updateSessionStatus, insertEvent,
  getProjects, getSessionsForProject, getAgentsForSession,
  getEventsForSession, getEventsForAgent, getSessionById,
  clearAllData,
} from './db';
import { parseRawEvent } from './parser';
import { addClient, removeClient, broadcast } from './websocket';
import type { ParsedEvent, Agent, Session, Project } from './types';

initDatabase();

const PORT = parseInt(process.env.SERVER_PORT || '4001', 10);

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>();

function ensureRootAgent(sessionId: string, slug: string | null, timestamp: number): string {
  let rootId = sessionRootAgents.get(sessionId);
  if (!rootId) {
    rootId = sessionId;
    upsertAgent(rootId, sessionId, null, slug, null, timestamp);
    sessionRootAgents.set(sessionId, rootId);
  }
  return rootId;
}

const server = Bun.serve({
  port: PORT,

  async fetch(req: Request) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // POST /api/events
    if (url.pathname === '/api/events' && req.method === 'POST') {
      try {
        const raw = await req.json();
        const parsed = parseRawEvent(raw);

        upsertProject(parsed.projectName, parsed.projectName);
        upsertSession(
          parsed.sessionId, parsed.projectName, parsed.slug,
          Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
          parsed.timestamp
        );

        const rootAgentId = ensureRootAgent(parsed.sessionId, parsed.slug, parsed.timestamp);
        let agentId = rootAgentId;

        if (parsed.subAgentId) {
          upsertAgent(parsed.subAgentId, parsed.sessionId, rootAgentId, null, parsed.subAgentName, parsed.timestamp);
          if (parsed.subtype === 'agent_progress') {
            agentId = parsed.subAgentId;
          }
        }

        if (parsed.type === 'system' && parsed.subtype === 'stop_hook_summary') {
          updateAgentStatus(rootAgentId, 'stopped');
          updateSessionStatus(parsed.sessionId, 'stopped');
        }

        const eventId = insertEvent(
          agentId, parsed.sessionId, parsed.type, parsed.subtype,
          parsed.toolName, parsed.summary, parsed.timestamp, parsed.raw
        );

        const event: ParsedEvent = {
          id: eventId, agentId, sessionId: parsed.sessionId,
          type: parsed.type, subtype: parsed.subtype,
          toolName: parsed.toolName, summary: parsed.summary,
          timestamp: parsed.timestamp, payload: parsed.raw,
        };

        broadcast({ type: 'event', data: event });
        return json(event, 201);
      } catch (error) {
        console.error('Error processing event:', error);
        return json({ error: 'Invalid request' }, 400);
      }
    }

    // GET /api/projects
    if (url.pathname === '/api/projects' && req.method === 'GET') {
      const rows = getProjects();
      const projects: Project[] = rows.map((r) => ({
        id: r.id, name: r.name, createdAt: r.created_at, sessionCount: r.session_count,
      }));
      return json(projects);
    }

    // GET /api/projects/:id/sessions
    const projectSessionsMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
    if (projectSessionsMatch && req.method === 'GET') {
      const projectId = decodeURIComponent(projectSessionsMatch[1]);
      const rows = getSessionsForProject(projectId);
      const sessions: Session[] = rows.map((r: any) => ({
        id: r.id, projectId: r.project_id, slug: r.slug, status: r.status,
        startedAt: r.started_at, stoppedAt: r.stopped_at,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        agentCount: r.agent_count, eventCount: r.event_count,
      }));
      return json(sessions);
    }

    // GET /api/sessions/:id
    const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);
    if (sessionMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionMatch[1]);
      const row = getSessionById(sessionId);
      if (!row) return json({ error: 'Session not found' }, 404);
      return json({
        id: row.id, projectId: row.project_id, slug: row.slug, status: row.status,
        startedAt: row.started_at, stoppedAt: row.stopped_at,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
        agentCount: row.agent_count, eventCount: row.event_count,
      });
    }

    // GET /api/sessions/:id/agents
    const sessionAgentsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/agents$/);
    if (sessionAgentsMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionAgentsMatch[1]);
      const rows = getAgentsForSession(sessionId);
      const agents: Agent[] = rows.map((r: any) => ({
        id: r.id, sessionId: r.session_id, parentAgentId: r.parent_agent_id,
        slug: r.slug, name: r.name, status: r.status,
        startedAt: r.started_at, stoppedAt: r.stopped_at, eventCount: r.event_count,
      }));

      // Build tree
      const agentMap = new Map(agents.map((a) => [a.id, { ...a, children: [] as Agent[] }]));
      const roots: Agent[] = [];
      for (const agent of agentMap.values()) {
        if (agent.parentAgentId && agentMap.has(agent.parentAgentId)) {
          agentMap.get(agent.parentAgentId)!.children!.push(agent);
        } else {
          roots.push(agent);
        }
      }
      return json(roots);
    }

    // GET /api/sessions/:id/events
    const sessionEventsMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)\/events$/);
    if (sessionEventsMatch && req.method === 'GET') {
      const sessionId = decodeURIComponent(sessionEventsMatch[1]);
      const agentIdParam = url.searchParams.get('agent_id');
      const rows = getEventsForSession(sessionId, {
        agentIds: agentIdParam ? agentIdParam.split(',') : undefined,
        type: url.searchParams.get('type') || undefined,
        subtype: url.searchParams.get('subtype') || undefined,
        search: url.searchParams.get('search') || undefined,
        limit: url.searchParams.has('limit') ? parseInt(url.searchParams.get('limit')!) : undefined,
        offset: url.searchParams.has('offset') ? parseInt(url.searchParams.get('offset')!) : undefined,
      });

      const events: ParsedEvent[] = rows.map((r: any) => ({
        id: r.id, agentId: r.agent_id, sessionId: r.session_id,
        type: r.type, subtype: r.subtype, toolName: r.tool_name,
        summary: r.summary, timestamp: r.timestamp, payload: JSON.parse(r.payload),
      }));
      return json(events);
    }

    // GET /api/agents/:id/events
    const agentEventsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/events$/);
    if (agentEventsMatch && req.method === 'GET') {
      const agentId = decodeURIComponent(agentEventsMatch[1]);
      const rows = getEventsForAgent(agentId);
      const events: ParsedEvent[] = rows.map((r: any) => ({
        id: r.id, agentId: r.agent_id, sessionId: r.session_id,
        type: r.type, subtype: r.subtype, toolName: r.tool_name,
        summary: r.summary, timestamp: r.timestamp, payload: JSON.parse(r.payload),
      }));
      return json(events);
    }

    // DELETE /api/data
    if (url.pathname === '/api/data' && req.method === 'DELETE') {
      clearAllData();
      sessionRootAgents.clear();
      return json({ success: true });
    }

    // WebSocket upgrade
    if (url.pathname === '/api/events/stream') {
      const success = server.upgrade(req);
      if (success) return undefined;
      return json({ error: 'WebSocket upgrade failed' }, 400);
    }

    return new Response('App2 Observability Server', {
      headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain' },
    });
  },

  websocket: {
    open(ws) {
      console.log('[WS] Client connected');
      addClient(ws);
    },
    message(_ws, _message) {},
    close(ws) {
      console.log('[WS] Client disconnected');
      removeClient(ws);
    },
    error(ws, error) {
      console.error('[WS] Error:', error);
      removeClient(ws);
    },
  },
});

console.log(`Server running on http://localhost:${server.port}`);
console.log(`WebSocket: ws://localhost:${server.port}/api/events/stream`);
console.log(`POST events: http://localhost:${server.port}/api/events`);
