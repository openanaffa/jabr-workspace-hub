/**
 * A2A v1.0 type extensions
 * Augments existing src/types/types.ts without breaking v0.3 consumers.
 */

export interface A2AMessageV10 {
  role:              'user' | 'agent'
  messageId:         string
  contextId?:        string
  referenceTaskIds?: string[]
  parts:             A2APartV10[]
  metadata?:         Record<string, unknown>
}

export type A2APartV10 =
  | { kind: 'text';             text: string }
  | { kind: 'file';             file: { name: string; mimeType: string; bytes?: string; uri?: string } }
  | { kind: 'data';             data: unknown }
  | { kind: 'functionCall';     id: string; name: string; args: Record<string, unknown> }
  | { kind: 'functionResponse'; id: string; name: string; response: unknown }

// TaskStorePort already has all v1.0 states ✅
export type TaskStateV10 =
  | 'submitted' | 'working' | 'input-required' | 'auth-required'
  | 'completed'  | 'failed'  | 'canceled'       | 'rejected'
