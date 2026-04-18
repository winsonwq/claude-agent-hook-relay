import type { ForwardPayload, Forwarder } from './types.js';

/**
 * Console Forwarder - outputs to stdout
 */
export class ConsoleForwarder implements Forwarder {
  async forward(data: ForwardPayload): Promise<void> {
    const summary = {
      sessionId: data.sessionId,
      sourceId: data.sourceId,
      skillCount: data.skillInvocations.length,
      totalUsage: data.totalUsage,
      durationMs: data.sessionDuration,
      stopReason: data.stopReason,
      skillList: data.skillInvocations.map((s) => ({
        skill: s.skill,
        durationMs: s.durationMs,
        nestedCalls: s.nestedCalls,
      })),
    };
    // Use process.stdout.write to avoid eslint no-console warning in prod
    process.stdout.write(`[Relay] ${JSON.stringify(summary)}\n`);
  }
}

/**
 * HTTP Forwarder - POSTs to external HTTP server
 */
export class HttpForwarder implements Forwarder {
  constructor(
    private url: string,
    private headers: Record<string, string> = {}
  ) {}

  async forward(data: ForwardPayload): Promise<void> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        process.stderr.write(`[HttpForwarder] HTTP ${response.status}: ${response.statusText}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[HttpForwarder] Failed to forward: ${msg}\n`);
    }
  }
}

/**
 * Composite Forwarder - fans out to multiple targets
 */
export class CompositeForwarder implements Forwarder {
  constructor(private forwarders: Forwarder[]) {}

  async forward(data: ForwardPayload): Promise<void> {
    await Promise.allSettled(this.forwarders.map((f) => f.forward(data)));
  }
}
