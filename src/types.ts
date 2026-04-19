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
  usage?: ModelUsage;  // Token usage for this skill and all nested calls
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
  durationMs?: number;
  usage?: ModelUsage;  // Token usage for this tool call
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
}

// Forwarder interface
export interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
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
}

export interface ForwardPayload {
  sessionId: string;
  sourceId: string;
  skillTree: SkillTree | null;  // Single entry point, null if no skill was called
  totalUsage: ModelUsage;
  allEvents: HookEvent[];
  sessionDuration: number;
  stopReason?: string;
}
