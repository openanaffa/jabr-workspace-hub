import type { Database } from 'bun:sqlite'
import type { AgentProfile, AgentProfilePort, AgentSkill } from '@ports/agent-profile-port'

export class SqliteAgentProfileAdapter implements AgentProfilePort {
  constructor(private readonly db: Database) { this.migrate() }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_profiles (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        role         TEXT NOT NULL,
        description  TEXT,
        avatar       TEXT,
        port         INTEGER NOT NULL,
        tags         TEXT NOT NULL DEFAULT '[]',
        tools        TEXT NOT NULL DEFAULT '[]',
        skills       TEXT NOT NULL DEFAULT '[]',
        plugins      TEXT NOT NULL DEFAULT '[]',
        stats        TEXT NOT NULL DEFAULT '{}',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL
      )
    `)
  }

  async get(agentId: string): Promise<AgentProfile | null> {
    const row = this.db.query(`SELECT * FROM agent_profiles WHERE id=?`).get(agentId) as any
    return row ? this.row(row) : null
  }

  async upsert(profile: AgentProfile): Promise<void> {
    this.db.run(
      `INSERT INTO agent_profiles VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, role=excluded.role, description=excluded.description,
         avatar=excluded.avatar, port=excluded.port, tags=excluded.tags,
         tools=excluded.tools, skills=excluded.skills, plugins=excluded.plugins,
         stats=excluded.stats, updated_at=excluded.updated_at`,
      [profile.id, profile.name, profile.role, profile.description ?? null,
       profile.avatar ?? null, profile.port,
       JSON.stringify(profile.tags), JSON.stringify(profile.tools),
       JSON.stringify(profile.skills), JSON.stringify(profile.plugins),
       JSON.stringify(profile.stats), profile.createdAt, profile.updatedAt],
    )
  }

  async list(): Promise<AgentProfile[]> {
    return (this.db.query(`SELECT * FROM agent_profiles ORDER BY name`).all() as any[]).map(r => this.row(r))
  }

  async updateStats(agentId: string, delta: {
    tasksCompleted?: number; tasksFailed?: number; tokensUsed?: number; responseMs?: number
  }): Promise<void> {
    const profile = await this.get(agentId)
    if (!profile) return
    const s = profile.stats
    const n = (s.tasksCompleted + (delta.tasksCompleted ?? 0)) || 1
    profile.stats = {
      tasksCompleted: s.tasksCompleted + (delta.tasksCompleted ?? 0),
      tasksFailed:    s.tasksFailed    + (delta.tasksFailed ?? 0),
      tokensUsed:     s.tokensUsed     + (delta.tokensUsed ?? 0),
      avgResponseMs:  delta.responseMs != null
        ? (s.avgResponseMs * (n - 1) + delta.responseMs) / n
        : s.avgResponseMs,
    }
    profile.updatedAt = new Date().toISOString()
    this.db.run(`UPDATE agent_profiles SET stats=?, updated_at=? WHERE id=?`,
      [JSON.stringify(profile.stats), profile.updatedAt, agentId])
  }

  async enableTool(agentId: string, toolName: string): Promise<void> {
    await this._mutateTool(agentId, toolName, true)
  }

  async disableTool(agentId: string, toolName: string): Promise<void> {
    await this._mutateTool(agentId, toolName, false)
  }

  async addSkill(agentId: string, skill: AgentSkill): Promise<void> {
    const profile = await this.get(agentId)
    if (!profile) return
    const skills = profile.skills.filter(s => s.slug !== skill.slug)
    skills.push(skill)
    this.db.run(`UPDATE agent_profiles SET skills=?, updated_at=? WHERE id=?`,
      [JSON.stringify(skills), new Date().toISOString(), agentId])
  }

  async removeSkill(agentId: string, skillSlug: string): Promise<void> {
    const profile = await this.get(agentId)
    if (!profile) return
    this.db.run(`UPDATE agent_profiles SET skills=?, updated_at=? WHERE id=?`,
      [JSON.stringify(profile.skills.filter(s => s.slug !== skillSlug)), new Date().toISOString(), agentId])
  }

  private async _mutateTool(agentId: string, toolName: string, enabled: boolean) {
    const profile = await this.get(agentId)
    if (!profile) return
    const tools = profile.tools.map(t => t.name === toolName ? { ...t, enabled } : t)
    this.db.run(`UPDATE agent_profiles SET tools=?, updated_at=? WHERE id=?`,
      [JSON.stringify(tools), new Date().toISOString(), agentId])
  }

  private row(r: any): AgentProfile {
    return {
      id: r.id, name: r.name, role: r.role, description: r.description ?? '',
      avatar: r.avatar ?? undefined, port: r.port,
      tags: JSON.parse(r.tags), tools: JSON.parse(r.tools),
      skills: JSON.parse(r.skills), plugins: JSON.parse(r.plugins),
      stats: JSON.parse(r.stats),
      createdAt: r.created_at, updatedAt: r.updated_at,
    }
  }
}
