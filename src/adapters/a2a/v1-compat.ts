/**
 * A2A v0.3 ↔ v1.0 dual-mode compatibility layer
 *
 * Jabr current wire: POST / → tasks/send (neither v0.3 nor v1.0 clean)
 * IBM v0.3:          POST / → message/send
 * A2A v1.0:          POST /message:send → SendMessage
 *
 * This module:
 *  1. Normalises all three method variants to a canonical TaskRequest
 *  2. Routes by A2A-Version header or method name
 *  3. Serialises response in the caller's expected shape
 */

import type { A2AMessage, A2APart } from "@agents/types"

// ─── Canonical internal shape ─────────────────────────────────────────────

export interface NormalisedTaskRequest {
  taskId?:    string
  contextId?: string
  messageId:  string
  text:       string
  parts:      A2APart[]
  callbackUrl?: string
  version:    '0.3' | '1.0'
}

// ─── Part types added for v1.0 ────────────────────────────────────────────

export type A2APartV10 =
  | { kind: 'text';             text: string }
  | { kind: 'file';             file: { name: string; mimeType: string; bytes?: string; uri?: string } }
  | { kind: 'data';             data: unknown }
  | { kind: 'functionCall';     id: string; name: string; args: Record<string, unknown> }
  | { kind: 'functionResponse'; id: string; name: string; response: unknown }

// ─── Message envelope (v1.0 shape) ────────────────────────────────────────

export interface A2AMessageV10 {
  role:              'user' | 'agent'
  messageId:         string
  contextId?:        string
  referenceTaskIds?: string[]
  parts:             A2APartV10[]
  metadata?:         Record<string, unknown>
}

// ─── Method routing ───────────────────────────────────────────────────────

export type A2AVersion = '0.3' | '1.0'

export function detectVersion(
  method: string,
  versionHeader?: string,
): A2AVersion {
  if (versionHeader?.startsWith('1.')) return '1.0'
  if (versionHeader?.startsWith('0.')) return '0.3'
  // Infer from method name
  if (method === 'message:send' || method === 'SendMessage') return '1.0'
  return '0.3'
}

// ─── Request normalisation ────────────────────────────────────────────────

export function normaliseRequest(
  body: Record<string, unknown>,
  version: A2AVersion,
): NormalisedTaskRequest {
  const params = (body.params ?? {}) as Record<string, unknown>

  if (version === '1.0') {
    // v1.0: params.message is A2AMessageV10
    const msg = (params.message ?? {}) as Record<string, unknown>
    const parts = (msg.parts ?? []) as A2APartV10[]
    const text = parts.find(p => (p as any).kind === 'text') as any
    return {
      taskId:     params.taskId as string | undefined,
      contextId:  msg.contextId as string | undefined,
      messageId:  (msg.messageId as string) ?? crypto.randomUUID(),
      text:       text?.text ?? '',
      parts:      parts as A2APart[],
      callbackUrl: params.callbackUrl as string | undefined,
      version:    '1.0',
    }
  }

  // v0.3 / jabr current: params.message.parts or params.id
  const msg = (params.message ?? params) as Record<string, unknown>
  const parts = (msg.parts ?? []) as A2APart[]
  const text = parts.find(p => (p as any).kind === 'text') as any
  return {
    taskId:     params.id as string | undefined,
    contextId:  undefined,
    messageId:  crypto.randomUUID(),
    text:       text?.text ?? '',
    parts,
    callbackUrl: params.callbackUrl as string | undefined,
    version:    '0.3',
  }
}

// ─── Response serialisation ───────────────────────────────────────────────

export function serialiseResponse(
  id: string | number | null,
  task: { id: string; state: string; artifacts: unknown[]; messages?: unknown[] },
  version: A2AVersion,
) {
  if (version === '1.0') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        task: {
          id:         task.id,
          state:      task.state,
          contextId:  task.id,          // use taskId as contextId until proper tracking
          artifacts:  task.artifacts,
          messages:   task.messages ?? [],
        },
      },
    }
  }
  // v0.3 / jabr current shape — unchanged
  return {
    jsonrpc: '2.0',
    id,
    result: { task },
  }
}

// ─── AgentCard v1.0 extensions ───────────────────────────────────────────

export interface AgentCardV10Extension {
  protocolVersion: string
  supportedInterfaces: Array<{
    url:             string
    binding:         'json-rpc' | 'grpc' | 'rest'
    protocolVersion: string
  }>
}

export function extendCard(
  card: Record<string, unknown>,
  agentUrl: string,
): Record<string, unknown> {
  return {
    ...card,
    protocolVersion: '1.0.0',
    supportedInterfaces: [
      // v1.0 endpoint
      { url: `${agentUrl}/message:send`, binding: 'json-rpc', protocolVersion: '1.0.0' },
      // v0.3 back-compat
      { url: agentUrl,                   binding: 'json-rpc', protocolVersion: '0.3.0' },
    ],
  }
}
