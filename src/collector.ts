import type { Request, Response } from 'express';
import type { HookEvent, ForwardPayload, ModelUsage, Forwarder, SkillTree } from './types.js';
import { SessionManager } from './session.js';
import { TranscriptReader } from './transcript.js';

export class HookCollector {
  constructor(
    private sessionManager: SessionManager,
    private forwarder: Forwarder
  ) {}

  collect(eventType: string) {
    return async (req: Request, res: Response): Promise<void> => {
      const sourceId = (req.headers['x-source-id'] as string) || 'unknown';
      const body = req.body as Record<string, unknown>;

      const sessionId = typeof body.session_id === 'string' ? body.session_id
        : typeof body.sessionId === 'string' ? body.sessionId
        : undefined;
      const timestamp = typeof body.timestamp === 'number' ? body.timestamp
        : Date.now();
      const transcriptPath = typeof body.transcript_path === 'string' ? body.transcript_path
        : typeof body.transcriptPath === 'string' ? body.transcriptPath
        : undefined;

      if (!sessionId) {
        res.status(200).json({});
        return;
      }

      const session = this.sessionManager.getOrCreate(sessionId, sourceId);

      const event: HookEvent = {
        type: eventType,
        toolName: typeof body.tool_name === 'string' ? body.tool_name
          : typeof body.toolName === 'string' ? body.toolName
          : undefined,
        toolUseId: typeof body.tool_use_id === 'string' ? body.tool_use_id
          : typeof body.toolUseId === 'string' ? body.toolUseId
          : undefined,
        toolInput: body.tool_input ?? body.toolInput,
        toolResponse: body.tool_response ?? body.toolResponse,
        queryDepth: typeof body.query_depth === 'number' ? body.query_depth
          : typeof body.queryDepth === 'number' ? body.queryDepth
          : undefined,
        sessionId,
        timestamp,
        transcriptPath,
      };

      switch (eventType) {
        case 'PreToolUse':
          this.handlePreToolUse(session, event);
          break;
        case 'PostToolUse':
          this.handlePostToolUse(session, event);
          break;
        case 'Stop':
          await this.handleStop(session, event, body);
          break;
        case 'SessionEnd':
          await this.handleSessionEnd(session, event, body);
          break;
      }

      this.sessionManager.addEvent(sessionId, event);

      res.status(200).json({});
    };
  }

  private handlePreToolUse(session: ReturnType<SessionManager['getOrCreate']>, event: HookEvent): void {
    // NOTE: Real-time nested call tracking doesn't work reliably because
    // PostToolUse(Skill) fires before the skill's nested tools run.
    // We rely on transcript analysis in handleStop instead.
    // Real-time tracking is only used to record skill invocations.

    const toolInput = event.toolInput as Record<string, unknown> | undefined;
    const skillName = typeof toolInput?.skill === 'string' ? toolInput.skill
      : typeof toolInput?.name === 'string' ? toolInput.name
      : undefined;

    if (event.toolName === 'Skill' && skillName) {
      this.sessionManager.pushSkill(
        session.sessionId,
        skillName,
        event.toolUseId || '',
        event.timestamp
      );
    }
  }

  private handlePostToolUse(session: ReturnType<SessionManager['getOrCreate']>, event: HookEvent): void {
    if (event.toolName === 'Skill') {
      // Pop the skill when it completes
      this.sessionManager.popSkill(session.sessionId, event.timestamp);
    }
  }

  private async handleStop(
    session: ReturnType<SessionManager['getOrCreate']>,
    event: HookEvent,
    body: Record<string, unknown>
  ): Promise<void> {
    const usage = body.usage as Record<string, number | undefined> | undefined;
    const usage2 = body as Record<string, number | undefined>;

    const usageData = usage ?? usage2;
    const costField = body.total_cost_usd ?? body.totalCostUsd;

    const modelUsage: ModelUsage = {
      inputTokens: usageData?.input_tokens ?? 0,
      outputTokens: usageData?.output_tokens ?? 0,
      cacheReadTokens: usageData?.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usageData?.cache_creation_input_tokens ?? 0,
      costUsd: typeof costField === 'number' ? costField : 0,
    };

    // Enrich with transcript-based token usage and nested calls if available
    let skillTree: SkillTree | null = null;
    if (event.transcriptPath) {
      try {
        const transcriptUsage = await TranscriptReader.getSessionUsage(event.transcriptPath);
        modelUsage.inputTokens = transcriptUsage.inputTokens || modelUsage.inputTokens;
        modelUsage.outputTokens = transcriptUsage.outputTokens || modelUsage.outputTokens;
        modelUsage.cacheReadTokens = transcriptUsage.cacheReadTokens || modelUsage.cacheReadTokens;
        modelUsage.cacheCreationTokens = transcriptUsage.cacheCreationTokens || modelUsage.cacheCreationTokens;

        // Build unified skill tree from transcript
        skillTree = await TranscriptReader.analyzeNestedCalls(event.transcriptPath);
      } catch {
        // Ignore transcript read errors
      }
    }

    const payload: ForwardPayload = {
      sessionId: session.sessionId,
      sourceId: session.sourceId,
      skillTree,
      totalUsage: modelUsage,
      allEvents: session.events,
      sessionDuration: Date.now() - session.createdAt,
      stopReason: typeof (body.reason ?? body.stopReason) === 'string'
        ? (body.reason ?? body.stopReason) as string
        : undefined,
    };

    // Store skillTree in session for API access
    this.sessionManager.setSkillTree(session.sessionId, skillTree, event.transcriptPath ?? null);

    await this.forwarder.forward(payload);
  }

  private async handleSessionEnd(
    session: ReturnType< SessionManager['getOrCreate']>,
    event: HookEvent,
    body: Record<string, unknown>
  ): Promise<void> {
    const body2 = body as Record<string, number | undefined | string>;

    // Complete any skills still on the stack
    const now = Date.now();
    while (session.skillStack.length > 0) {
      const skill = session.skillStack.pop();
      if (skill) {
        skill.endTime = now;
        skill.durationMs = skill.endTime - skill.startTime;
        session.completedSkills.push(skill);
      }
    }

    const payload: ForwardPayload = {
      sessionId: session.sessionId,
      sourceId: session.sourceId,
      skillTree: null,  // SessionEnd doesn't have transcript, no tree available
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: typeof body2.total_cost_usd === 'number' ? body2.total_cost_usd : 0,
      },
      allEvents: session.events,
      sessionDuration: Date.now() - session.createdAt,
      stopReason: typeof (body2.reason ?? body2.exit_reason) === 'string'
        ? (body2.reason ?? body2.exit_reason) as string
        : undefined,
    };

    await this.forwarder.forward(payload);
    // Don't clear session immediately - we want to keep it for API access
    // The session will persist until the relay is restarted
    // this.sessionManager.clear(session.sessionId);
  }
}
