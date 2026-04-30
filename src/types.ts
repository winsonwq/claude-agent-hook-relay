export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

// Rich tree structure for nested calls
export type CallNode = SkillCallNode | ToolCallNode;

export interface SkillCallNode {
  type: 'skill';
  name: string;
  toolUseId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: CallNode[];
  usage?: ModelUsage;
  // Skill loading result
  success: boolean;                  // true if skill loaded successfully
  error?: string;                  // error message if loading failed
  // Path discovery context: filesystem probes that followed this skill call
  discoveryCalls: ToolCallNode[];
  // Inference: did this skill load from a nested directory (e.g. parent-skill/scripts/child-skill/)
  loadedFromNestedPath: boolean;
}

export interface ToolCallNode {
  type: 'tool';
  name: string;
  toolUseId?: string;
  // Tool-specific info
  command?: string;    // Bash
  file?: string;       // Read
  pattern?: string;    // Glob / Grep
  url?: string;        // WebFetch
  query?: string;      // WebSearch
  content?: string;    // Edit
  // etc.
  startTime?: number;  // When this tool was called (for synthetic <no-skill> root)
  durationMs?: number;
  usage?: ModelUsage;  // Token usage for this tool call
  // Error info (populated when tool call fails)
  error?: {
    message: string;
    code?: string;
  };
}

export interface SkillInvocation {
  skill: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: CallNode[];
  toolUseId?: string;
  isDone?: boolean;
}

export interface HookEvent {
  type: string;
  toolName?: string;
  toolUseId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  queryDepth?: number;
  sessionId: string;
  timestamp: number;
  transcriptPath?: string;
}

export interface Session {
  sessionId: string;
  sourceId: string;
  skillStack: SkillInvocation[];
  completedSkills: SkillInvocation[];
  events: HookEvent[];
  skillTree: SkillTree | null;
  transcriptPath: string | null;
  createdAt: number;
  updatedAt: number;
  // Cached from Stop event for use in SessionEnd
  cachedUsage?: ModelUsage;
  cachedSkillTree?: SkillTree;
  // Tool failures that occurred
  failures: ToolFailure[];
}

// Forwarder interface
export interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
  /**
   * Optional real-time event logging (called as events arrive, before forward()).
   * If not implemented, the collector falls back to silent tracking.
   */
  logPreToolUse?(params: { sessionId: string; toolUseId: string; toolName: string; skillName?: string }): void;
  logPostToolUse?(params: { sessionId: string; toolUseId: string; toolName: string; skillName?: string }): void;
  logToolFailure?(params: { sessionId: string; toolUseId: string; toolName: string; error: string; skillName?: string }): void;
}

// Single entry point skill tree (unified view)
export interface SkillTree {
  skill: string;
  toolUseId: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: CallNode[];
  usage?: ModelUsage;
  // Full root skill node with all skill-loading metadata
  root: SkillCallNode;
}

export interface ForwardPayload {
  sessionId: string;
  sourceId: string;
  skillTree: SkillTree | null;  // Single entry point, null if no skill was called
  totalUsage: ModelUsage;
  allEvents: HookEvent[];
  sessionDuration: number;
  stopReason?: string;
  // Tool failures that occurred during the session
  failures: ToolFailure[];
}

export interface ToolFailure {
  sessionId: string;
  sourceId: string;
  toolName: string;
  toolUseId?: string;
  skillName?: string;  // Which skill this tool was called within (if any)
  error: string;
  timestamp: number;
}
