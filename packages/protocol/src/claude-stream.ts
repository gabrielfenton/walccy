// ──────────────────────────────────────────────
// Claude Agent SDK type re-exports
// ──────────────────────────────────────────────
//
// Single boundary between the upstream @anthropic-ai/claude-agent-sdk types
// and walccy code. Daemon and translators import SDK shapes through this
// facade so a future SDK swap (or a vendored mock) lands in one place.

export type {
  // Core stream
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKUserMessageReplay,
  SDKSystemMessage,
  SDKStatusMessage,
  SDKStatus,
  SDKResultMessage,
  SDKResultSuccess,
  SDKResultError,
  SDKPartialAssistantMessage,
  SDKRateLimitEvent,
  SDKRateLimitInfo,
  SDKHookStartedMessage,
  SDKHookProgressMessage,
  SDKHookResponseMessage,
  SDKPluginInstallMessage,
  SDKAuthStatusMessage,
  SDKElicitationCompleteMessage,
  SDKMemoryRecallMessage,
  SDKCompactBoundaryMessage,
  SDKTaskStartedMessage,
  SDKTaskProgressMessage,
  SDKTaskUpdatedMessage,
  SDKTaskNotificationMessage,
  SDKToolProgressMessage,
  SDKToolUseSummaryMessage,
  SDKPermissionDeniedMessage,
  SDKPermissionDenial,
  SDKMirrorErrorMessage,

  // Permission plane
  CanUseTool,
  PermissionMode,
  PermissionBehavior,
  PermissionResult,
  PermissionUpdate,

  // Agent / model config
  AgentDefinition,
  AgentInfo,
  EffortLevel,
  ModelInfo,
  ModelUsage,

  // Hooks
  HookEvent,
  HookPermissionDecision,
  HookCallback,

  // MCP
  McpServerStatus,
  McpServerConfig,
  McpServerToolPolicy,

  // Query control
  Query,
  Options as SdkQueryOptions,
} from '@anthropic-ai/claude-agent-sdk';
