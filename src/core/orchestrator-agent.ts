/**
 * OrchestratorAgent — master agent that receives ALL user requests.
 *
 * Responsibilities:
 *  1. Parse intent and classify the request
 *  2. Decompose complex tasks into sub-goals
 *  3. Route sub-goals to specialist agents via ToolRouter
 *  4. Create + update Hub projects/goals for multi-step work
 *  5. Emit realtime events throughout
 *  6. Persist decisions to MemPalace
 *  7. Return synthesised result (via CognitiveLoop if consensus needed)
 *
 * This is the ONLY entry point for external requests.
 * Domain logic only — no infrastructure imports.
 */

import type { LlmPort } from '@ports/llm-port'
import type { MemoryStorePort } from '@ports/memory-store'
import type { KnowledgePort } from '@ports/knowledge-port'
import type { TaskStorePort } from '@ports/task-store'
import type { KanbanPort } from '@ports/kanban-port'
import type { BudgetPort } from '@ports/budget-port'
import type { RealtimePort } from '@ports/realtime-port'
import type { AgentProfilePort } from '@ports/agent-profile-port'
import type { ArtifactPort } from '@ports/artifact-port'
import type { HubPort } from '@ports/hub-port'
import type { ToolHubPort } from '@ports/tool-hub-port'
import type { AgentRegistryPort } from '@ports/agent-registry'
import type { DomainEventBus } from '@ports/plugin-event-bus.types'

export interface OrchestratorConfig {
  llm:          LlmPort
  memory:       MemoryStorePort
  knowledge:    KnowledgePort
  taskStore:    TaskStorePort
  kanban:       KanbanPort
  budget:       BudgetPort
  realtime:     RealtimePort
  agentProfile: AgentProfilePort
  artifacts:    ArtifactPort
  hub:          HubPort
  toolHub:      ToolHubPort
  registry:     AgentRegistryPort
  eventBus:     DomainEventBus
  /** Downstream agents — name → url */
  agents: Record<string, { url: string; tags: string[] }>
  /** Max recursive handover depth */
  maxDepth?: number
}

export interface OrchestratorRequest {
  text:       string
  callerId?:  string    // agent id or 'user'
  projectId?: string    // attach to existing project
  taskId?:    string    // resume existing task
  depth?:     number    // current handover depth (internal)
}

export interface OrchestratorResult {
  taskId:    string
  output:    string
  artifacts: string[]   // artifact ids produced
  agentPath: string[]   // routing trace
}

/**
 * Intent classification — pure, no I/O.
 * Extend this as the agent ecosystem grows.
 */
export type TaskIntent =
  | 'code_review'   | 'code_gen'     | 'bug_fix'
  | 'research'      | 'search'       | 'docs'
  | 'design'        | 'data_analysis'| 'codebase_nav'
  | 'multi_agent'   | 'project_mgmt' | 'unknown'

const INTENT_AGENT_MAP: Record<TaskIntent, string[]> = {
  code_review:   ['oracle'],
  code_gen:      ['fixer'],
  bug_fix:       ['fixer', 'oracle'],
  research:      ['librarian'],
  search:        ['librarian', 'explorer'],
  docs:          ['librarian'],
  design:        ['designer'],
  data_analysis: ['scientist'],
  codebase_nav:  ['explorer'],
  multi_agent:   ['oracle', 'fixer', 'librarian'],
  project_mgmt:  [],   // handled internally
  unknown:       [],   // consensus across all agents
}

export function classifyIntent(text: string): TaskIntent {
  const t = text.toLowerCase()
  if (/review|critique|architecture|simplif/.test(t))          return 'code_review'
  if (/implement|generate|write.*code|create.*function/.test(t)) return 'code_gen'
  if (/fix|bug|error|exception|crash|fail/.test(t))            return 'bug_fix'
  if (/research|what is|explain|how does/.test(t))             return 'research'
  if (/search|find|look up|grep/.test(t))                      return 'search'
  if (/document|readme|changelog|spec/.test(t))                return 'docs'
  if (/design|ui|ux|layout|component|style/.test(t))           return 'design'
  if (/analys|data|python|notebook|plot|chart/.test(t))        return 'data_analysis'
  if (/explore|map|structure|where is/.test(t))                return 'codebase_nav'
  if (/project|goal|plan|milestone|roadmap/.test(t))           return 'project_mgmt'
  if (/compare|consensus|vote|best approach/.test(t))          return 'multi_agent'
  return 'unknown'
}

export class OrchestratorAgent {
  private readonly maxDepth: number

  constructor(private readonly cfg: OrchestratorConfig) {
    this.maxDepth = cfg.maxDepth ?? 3
  }

  async handle(req: OrchestratorRequest): Promise<OrchestratorResult> {
    const depth = req.depth ?? 0
    if (depth > this.maxDepth) {
      return { taskId: 'depth-exceeded', output: 'Max handover depth exceeded.', artifacts: [], agentPath: [] }
    }

    // 1. Create task
    const task = this.cfg.taskStore.create(crypto.randomUUID())
    const taskId = task.id
    this.cfg.taskStore.updateState(taskId, 'working')
    this.cfg.realtime.broadcast({ type: 'task:created', taskId, agent: 'orchestrator' })

    // 2. Recall relevant memory (L0/L1 first)
    const memories = await this.cfg.memory.read()
    const knowledge = await this.cfg.knowledge.query(req.text, 3)

    // 3. Classify intent → select agents
    const intent = classifyIntent(req.text)
    const agentNames = INTENT_AGENT_MAP[intent]
    const agentPath: string[] = ['orchestrator']

    // 4. Project management intent — handle internally
    if (intent === 'project_mgmt') {
      const result = await this._handleProjectMgmt(req, taskId)
      this.cfg.taskStore.updateState(taskId, 'completed')
      return { taskId, output: result, artifacts: [], agentPath }
    }

    // 5. Build enriched prompt
    const contextLines: string[] = [
      memories.length ? `Session context:\n${memories.map(m => m.parts.map((p: any) => p.text).join('')).join('\n')}` : '',
      knowledge.length ? `Knowledge:\n${knowledge.map(k => `[${k.slug}] ${k.content}`).join('\n')}` : '',
      `Task: ${req.text}`,
    ].filter(Boolean)
    const enrichedPrompt = contextLines.join('\n\n')

    // 6. Single agent
    if (agentNames.length === 1) {
      const agentName = agentNames[0]
      const agentCfg = this.cfg.agents[agentName]
      if (!agentCfg) throw new Error(`Agent not configured: ${agentName}`)
      agentPath.push(agentName)

      this.cfg.realtime.broadcast({ type: 'task:progress', taskId, percent: 20, message: `Routing to ${agentName}` })
      const output = await this.cfg.registry.delegateTask(agentCfg.url, enrichedPrompt, agentName)

      // Update profile stats
      await this.cfg.agentProfile.updateStats(agentName, { tasksCompleted: 1, tokensUsed: output.length / 4 })
      // Post to hub thread if project
      if (req.projectId) await this._postToHub(req.projectId, taskId, agentName, output)

      this.cfg.taskStore.updateState(taskId, 'completed')
      this.cfg.realtime.broadcast({ type: 'task:completed', taskId, result: output })
      return { taskId, output, artifacts: [], agentPath }
    }

    // 7. Multi-agent consensus
    if (agentNames.length > 1 || intent === 'unknown') {
      const targets = agentNames.length ? agentNames : Object.keys(this.cfg.agents)
      this.cfg.realtime.broadcast({ type: 'task:progress', taskId, percent: 10, message: `Consensus across ${targets.join(', ')}` })

      const responses = await Promise.allSettled(
        targets.map(async name => {
          const agentCfg = this.cfg.agents[name]
          if (!agentCfg) return null
          const out = await this.cfg.registry.delegateTask(agentCfg.url, enrichedPrompt, name)
          agentPath.push(name)
          return { agentName: name, card: {} as any, response: out }
        })
      )
      const inputs = responses
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value != null)
        .map(r => r.value)

      // LLM synthesis via CognitiveLoop (wired externally)
      const synthesised = inputs.map((i: any) => `[${i.agentName}]: ${i.response}`).join('\n\n')
      const finalPrompt = `Synthesise the best answer from these agent responses for: "${req.text}"\n\n${synthesised}`
      const output = await this.cfg.llm.complete(finalPrompt)

      this.cfg.taskStore.updateState(taskId, 'completed')
      this.cfg.realtime.broadcast({ type: 'task:completed', taskId, result: output })
      return { taskId, output, artifacts: [], agentPath }
    }

    // 8. Fallback — LLM direct
    const output = await this.cfg.llm.complete(enrichedPrompt)
    this.cfg.taskStore.updateState(taskId, 'completed')
    return { taskId, output, artifacts: [], agentPath }
  }

  /** Handle project/goal management requests without subagent delegation */
  private async _handleProjectMgmt(req: OrchestratorRequest, taskId: string): Promise<string> {
    const project = await this.cfg.hub.createProject({
      name:      `Project: ${req.text.slice(0, 60)}`,
      description: req.text,
      status:    'active',
      ownerId:   req.callerId ?? 'orchestrator',
      memberIds: Object.keys(this.cfg.agents),
      tags:      ['auto-created'],
    })
    const thread = await this.cfg.hub.createThread({
      scope: { kind: 'project', projectId: project.id },
      title: 'Main Thread',
    })
    await this.cfg.hub.postMessage({
      threadId: thread.id, authorId: 'orchestrator', role: 'agent',
      content: `Project created for: ${req.text}`, artifacts: [],
    })
    return `Project "${project.name}" created (id: ${project.id}). Thread: ${thread.id}`
  }

  private async _postToHub(projectId: string, taskId: string, agentName: string, output: string) {
    const threads = await this.cfg.hub.listThreads({ kind: 'task', taskId })
    const thread = threads[0] ?? await this.cfg.hub.createThread({
      scope: { kind: 'task', taskId }, title: `Task ${taskId}`,
    })
    await this.cfg.hub.postMessage({
      threadId: thread.id, authorId: agentName, role: 'agent',
      content: output, artifacts: [],
    })
  }
}
