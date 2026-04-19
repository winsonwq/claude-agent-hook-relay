import type { Session, SkillInvocation, HookEvent, CallNode, ToolCallNode, SkillTree } from './types.js';

export class SessionManager {
  private sessions = new Map<string, Session>();

  getOrCreate(sessionId: string, sourceId: string): Session {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        sessionId,
        sourceId,
        skillStack: [],
        completedSkills: [],
        events: [],
        skillTree: null,
        transcriptPath: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(sessionId, session);
    }
    session.updatedAt = Date.now();
    return session;
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  pushSkill(sessionId: string, skill: string, toolUseId: string, timestamp: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const invocation: SkillInvocation = {
      skill,
      startTime: timestamp,
      nestedCalls: [],
      toolUseId,
    };
    session.skillStack.push(invocation);
  }

  popSkill(sessionId: string, timestamp: number): SkillInvocation | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    const skill = session.skillStack.pop();
    if (skill) {
      // Don't overwrite if already set (deferred-pop case)
      if (!skill.isDone) {
        skill.endTime = timestamp;
        skill.durationMs = skill.endTime - skill.startTime;
      }
      session.completedSkills.push(skill);
    }
    return skill;
  }

  pushNestedCall(sessionId: string, toolName: string, toolUseId?: string, toolInput?: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    const currentSkill = session?.skillStack[session.skillStack.length - 1];
    if (!currentSkill) return;

    const node: ToolCallNode = {
      type: 'tool',
      name: toolName,
      toolUseId,
    };

    // Add tool-specific info
    if (toolInput) {
      if (toolName === 'Bash' && typeof toolInput.command === 'string') {
        node.command = toolInput.command;
      } else if (toolName === 'Read' && typeof toolInput.file_path === 'string') {
        node.file = toolInput.file_path;
      } else if (toolName === 'Glob') {
        node.pattern = typeof toolInput.pattern === 'string' ? toolInput.pattern : undefined;
      }
    }

    currentSkill.nestedCalls.push(node);
  }

  addEvent(sessionId: string, event: HookEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.events.push(event);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  setSkillTree(sessionId: string, skillTree: SkillTree | null, transcriptPath: string | null): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.skillTree = skillTree;
      session.transcriptPath = transcriptPath;
    }
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
