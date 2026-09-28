import type { Database } from 'bun:sqlite'
import type { ToolCallRecord, ToolDefinition, ToolHubPort, ToolSource } from '@ports/tool-hub-port'

export class SqliteToolHubAdapter implements ToolHubPort {
  private readonly tools = new Map<string, ToolDefinition>()
  private readonly handlers = new Map<string, (input: unknown) => Promise<unknown>>()

  constructor(private readonly db: Database) { this.migrate() }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_hub_definitions (
        name        TEXT PRIMARY KEY,
        description TEXT,
        source      TEXT NOT NULL,
        input_schema TEXT NOT NULL DEFAULT '{}',
        provider_id TEXT,
        enabled     INTEGER NOT NULL DEFAULT 1,
        tags        TEXT NOT NULL DEFAULT '[]'
      )
    `)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tool_hub_calls (
        id          TEXT PRIMARY KEY,
        tool_name   TEXT NOT NULL,
        agent_id    TEXT NOT NULL,
        task_id     TEXT,
        input       TEXT NOT NULL,
        output      TEXT,
        error       TEXT,
        duration_ms INTEGER NOT NULL,
        timestamp   TEXT NOT NULL
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_hub_calls(agent_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tool_calls_task  ON tool_hub_calls(task_id)`)
  }

  /** Register a tool with an optional runtime handler */
  registerWithHandler(tool: ToolDefinition, handler?: (input: unknown) => Promise<unknown>) {
    this.tools.set(tool.name, tool)
    if (handler) this.handlers.set(tool.name, handler)
    this.db.run(
      `INSERT INTO tool_hub_definitions VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET
         description=excluded.description, source=excluded.source,
         input_schema=excluded.input_schema, provider_id=excluded.provider_id,
         enabled=excluded.enabled, tags=excluded.tags`,
      [tool.name, tool.description, tool.source, JSON.stringify(tool.inputSchema),
       tool.providerId ?? null, tool.enabled ? 1 : 0, JSON.stringify(tool.tags)],
    )
  }

  async register(tool: ToolDefinition): Promise<void> {
    this.registerWithHandler(tool)
  }

  async unregister(toolName: string): Promise<void> {
    this.tools.delete(toolName)
    this.handlers.delete(toolName)
    this.db.run(`DELETE FROM tool_hub_definitions WHERE name=?`, [toolName])
  }

  async get(toolName: string): Promise<ToolDefinition | null> {
    return this.tools.get(toolName) ?? null
  }

  async list(filter?: { source?: ToolSource; enabled?: boolean; tags?: string[] }): Promise<ToolDefinition[]> {
    let tools = [...this.tools.values()]
    if (filter?.source  != null) tools = tools.filter(t => t.source === filter.source)
    if (filter?.enabled != null) tools = tools.filter(t => t.enabled === filter.enabled)
    if (filter?.tags?.length)    tools = tools.filter(t => filter.tags!.some(tag => t.tags.includes(tag)))
    return tools
  }

  async call(toolName: string, input: unknown, agentId: string, taskId?: string): Promise<unknown> {
    const tool = this.tools.get(toolName)
    if (!tool) throw new Error(`Tool not found: ${toolName}`)
    if (!tool.enabled) throw new Error(`Tool disabled: ${toolName}`)
    const handler = this.handlers.get(toolName)
    if (!handler) throw new Error(`No handler registered for: ${toolName}`)

    const started = Date.now()
    const record: ToolCallRecord = {
      id: crypto.randomUUID(), toolName, agentId, taskId,
      input, durationMs: 0, timestamp: new Date().toISOString(),
    }
    try {
      const output = await handler(input)
      record.output = output
      record.durationMs = Date.now() - started
      this._persistCall(record)
      return output
    } catch (err) {
      record.error = String(err)
      record.durationMs = Date.now() - started
      this._persistCall(record)
      throw err
    }
  }

  async getHistory(filter?: { agentId?: string; taskId?: string; limit?: number }): Promise<ToolCallRecord[]> {
    const limit = filter?.limit ?? 50
    const rows = filter?.agentId
      ? this.db.query(`SELECT * FROM tool_hub_calls WHERE agent_id=? ORDER BY timestamp DESC LIMIT ?`).all(filter.agentId, limit) as any[]
      : filter?.taskId
        ? this.db.query(`SELECT * FROM tool_hub_calls WHERE task_id=? ORDER BY timestamp DESC LIMIT ?`).all(filter.taskId, limit) as any[]
        : this.db.query(`SELECT * FROM tool_hub_calls ORDER BY timestamp DESC LIMIT ?`).all(limit) as any[]
    return rows.map(r => ({
      id: r.id, toolName: r.tool_name, agentId: r.agent_id, taskId: r.task_id ?? undefined,
      input: JSON.parse(r.input), output: r.output ? JSON.parse(r.output) : undefined,
      error: r.error ?? undefined, durationMs: r.duration_ms, timestamp: r.timestamp,
    }))
  }

  private _persistCall(r: ToolCallRecord) {
    this.db.run(
      `INSERT INTO tool_hub_calls VALUES (?,?,?,?,?,?,?,?,?)`,
      [r.id, r.toolName, r.agentId, r.taskId ?? null,
       JSON.stringify(r.input), r.output ? JSON.stringify(r.output) : null,
       r.error ?? null, r.durationMs, r.timestamp],
    )
  }
}
