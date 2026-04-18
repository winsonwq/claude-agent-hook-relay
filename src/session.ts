import type { Session, SkillInvocation, HookEvent } from './types.js';

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
      skill.endTime = timestamp;
      skill.durationMs = skill.endTime - skill.startTime;
      session.completedSkills.push(skill);
    }
    return skill;
  }

  pushNestedCall(sessionId: string, toolName: string): void {
    const session = this.sessions.get(sessionId);
    const currentSkill = session?.skillStack[session.skillStack.length - 1];
    if (!currentSkill) return;
    currentSkill.nestedCalls.push(toolName);
  }

  addEvent(sessionId: string, event: HookEvent): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.events.push(event);
  }

  getAll(): Session[] {
    return Array.from(this.sessions.values());
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
