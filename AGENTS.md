# Jabr — Agent Workspace (Consolidated)

**Jabr (جبر)** — Orchestration workspace merging jabr agent-lab with the
MemPalace / OpenViking / Headroom / Graft / opensrc / Hermes ecosystem.

---

## Runtime stack

| Layer          | Tool                                          | Role |
|----------------|-----------------------------------------------|------|
| Orchestrator   | Hermes Agent (NousResearch)                   | Spawns + manages subagents |
| Subagents      | Claude Code · Opencode · Codex · crush        | Execution |
| Token savings  | RTK (hook-based, auto-rewrites bash cmds)     | 60-90% bash output reduction |
| Budget port    | HeadroomAdapter → BudgetPort                  | Per-agent token cap |
| Memory (session) | SqliteMemoryStore → MemoryStorePort         | Conversation history |
| Memory (long-term) | MemPalaceAdapter → KnowledgePort          | Slug/tag/relation store |
| Task store     | SqliteTaskStore → TaskStorePort               | A2A task lifecycle |
| LLM            | 9Router (default) · Vercel AI SDK · OpenAI    | Provider-agnostic via LlmPort |
| Codebase map   | Graft (auto-generated graft/ folder)          | Module layout, read-only |
| Dep source     | opensrc (vercel-labs)                         | Cached npm/PyPI/crates source |
| MCP            | .mcp.json → graft MCP server                  | Tool integration |
| Version mgmt   | mise                                          | bun + python 3.12 |

---

## RTK — correct usage

RTK is a **hook-based proxy**, not a CLI wrapper. It rewrites bash commands
transparently. No `rtk wrap`, no subshell.

```bash
# Install once per agent tool:
rtk init -g              # Claude Code (default)
rtk init -g --opencode   # OpenCode plugin
rtk init -g --codex      # Codex (AGENTS.md + RTK.md)
rtk init --agent hermes  # Hermes Python plugin adapter

# Verify
rtk --version
rtk gain

# After init, all bash tool calls are auto-rewritten:
#   git status  →  rtk git status   (transparent, agent never sees it)
#   bun test    →  rtk bun test
#   tsc         →  rtk tsc

# Direct RTK commands (use when hook doesn't cover built-in agent tools):
rtk git status
rtk git diff
rtk bun test
rtk tsc
rtk lint biome
rtk read src/core/orchestrator.ts
rtk grep "KnowledgePort" src/
rtk ls src/adapters/
```

**Golden rule (from jabr's CLAUDE.md):** Always prefix bash commands with `rtk`.
Even in chains: `rtk git add . && rtk git commit -m "msg" && rtk git push`

---

## Architecture invariants

Hexagonal / Ports & Adapters — do NOT violate:
1. `src/core/` — domain logic. Zero infrastructure imports. Only ports/types.
2. `src/ports/` — TypeScript interfaces (`import type` only).
3. `src/adapters/` — concrete impls. Implements ports. Never imports core.
4. `src/runtime/` — composition roots. Wires adapters to core. The ONLY place adapters meet core.
5. `src/constants/ecosystem.ts` — single source of truth for ports and paths.

**Path aliases (tsconfig):**
`@core/*` `@ports/*` `@adapters/*` `@runtime/*` `@config/*` `@constants/*` `@utils/*`

---

## Port taxonomy (actual, from jabr)

| Port               | Interface          | Adapter(s) |
|--------------------|--------------------|------------|
| LLM                | LlmPort            | VercelLlmAdapter, NineRouterLlmAdapter, OpenAiLlmAdapter |
| Memory (session)   | MemoryStorePort    | SqliteMemoryStore |
| Memory (knowledge) | KnowledgePort      | MemPalaceAdapter |
| Task               | TaskStorePort      | SqliteTaskStore |
| Budget             | BudgetPort         | HeadroomAdapter |
| Kanban             | KanbanPort         | HermesKanbanAdapter |
| Realtime           | RealtimePort       | BunWebSocketAdapter |
| Artifact           | ArtifactPort       | IpfsArtifactAdapter |
| Agent Registry     | AgentRegistryPort  | DynamicRegistry |
| MCP Tools          | McpToolPort        | MCP client/server |
| Search             | SearchPort         | NineRouterSearchAdapter |
| Image Gen          | ImageGenPort       | NineRouterImageGenAdapter |

**HeadroomAdapter implements BudgetPort** — it is a token budget tracker,
NOT a context compressor. Headroom caps per-agent token spend.

---

## RAG / Knowledge retrieval

Priority chain (fastest first):
1. `MemPalaceAdapter.query(text, topK)` → KnowledgePort — long-term slug store
2. `SqliteMemoryStore.read()` → session history
3. `graft/` map — codebase structure (read-only markdown, never modify)
4. `opensrc path <pkg>` — dep source on-demand

All wired in runtime/orchestrator.ts via ToolRouter → KnowledgePort injection.

---

## Ecosystem services (agents)

| Agent        | Port  | Entry point |
|--------------|-------|-------------|
| Orchestrator | 4000  | bun src/runtime/orchestrator.ts |
| Oracle       | 4001  | bun src/runtime/agents/oracle.ts |
| Librarian    | 4002  | bun src/runtime/agents/librarian.ts |
| Explorer     | 4003  | bun src/runtime/agents/explorer.ts |
| Designer     | 4004  | bun src/runtime/agents/designer.ts |
| Fixer        | 4005  | bun src/runtime/agents/fixer.ts |
| Scientist    | 4006  | bun src/runtime/agents/scientist.ts |
| Jarvis       | 1337  | bun src/runtime/agents/jarvis.ts |

---

## Essential commands

```bash
bun install                  # Install deps
bun run dev                  # Start all agents (scripts/dev.sh)
bun run orchestrator         # Orchestrator only (port 4000)
bun test                     # Test suite
bun run typecheck            # tsc --noEmit
rtk lint biome               # Linter (Biome)
bun run graft                # Regenerate graft/ codebase map
bun run fetch:sources        # Cache dep sources via opensrc
bun run kb-maintenance       # MemPalace knowledge base maintenance
```

---

## External tools setup (run once)

```bash
# 1. mise — tool version manager
mise install                 # installs bun + python per .mise.toml

# 2. RTK — install for all your agent tools
rtk init -g                  # Claude Code
rtk init -g --opencode       # OpenCode
rtk init -g --codex          # Codex
rtk init --agent hermes      # Hermes

# 3. Graft — MCP server + codebase map
bun run graft                # generates graft/ folder
# .mcp.json already registers graft MCP server

# 4. opensrc — cache dep sources
bun run fetch:sources        # runs scripts/opensrc-fetch.ts
```

---

## Known issues (FIXME.md)

- [ ] CLI is outdated — `jabr-cli.ts` uses old agent names, no `all` arg
- [ ] `bun test` has failures — fix before running demo
- [ ] 20 typecheck errors in src/ — migration artifact, see .omo/plans/type-debt-remediation.md

---

## Hub features (new ports + adapters)

### What was added

| Feature               | Port                  | Adapter                              | SQLite table(s) |
|-----------------------|-----------------------|--------------------------------------|-----------------|
| Orchestrator (master) | —                     | `src/core/orchestrator-agent.ts`     | — (uses all ports) |
| Central Hub           | `HubPort`             | `SqliteHubAdapter`                   | hub_projects · hub_goals · hub_threads · hub_messages · hub_ballots |
| Agent Profiles        | `AgentProfilePort`    | `SqliteAgentProfileAdapter`          | agent_profiles |
| Artifact sharing      | `ArtifactPort`        | `SqliteArtifactAdapter`              | artifacts |
| Tools Hub             | `ToolHubPort`         | `SqliteToolHubAdapter`               | tool_hub_definitions · tool_hub_calls |
| Plugin context v2     | `PluginContextV2`     | extends existing `PluginContext`     | — |
| Hub realtime events   | `HubRealtimeEvent`    | extends `RealtimePort` event union   | — |

### Architecture invariants (unchanged)

- All new ports live in `src/ports/` — import type only
- All new adapters live in `src/adapters/` — never imported by core
- `src/core/orchestrator-agent.ts` is pure domain — zero adapter imports
- `src/runtime/hub-runtime.ts` is the ONLY composition root — wires ports to adapters

### Wiring into existing runtime

```typescript
// src/runtime/orchestrator.ts — add:
import { createHubRuntime, seedAgentProfiles } from './hub-runtime'

const hub = createHubRuntime(db)   // db from openJabrDb()

await seedAgentProfiles(hub.agentProfile, [
  { id: 'orchestrator', name: 'Orchestrator', role: 'orchestrator', port: JABR_PORTS.orchestrator, tags: ['routing', 'consensus'] },
  { id: 'oracle',       name: 'Oracle',       role: 'oracle',       port: JABR_PORTS.oracle,       tags: ['code', 'review', 'architecture'] },
  // ... other agents from JABR_PORTS
])

// Then pass hub.* into OrchestratorAgent config:
const orchestrator = new OrchestratorAgent({
  llm, memory, knowledge, taskStore, kanban, budget, realtime, registry, eventBus,
  ...hub,         // hub, artifacts, agentProfile, toolHub
  agents: { oracle: { url: jabrUrlForPort(JABR_PORTS.oracle), tags: ['code'] }, ... },
})
```

### Voting mechanics

Ballots use **weighted votes** — `vote.weight` comes from agent stats or is set to 1.0 for equal voting.
Quorum check: ballot must have `>= quorum` votes before `closeBallot()` elects a winner.
All ballot activity broadcasts `hub:vote:cast` and `hub:vote:closed` via RealtimePort.

### RTK — unchanged correct usage

```bash
rtk init -g              # Claude Code (installs PreToolUse hook)
rtk init -g --opencode   # OpenCode plugin
rtk init -g --codex      # Codex
rtk init --agent hermes  # Hermes Python plugin adapter

# All bash tool calls auto-rewritten — transparent, no manual wrapping:
#   git status  →  rtk git status
#   bun test    →  rtk bun test
```
