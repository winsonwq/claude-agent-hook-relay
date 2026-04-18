import type { Request, Response } from 'express';
import type { HookEvent, ForwardPayload, ModelUsage, Forwarder } from './types.js';
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

    // Analyze transcript to get skill invocations (ONLY uses transcript, no hook data)
    let skillInvocations: Awaited<ReturnType<typeof TranscriptReader.analyzeSkillInvocations>> = [];
    if (event.transcriptPath) {
      try {
        const transcriptUsage = await TranscriptReader.getSessionUsage(event.transcriptPath);
        modelUsage.inputTokens = transcriptUsage.inputTokens || modelUsage.inputTokens;
        modelUsage.outputTokens = transcriptUsage.outputTokens || modelUsage.outputTokens;
        modelUsage.cacheReadTokens = transcriptUsage.cacheReadTokens || modelUsage.cacheReadTokens;
        modelUsage.cacheCreationTokens = transcriptUsage.cacheCreationTokens || modelUsage.cacheCreationTokens;

        skillInvocations = await TranscriptReader.analyzeSkillInvocations(event.transcriptPath);
      } catch {
        // Ignore transcript read errors
      }
    }

    const payload: ForwardPayload = {
      sessionId: session.sessionId,
      sourceId: session.sourceId,
      skillInvocations,
      totalUsage: modelUsage,
      allEvents: session.events,
      sessionDuration: Date.now() - session.createdAt,
      stopReason: typeof (body.reason ?? body.stopReason) === 'string'
        ? (body.reason ?? body.stopReason) as string
        : undefined,
    };

    await this.forwarder.forward(payload);
  }

  private async handleSessionEnd(
    session: ReturnType<SessionManager['getOrCreate']>,
    event: HookEvent,
    body: Record<string, unknown>
  ): Promise<void> {
    const body2 = body as Record<string, number | undefined | string>;

    // Analyze transcript to get skill invocations (ONLY uses transcript)
    let skillInvocations: Awaited<ReturnType<typeof TranscriptReader.analyzeSkillInvocations>> = [];
    if (event.transcriptPath) {
      try {
        skillInvocations = await TranscriptReader.analyzeSkillInvocations(event.transcriptPath);
      } catch {
        // Ignore transcript read errors
      }
    }

    const payload: ForwardPayload = {
      sessionId: session.sessionId,
      sourceId: session.sourceId,
      skillInvocations,
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
    this.sessionManager.clear(session.sessionId);
  }
}
