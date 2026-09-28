/**
 * ArtifactPort
 * Files and artifacts shared between agents.
 * Extends jabr's existing artifact concept (IPFS adapter exists)
 * with structured metadata and inter-agent visibility.
 */

export type ArtifactKind =
  | 'file' | 'code' | 'diff' | 'image' | 'data'
  | 'report' | 'skill' | 'plan' | 'unknown'

export interface Artifact {
  id:          string
  name:        string
  kind:        ArtifactKind
  mimeType:    string
  /** base64 for binary, utf-8 string for text */
  content:     string
  sizeBytes:   number
  /** Which agent produced this */
  producedBy:  string
  /** Task that generated this artifact */
  taskId?:     string
  /** Project this belongs to */
  projectId?:  string
  /** Agents that can read this artifact */
  sharedWith:  string[]   // agent ids, or ['*'] for all
  tags:        string[]
  createdAt:   string
}

export interface ArtifactPort {
  store(artifact: Omit<Artifact, 'id' | 'createdAt' | 'sizeBytes'>): Promise<Artifact>
  get(artifactId: string): Promise<Artifact | null>
  list(filter?: {
    producedBy?: string
    projectId?:  string
    taskId?:     string
    kind?:       ArtifactKind
    sharedWith?: string
  }): Promise<Artifact[]>
  share(artifactId: string, agentIds: string[]): Promise<void>
  delete(artifactId: string): Promise<void>
}
