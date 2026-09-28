/**
 * AgentProfilePort
 * Every agent in the ecosystem has a persistent profile:
 * capabilities, tags, tool access, plugin list, stats, avatar.
 */

export type AgentRole =
  | 'orchestrator' | 'oracle' | 'librarian' | 'explorer'
  | 'designer'     | 'fixer'  | 'scientist'  | 'jarvis'
  | 'custom'

export interface AgentTool {
  name:        string
  description: string
  enabled:     boolean
  /** plugin slug that provides this tool, if any */
  pluginSlug?: string
}

export interface AgentSkill {
  slug:        string
  name:        string
  description: string
  version:     string
  /** Skill source: built-in, MemPalace slug, or plugin */
  source:      'builtin' | 'mempalace' | 'plugin'
}

export interface AgentProfile {
  id:          string
  name:        string
  role:        AgentRole
  description: string
  avatar?:     string            // base64 or URL
  port:        number
  tags:        string[]
  tools:       AgentTool[]
  skills:      AgentSkill[]
  plugins:     string[]          // plugin slugs enabled for this agent
  /** Cumulative stats */
  stats: {
    tasksCompleted: number
    tasksFailed:    number
    tokensUsed:     number
    avgResponseMs:  number
  }
  createdAt:   string
  updatedAt:   string
}

export interface AgentProfilePort {
  get(agentId: string): Promise<AgentProfile | null>
  upsert(profile: AgentProfile): Promise<void>
  list(): Promise<AgentProfile[]>
  updateStats(agentId: string, delta: {
    tasksCompleted?: number
    tasksFailed?:    number
    tokensUsed?:     number
    responseMs?:     number
  }): Promise<void>
  enableTool(agentId: string, toolName: string): Promise<void>
  disableTool(agentId: string, toolName: string): Promise<void>
  addSkill(agentId: string, skill: AgentSkill): Promise<void>
  removeSkill(agentId: string, skillSlug: string): Promise<void>
}
