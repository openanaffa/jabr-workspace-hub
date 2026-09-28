/**
 * hub-runtime.ts — composition root for all new Hub features.
 * Wires ports → adapters → OrchestratorAgent.
 * Import this from src/runtime/orchestrator.ts and spread into ToolRouterConfig.
 *
 * Usage in existing runtime/orchestrator.ts:
 *
 *   import { createHubRuntime } from './hub-runtime'
 *   const hub = createHubRuntime(db)
 *   // then pass hub.* into ToolRouterConfig / OrchestratorAgent
 */

import type { Database } from 'bun:sqlite'
import { SqliteHubAdapter }          from '@adapters/sqlite/sqlite-hub-adapter'
import { SqliteArtifactAdapter }     from '@adapters/files/sqlite-artifact-adapter'
import { SqliteAgentProfileAdapter } from '@adapters/sqlite/sqlite-agent-profile-adapter'
import { SqliteToolHubAdapter }      from '@adapters/hub/sqlite-tool-hub-adapter'
import type { HubPort }              from '@ports/hub-port'
import type { ArtifactPort }         from '@ports/artifact-port'
import type { AgentProfilePort }     from '@ports/agent-profile-port'
import type { ToolHubPort }          from '@ports/tool-hub-port'

export interface HubRuntime {
  hub:          HubPort
  artifacts:    ArtifactPort
  agentProfile: AgentProfilePort
  toolHub:      ToolHubPort
}

export function createHubRuntime(db: Database): HubRuntime {
  return {
    hub:          new SqliteHubAdapter(db),
    artifacts:    new SqliteArtifactAdapter(db),
    agentProfile: new SqliteAgentProfileAdapter(db),
    toolHub:      new SqliteToolHubAdapter(db),
  }
}

/**
 * Seed default agent profiles from JABR_PORTS constants.
 * Call once at startup after createHubRuntime().
 */
export async function seedAgentProfiles(
  agentProfile: AgentProfilePort,
  agents: Array<{ id: string; name: string; role: any; port: number; tags: string[] }>
): Promise<void> {
  for (const a of agents) {
    const existing = await agentProfile.get(a.id)
    if (existing) continue
    await agentProfile.upsert({
      id: a.id, name: a.name, role: a.role, description: '',
      port: a.port, tags: a.tags, tools: [], skills: [], plugins: [],
      stats: { tasksCompleted: 0, tasksFailed: 0, tokensUsed: 0, avgResponseMs: 0 },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }
}
