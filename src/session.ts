import type { Session, HookEvent } from './types.js';

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
