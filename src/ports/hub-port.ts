/**
 * HubPort — Central Communication Hub
 *
 * Projects  → top-level containers for goals + tasks
 * Goals     → milestones within a project
 * Threads   → chat threads attached to a project, goal, or task
 * Messages  → chat messages in a thread (from agents or humans)
 * Votes     → weighted voting on contested decisions
 */

import type { KanbanTaskStatus } from './kanban-port'

// ─── Projects ─────────────────────────────────────────────────────────────

export interface Project {
  id:          string
  name:        string
  description: string
  status:      'active' | 'paused' | 'completed' | 'archived'
  ownerId:     string       // agent or human id
  memberIds:   string[]     // agents participating
  tags:        string[]
  createdAt:   string
  updatedAt:   string
}

// ─── Goals ────────────────────────────────────────────────────────────────

export interface Goal {
  id:          string
  projectId:   string
  title:       string
  description: string
  status:      KanbanTaskStatus
  assigneeId?: string
  priority:    number         // 1 (highest) – 5 (lowest)
  /** Linked kanban task ids */
  taskIds:     string[]
  dueAt?:      string
  createdAt:   string
  updatedAt:   string
}

// ─── Chat Threads ─────────────────────────────────────────────────────────

export type ThreadScope =
  | { kind: 'project'; projectId: string }
  | { kind: 'goal';    goalId:    string }
  | { kind: 'task';    taskId:    string }
  | { kind: 'global' }

export interface ChatThread {
  id:        string
  scope:     ThreadScope
  title:     string
  createdAt: string
}

export interface ChatMessage {
  id:         string
  threadId:   string
  authorId:   string          // agent id or 'user'
  role:       'user' | 'agent'
  content:    string
  /** Artifact ids attached to this message */
  artifacts:  string[]
  replyToId?: string
  createdAt:  string
}

// ─── Voting ───────────────────────────────────────────────────────────────

export type VoteOption = string   // e.g. "approve" | "reject" | "defer"

export interface Vote {
  voterId:    string            // agent id
  option:     VoteOption
  weight:     number            // from AgentProfile.stats or fixed
  reason?:    string
  castAt:     string
}

export interface Ballot {
  id:         string
  threadId:   string            // always tied to a thread for context
  question:   string
  options:    VoteOption[]
  votes:      Vote[]
  status:     'open' | 'closed'
  result?:    VoteOption        // winning option after close
  quorum:     number            // min votes to be valid
  createdAt:  string
  closedAt?:  string
}

// ─── Port ─────────────────────────────────────────────────────────────────

export interface HubPort {
  // Projects
  createProject(p: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>): Promise<Project>
  getProject(id: string): Promise<Project | null>
  listProjects(filter?: { status?: Project['status']; memberId?: string }): Promise<Project[]>
  updateProject(id: string, patch: Partial<Pick<Project, 'name' | 'description' | 'status' | 'memberIds' | 'tags'>>): Promise<void>

  // Goals
  createGoal(g: Omit<Goal, 'id' | 'createdAt' | 'updatedAt'>): Promise<Goal>
  getGoal(id: string): Promise<Goal | null>
  listGoals(projectId: string, filter?: { status?: KanbanTaskStatus }): Promise<Goal[]>
  updateGoal(id: string, patch: Partial<Pick<Goal, 'status' | 'assigneeId' | 'taskIds' | 'priority'>>): Promise<void>

  // Threads
  createThread(t: Omit<ChatThread, 'id' | 'createdAt'>): Promise<ChatThread>
  getThread(id: string): Promise<ChatThread | null>
  listThreads(scope: ThreadScope): Promise<ChatThread[]>

  // Messages
  postMessage(m: Omit<ChatMessage, 'id' | 'createdAt'>): Promise<ChatMessage>
  listMessages(threadId: string, opts?: { limit?: number; before?: string }): Promise<ChatMessage[]>

  // Voting
  createBallot(b: Omit<Ballot, 'id' | 'votes' | 'status' | 'result' | 'createdAt'>): Promise<Ballot>
  castVote(ballotId: string, vote: Omit<Vote, 'castAt'>): Promise<void>
  closeBallot(ballotId: string): Promise<Ballot>
  getBallot(id: string): Promise<Ballot | null>
}
