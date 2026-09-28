/**
 * PluginContextV2 — extends existing PluginContext from plugin.ts
 * with the new Hub, Artifact, AgentProfile, and ToolHub ports.
 * Replace PluginContext with this in plugin.ts when merging.
 */

import type { PluginContext } from './plugin'
import type { HubPort }          from './hub-port'
import type { ArtifactPort }     from './artifact-port'
import type { AgentProfilePort } from './agent-profile-port'
import type { ToolHubPort }      from './tool-hub-port'

export interface PluginContextV2 extends PluginContext {
  readonly hub:          HubPort
  readonly artifacts:    ArtifactPort
  readonly agentProfile: AgentProfilePort
  readonly toolHub:      ToolHubPort
}
