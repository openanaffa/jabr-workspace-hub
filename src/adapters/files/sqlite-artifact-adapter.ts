/**
 * SqliteArtifactAdapter — implements ArtifactPort
 * Stores artifact metadata + content in SQLite.
 * For large binaries, content can be a file path reference (future: IPFS CID).
 */

import type { Database } from 'bun:sqlite'
import type { Artifact, ArtifactKind, ArtifactPort } from '@ports/artifact-port'

export class SqliteArtifactAdapter implements ArtifactPort {
  constructor(private readonly db: Database) {
    this.migrate()
  }

  private migrate() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        kind         TEXT NOT NULL,
        mime_type    TEXT NOT NULL,
        content      TEXT NOT NULL,
        size_bytes   INTEGER NOT NULL,
        produced_by  TEXT NOT NULL,
        task_id      TEXT,
        project_id   TEXT,
        shared_with  TEXT NOT NULL DEFAULT '[]',
        tags         TEXT NOT NULL DEFAULT '[]',
        created_at   TEXT NOT NULL
      )
    `)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_task     ON artifacts(task_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_project  ON artifacts(project_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_artifacts_producer ON artifacts(produced_by)`)
  }

  async store(a: Omit<Artifact, 'id' | 'createdAt' | 'sizeBytes'>): Promise<Artifact> {
    const artifact: Artifact = {
      ...a,
      id:        crypto.randomUUID(),
      sizeBytes: new Blob([a.content]).size,
      createdAt: new Date().toISOString(),
    }
    this.db.run(
      `INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [artifact.id, artifact.name, artifact.kind, artifact.mimeType,
       artifact.content, artifact.sizeBytes, artifact.producedBy,
       artifact.taskId ?? null, artifact.projectId ?? null,
       JSON.stringify(artifact.sharedWith), JSON.stringify(artifact.tags),
       artifact.createdAt],
    )
    return artifact
  }

  async get(id: string): Promise<Artifact | null> {
    const row = this.db.query(`SELECT * FROM artifacts WHERE id=?`).get(id) as any
    return row ? this.rowToArtifact(row) : null
  }

  async list(filter?: {
    producedBy?: string; projectId?: string; taskId?: string
    kind?: ArtifactKind; sharedWith?: string
  }): Promise<Artifact[]> {
    // Build query dynamically
    const clauses: string[] = []
    const params: string[] = []
    if (filter?.producedBy) { clauses.push(`produced_by=?`); params.push(filter.producedBy) }
    if (filter?.projectId)  { clauses.push(`project_id=?`);  params.push(filter.projectId) }
    if (filter?.taskId)     { clauses.push(`task_id=?`);      params.push(filter.taskId) }
    if (filter?.kind)       { clauses.push(`kind=?`);         params.push(filter.kind) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const rows = this.db.query(`SELECT * FROM artifacts ${where} ORDER BY created_at DESC`).all(...params) as any[]
    let results = rows.map(r => this.rowToArtifact(r))
    if (filter?.sharedWith) {
      results = results.filter(a => a.sharedWith.includes('*') || a.sharedWith.includes(filter.sharedWith!))
    }
    return results
  }

  async share(artifactId: string, agentIds: string[]): Promise<void> {
    const artifact = await this.get(artifactId)
    if (!artifact) return
    const merged = [...new Set([...artifact.sharedWith, ...agentIds])]
    this.db.run(`UPDATE artifacts SET shared_with=? WHERE id=?`, [JSON.stringify(merged), artifactId])
  }

  async delete(artifactId: string): Promise<void> {
    this.db.run(`DELETE FROM artifacts WHERE id=?`, [artifactId])
  }

  private rowToArtifact(row: any): Artifact {
    return {
      id: row.id, name: row.name, kind: row.kind, mimeType: row.mime_type,
      content: row.content, sizeBytes: row.size_bytes,
      producedBy: row.produced_by, taskId: row.task_id ?? undefined,
      projectId: row.project_id ?? undefined,
      sharedWith: JSON.parse(row.shared_with), tags: JSON.parse(row.tags),
      createdAt: row.created_at,
    }
  }
}
