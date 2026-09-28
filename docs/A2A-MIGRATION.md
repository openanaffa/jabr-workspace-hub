# Jabr — A2A Protocol Gap Analysis & v1.0 Migration

**Jabr current:** v0.3-compatible wire protocol  
**Target:** A2A v1.0.0 (spec @ a2a-protocol.org, ratified 2026-08-27)  
**A2A governance:** Linux Foundation · Apache-2.0 · TSC: AWS, Cisco, Google, IBM, Microsoft

---

## Current vs v1.0 wire protocol

| Aspect                  | Jabr now (v0.3)                        | A2A v1.0 spec                                |
|-------------------------|----------------------------------------|----------------------------------------------|
| Endpoint                | `POST /`                               | `POST /message:send` · `POST /message:stream`|
| Method name             | `tasks/send`                           | `message/send` (JSON-RPC) → `SendMessage` (gRPC) |
| Streaming               | ❌ none                                | `POST /message:stream` → SSE chunks          |
| Agent Card path         | `/.well-known/agent-card.json` ✅      | `/.well-known/agent-card.json` ✅            |
| Task states             | submitted/working/completed… ✅        | Same set + `AUTH_REQUIRED` (already in TaskStorePort) ✅ |
| Message shape           | `{parts:[{kind,text}]}`                | `{role, messageId, contextId, referenceTaskIds[], parts[]}` |
| Part types              | text, file, data                       | Text · File · Data · FunctionCall · FunctionResponse |
| Auth                    | API key in header                      | OAuth2/OIDC/mTLS/APIKey — declared in AgentCard |
| Version negotiation     | ❌                                     | `A2A-Version` request header + `protocolVersion` in card |
| Push notifications      | ❌                                     | `tasks/pushNotificationConfig/set` RPC |
| AgentCard `supportedInterfaces[]` | ❌                        | URL + binding + protocolVersion per interface |

**Note:** IBM watsonx Orchestrate and BeeAI are still on v0.3 (slash-style `message/send`).  
Jabr is ahead of them on card path but behind on endpoint shape and streaming.

---

## Gap inventory

### P0 — breaks interop with v1.0 clients

**GAP-1: Endpoint + method name**  
Current: `POST /` with `tasks/send`  
Required: `POST /message:send` with `message/send` (or `SendMessage` over gRPC)

```typescript
// src/adapters/http/a2a-server.ts — add alongside existing root handler
app.post('/message:send', handleSendMessage)
app.post('/message:stream', handleStreamMessage)  // SSE, GAP-3 below
```

Keep `POST /` + `tasks/send` behind a feature flag for IBM/BeeAI v0.3 clients.

**GAP-2: Message envelope missing required fields**  
Current parts shape: `{kind: "text", text: "..."}`  
Required: wrap in `Message` with `role`, `messageId`, `contextId`

```typescript
// src/types/a2a.ts — extend existing A2AMessage
export interface A2AMessage {
  role: 'user' | 'agent'           // ← add
  messageId: string                 // ← add (nanoid)
  contextId?: string                // ← add (groups related messages)
  referenceTaskIds?: string[]       // ← add
  parts: A2APart[]                  // existing ✅
  metadata?: Record<string, unknown>
}
```

**GAP-3: AgentCard missing `protocolVersion` + `supportedInterfaces[]`**  
Current cards don't declare the protocol version or binding list.

```typescript
// add to every AGENT_CARD constant in src/core/*.ts
protocolVersion: "1.0.0",
supportedInterfaces: [
  {
    url: jabrUrlForPort(JABR_PORTS.orchestrator),
    binding: "json-rpc",
    protocolVersion: "1.0.0"
  }
],
// Keep v0.3 entry for back-compat:
//   { url, binding: "json-rpc", protocolVersion: "0.3.0" }
```

---

### P1 — missing capability, not interop-breaking yet

**GAP-4: No SSE streaming**  
v1.0 `POST /message:stream` returns `Content-Type: text/event-stream`.  
Jabr uses Bun — `BunWebSocketAdapter` already exists; SSE is simpler.

```typescript
// src/adapters/http/a2a-server.ts
app.post('/message:stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  // stream task state transitions as SSE events
  for await (const event of taskStream(req.body)) {
    res.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  res.end()
})
```

**GAP-5: No `A2A-Version` header negotiation**  
Add to A2AServer response headers:
```typescript
res.setHeader('A2A-Version', '1.0.0')
```
Read from request; fall back to v0.3 handler if `A2A-Version: 0.3`.

**GAP-6: No `tasks/pushNotificationConfig/set` RPC**  
Webhook push for long-running tasks. Low priority until streaming lands.

**GAP-7: No in-task `AUTH_REQUIRED` flow**  
`TaskStorePort` already has `auth-required` state ✅ — wire it through  
A2AServer to return a `402`-style challenge with `authScheme` in the result.

---

### P2 — nice to have

**GAP-8: No `GetExtendedAgentCard` RPC**  
Returns full card (skills, pricing, security schemes) on authenticated request.  
Current `/.well-known/agent-card.json` returns a public subset only.

**GAP-9: AgentCard JWS signature**  
v1.0 cards can carry a JWS signature for verification.  
Jabr's `ApiKeyRegistry` provides the key material; just needs signing step.

---

## Migration sequence (minimal-breakage)

```
Phase 1 (P0 interop):
  1. Add /message:send endpoint alongside POST / (dual-mode)
  2. Extend A2AMessage type with messageId + contextId
  3. Add protocolVersion + supportedInterfaces[] to all AgentCards
  4. Add A2A-Version response header

Phase 2 (P1 streaming):
  5. Implement /message:stream → SSE in A2AServer
  6. Wire task state transitions to SSE stream
  7. Add A2A-Version request negotiation → route to v0.3 handler if needed

Phase 3 (P1 auth):
  8. Wire AUTH_REQUIRED state through to HTTP 401 + authScheme response
  9. Add pushNotificationConfig RPC

Phase 4 (P2 hardening):
  10. GetExtendedAgentCard RPC
  11. AgentCard JWS signing via ApiKeyRegistry
```

---

## v0.3 back-compat notes

IBM watsonx Orchestrate (v0.3.0) and BeeAI tutorials use:
- Endpoint: `POST /` with method `message/send` (slash, not colon)
- Jabr currently uses `tasks/send` — even jabr is not v0.3-clean

Dual-mode handler pattern:

```typescript
// src/adapters/http/a2a-server.ts
function routeMethod(method: string): 'v03' | 'v10' | 'unknown' {
  if (method === 'tasks/send' || method === 'message/send') return 'v03'
  if (method === 'message:send' || method === 'SendMessage') return 'v10'
  return 'unknown'
}
```

---

## No changes needed to ports

`TaskStorePort` is already v1.0-aligned:
- All v1.0 task states present (incl. `auth-required`, `rejected`) ✅
- `getTransitionHistory()` → satisfies `stateTransitionHistory` capability ✅
- `appendArtifact()` → satisfies v1.0 artifact model ✅

`A2APart` union needs two new members:
```typescript
export type A2APart =
  | { kind: 'text';         text: string }
  | { kind: 'file';         file: { name: string; mimeType: string; bytes?: string; uri?: string } }
  | { kind: 'data';         data: unknown }
  | { kind: 'functionCall'; id: string; name: string; args: Record<string, unknown> }     // ← add
  | { kind: 'functionResponse'; id: string; name: string; response: unknown }              // ← add
```

---

## References

- Spec v1.0.0: https://a2a-protocol.org/latest/specification/
- a2a.proto (normative): https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto
- Task lifecycle: https://a2a-protocol.org/latest/topics/life-of-a-task/
- Agent discovery: https://a2a-protocol.org/latest/specification/#8-agent-discovery-the-agent-card
- IBM watsonx A2A endpoints: https://www.ibm.com/docs/en/watsonx/watson-orchestrate/base?topic=reference-agent-agent-a2a-protocol-endpoints
- BeeAI A2A integration: https://framework.beeai.dev/integrations/a2a
- ADK exposing: https://adk.dev/a2a/quickstart-exposing/
