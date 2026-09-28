/**
 * ToolHubPort
 * Central registry of all tools available to agents.
 * Tools can be MCP tools, built-in functions, or plugin-provided.
 */

export type ToolSource = 'mcp' | 'builtin' | 'plugin' | 'opensrc'

export interface ToolDefinition {
  name:        string
  description: string
  source:      ToolSource
  /** JSON Schema for parameters */
  inputSchema: Record<string, unknown>
  /** Plugin or MCP server slug providing this tool */
  providerId?: string
  enabled:     boolean
  tags:        string[]
}

export interface ToolCallRecord {
  id:        string
  toolName:  string
  agentId:   string
  taskId?:   string
  input:     unknown
  output?:   unknown
  error?:    string
  durationMs: number
  timestamp: string
}

export interface ToolHubPort {
  register(tool: ToolDefinition): Promise<void>
  unregister(toolName: string): Promise<void>
  get(toolName: string): Promise<ToolDefinition | null>
  list(filter?: { source?: ToolSource; enabled?: boolean; tags?: string[] }): Promise<ToolDefinition[]>
  /** Execute and record */
  call(toolName: string, input: unknown, agentId: string, taskId?: string): Promise<unknown>
  getHistory(filter?: { agentId?: string; taskId?: string; limit?: number }): Promise<ToolCallRecord[]>
}
