export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

export interface SkillInvocation {
  skill: string;
  startTime: number;
  endTime?: number;
  durationMs?: number;
  nestedCalls: string[];
  toolUseId?: string;
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
  createdAt: number;
  updatedAt: number;
}

// Forwarder interface
export interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
}

export interface ForwardPayload {
  sessionId: string;
  sourceId: string;
  skillInvocations: SkillInvocation[];
  totalUsage: ModelUsage;
  allEvents: HookEvent[];
  sessionDuration: number;
  stopReason?: string;
}
