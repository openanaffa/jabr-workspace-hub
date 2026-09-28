/**
 * Hub-specific realtime events.
 * Augments existing RealtimePort event union in realtime-port.ts.
 * Add these to RealtimeEvent in realtime-port.ts when ready to merge.
 */

export type HubRealtimeEvent =
  | { type: 'hub:message';     threadId: string; messageId: string; authorId: string }
  | { type: 'hub:vote:cast';   ballotId: string; voterId: string;   option: string }
  | { type: 'hub:vote:closed'; ballotId: string; result: string }
  | { type: 'hub:goal:update'; goalId: string;   status: string }
  | { type: 'hub:artifact';    artifactId: string; producedBy: string; taskId?: string }
  | { type: 'hub:agent:online'; agentId: string; profile: { name: string; role: string } }
