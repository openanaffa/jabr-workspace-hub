/**
 * SqliteHubAdapter — implements HubPort using bun:sqlite
 * Follows jabr's existing SqliteMemoryStore / SqliteTaskStore pattern.
 * DB is opened via openJabrDb() from @adapters/sqlite-db
 */

import type { Database } from 'bun:sqlite'
import type {
  Ballot, ChatMessage, ChatThread, Goal, HubPort,
  Project, ThreadScope, Vote, VoteOption,
} from '@ports/hub-port'
import type { KanbanTaskStatus } from '@ports/kanban-port'

export class SqliteHubAdapter implements HubPort {
  constructor(private readonly db: Database) {
    this.migrate()
  }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS hub_projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        owner_id TEXT NOT NULL,
        member_ids TEXT NOT NULL DEFAULT '[]',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS hub_goals (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        assignee_id TEXT,
        priority INTEGER NOT NULL DEFAULT 3,
        task_ids TEXT NOT NULL DEFAULT '[]',
        due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS hub_threads (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS hub_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        artifacts TEXT NOT NULL DEFAULT '[]',
        reply_to_id TEXT,
        created_at TEXT NOT NULL
      )`)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS hub_ballots (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        question TEXT NOT NULL,
        options TEXT NOT NULL,
        votes TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'open',
        result TEXT,
        quorum INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        closed_at TEXT
      )`)
  }

  // ── Projects ───────────────────────────────────────────────────────────

  async createProject(p: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project> {
    const project: Project = {
      ...p,
      id:        crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.db.run(
      `INSERT INTO hub_projects VALUES (?,?,?,?,?,?,?,?,?)`,
      [project.id, project.name, project.description, project.status,
       project.ownerId, JSON.stringify(project.memberIds),
       JSON.stringify(project.tags), project.createdAt, project.updatedAt],
    )
    return project
  }

  async getProject(id: string): Promise<Project | null> {
    const row = this.db.query(`SELECT * FROM hub_projects WHERE id = ?`).get(id) as any
    return row ? this.rowToProject(row) : null
  }

  async listProjects(filter?: { status?: Project['status']; memberId?: string }): Promise<Project[]> {
    let rows: any[]
    if (filter?.status) {
      rows = this.db.query(`SELECT * FROM hub_projects WHERE status = ? ORDER BY updated_at DESC`).all(filter.status) as any[]
    } else {
      rows = this.db.query(`SELECT * FROM hub_projects ORDER BY updated_at DESC`).all() as any[]
    }
    const projects = rows.map(r => this.rowToProject(r))
    if (filter?.memberId) return projects.filter(p => p.memberIds.includes(filter.memberId!))
    return projects
  }

  async updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'memberIds' | 'tags'>>): Promise<void> {
    const existing = await this.getProject(id)
    if (!existing) return
    const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    this.db.run(
      `UPDATE hub_projects SET name=?, description=?, status=?, member_ids=?, tags=?, updated_at=? WHERE id=?`,
      [merged.name, merged.description, merged.status,
       JSON.stringify(merged.memberIds), JSON.stringify(merged.tags),
       merged.updatedAt, id],
    )
  }

  private rowToProject(row: any): Project {
    return {
      id: row.id, name: row.name, description: row.description,
      status: row.status, ownerId: row.owner_id,
      memberIds: JSON.parse(row.member_ids),
      tags: JSON.parse(row.tags),
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  // ── Goals ──────────────────────────────────────────────────────────────

  async createGoal(g: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal> {
    const goal: Goal = {
      ...g, id: crypto.randomUUID(),
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }
    this.db.run(
      `INSERT INTO hub_goals VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [goal.id, goal.projectId, goal.title, goal.description ?? null,
       goal.status, goal.assigneeId ?? null, goal.priority,
       JSON.stringify(goal.taskIds), goal.dueAt ?? null,
       goal.createdAt, goal.updatedAt],
    )
    return goal
  }

  async getGoal(id: string): Promise<Goal | null> {
    const row = this.db.query(`SELECT * FROM hub_goals WHERE id = ?`).get(id) as any
    return row ? this.rowToGoal(row) : null
  }

  async listGoals(projectId: string, filter?: { status?: KanbanTaskStatus }): Promise<Goal[]> {
    const rows = filter?.status
      ? this.db.query(`SELECT * FROM hub_goals WHERE project_id=? AND status=? ORDER BY priority, created_at`).all(projectId, filter.status) as any[]
      : this.db.query(`SELECT * FROM hub_goals WHERE project_id=? ORDER BY priority, created_at`).all(projectId) as any[]
    return rows.map(r => this.rowToGoal(r))
  }

  async updateGoal(id: string, patch: Partial<Pick<Goal, 'status' | 'assigneeId' | 'taskIds' | 'priority'>>): Promise<void> {
    const existing = await this.getGoal(id)
    if (!existing) return
    const merged = { ...existing, ...patch, updatedAt: new Date().toISOString() }
    this.db.run(
      `UPDATE hub_goals SET status=?, assignee_id=?, task_ids=?, priority=?, updated_at=? WHERE id=?`,
      [merged.status, merged.assigneeId ?? null, JSON.stringify(merged.taskIds), merged.priority, merged.updatedAt, id],
    )
  }

  private rowToGoal(row: any): Goal {
    return {
      id: row.id, projectId: row.project_id, title: row.title,
      description: row.description ?? '', status: row.status,
      assigneeId: row.assignee_id ?? undefined, priority: row.priority,
      taskIds: JSON.parse(row.task_ids), dueAt: row.due_at ?? undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  // ── Threads ────────────────────────────────────────────────────────────

  async createThread(t: Omit<ChatThread, 'id' | 'createdAt'>): Promise<ChatThread> {
    const thread: ChatThread = { ...t, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    this.db.run(`INSERT INTO hub_threads VALUES (?,?,?,?)`,
      [thread.id, JSON.stringify(thread.scope), thread.title, thread.createdAt])
    return thread
  }

  async getThread(id: string): Promise<ChatThread | null> {
    const row = this.db.query(`SELECT * FROM hub_threads WHERE id=?`).get(id) as any
    return row ? { id: row.id, scope: JSON.parse(row.scope), title: row.title, createdAt: row.created_at } : null
  }

  async listThreads(scope: ThreadScope): Promise<ChatThread[]> {
    const scopeJson = JSON.stringify(scope)
    const rows = this.db.query(`SELECT * FROM hub_threads WHERE scope=? ORDER BY created_at DESC`).all(scopeJson) as any[]
    return rows.map(r => ({ id: r.id, scope: JSON.parse(r.scope), title: r.title, createdAt: r.created_at }))
  }

  // ── Messages ───────────────────────────────────────────────────────────

  async postMessage(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage> {
    const msg: ChatMessage = { ...m, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
    this.db.run(`INSERT INTO hub_messages VALUES (?,?,?,?,?,?,?,?)`,
      [msg.id, msg.threadId, msg.authorId, msg.role, msg.content,
       JSON.stringify(msg.artifacts), msg.replyToId ?? null, msg.createdAt])
    return msg
  }

  async listMessages(threadId: string, opts?: { limit?: number; before?: string }): Promise<ChatMessage[]> {
    const limit = opts?.limit ?? 50
    const rows = opts?.before
      ? this.db.query(`SELECT * FROM hub_messages WHERE thread_id=? AND created_at < ? ORDER BY created_at DESC LIMIT ?`).all(threadId, opts.before, limit) as any[]
      : this.db.query(`SELECT * FROM hub_messages WHERE thread_id=? ORDER BY created_at DESC LIMIT ?`).all(threadId, limit) as any[]
    return rows.reverse().map(r => ({
      id: r.id, threadId: r.thread_id, authorId: r.author_id, role: r.role,
      content: r.content, artifacts: JSON.parse(r.artifacts),
      replyToId: r.reply_to_id ?? undefined, createdAt: r.created_at,
    }))
  }

  // ── Voting ─────────────────────────────────────────────────────────────

  async createBallot(b: Omit<Ballot, 'id' | 'votes' | 'status' | 'result' | 'createdAt'>): Promise<Ballot> {
    const ballot: Ballot = {
      ...b, id: crypto.randomUUID(), votes: [], status: 'open', createdAt: new Date().toISOString(),
    }
    this.db.run(`INSERT INTO hub_ballots VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [ballot.id, ballot.threadId, ballot.question, JSON.stringify(ballot.options),
       '[]', 'open', null, ballot.quorum, ballot.createdAt, null])
    return ballot
  }

  async castVote(ballotId: string, vote: Omit<Vote, 'castAt'>): Promise<void> {
    const ballot = await this.getBallot(ballotId)
    if (!ballot || ballot.status !== 'open') throw new Error(`Ballot ${ballotId} not open`)
    if (!ballot.options.includes(vote.option)) throw new Error(`Invalid option: ${vote.option}`)
    const votes = ballot.votes.filter(v => v.voterId !== vote.voterId)
    votes.push({ ...vote, castAt: new Date().toISOString() })
    this.db.run(`UPDATE hub_ballots SET votes=? WHERE id=?`, [JSON.stringify(votes), ballotId])
  }

  async closeBallot(ballotId: string): Promise<Ballot> {
    const ballot = await this.getBallot(ballotId)
    if (!ballot) throw new Error(`Ballot ${ballotId} not found`)
    // Weighted tally
    const tally = new Map<VoteOption, number>()
    for (const v of ballot.votes) tally.set(v.option, (tally.get(v.option) ?? 0) + v.weight)
    const result = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ballot.options[0]
    const closedAt = new Date().toISOString()
    this.db.run(`UPDATE hub_ballots SET status='closed', result=?, closed_at=? WHERE id=?`,
      [result, closedAt, ballotId])
    return { ...ballot, status: 'closed', result, closedAt }
  }

  async getBallot(id: string): Promise<Ballot | null> {
    const row = this.db.query(`SELECT * FROM hub_ballots WHERE id=?`).get(id) as any
    if (!row) return null
    return {
      id: row.id, threadId: row.thread_id, question: row.question,
      options: JSON.parse(row.options), votes: JSON.parse(row.votes),
      status: row.status, result: row.result ?? undefined,
      quorum: row.quorum, createdAt: row.created_at, closedAt: row.closed_at ?? undefined,
    }
  }
}
