import type { ForwardPayload, Forwarder, CallNode } from './types.js';

/**
 * Console Forwarder - outputs to stdout with friendly formatting
 */
export class ConsoleForwarder implements Forwarder {
  // Track which sessions we've already processed to avoid duplicate output
  private processedSessions = new Set<string>();

  async forward(data: ForwardPayload): Promise<void> {
    // Skip if we've already processed this session (avoid duplicate Stop/SessionEnd)
    if (this.processedSessions.has(data.sessionId)) {
      return;
    }
    this.processedSessions.add(data.sessionId);

    // Helper to format a call node recursively
    const formatCallNode = (node: CallNode, indent: string, isLast: boolean): string[] => {
      const prefix = isLast ? '└── ' : '├── ';
      const nextIndent = indent + (isLast ? '    ' : '│   ');
      const lines: string[] = [];

      if (node.type === 'skill') {
        lines.push(`${indent}${prefix}🤖 Skill: ${node.name}`);
        for (let i = 0; i < node.nestedCalls.length; i++) {
          const child = node.nestedCalls[i];
          lines.push(...formatCallNode(child, nextIndent, i === node.nestedCalls.length - 1));
        }
      } else {
        // Tool node
        let info = '';
        if (node.command) {
          info = `: ${node.command}`;
        } else if (node.file) {
          info = `: ${node.file}`;
        } else if (node.url) {
          info = `: ${node.url}`;
        } else if (node.pattern) {
          info = `: ${node.pattern}`;
        } else if (node.query) {
          info = `: ${node.query}`;
        } else if (node.content) {
          info = `: ${node.content.substring(0, 50)}...`;
        }
        lines.push(`${indent}${prefix}🔧 ${node.name}${info}`);
      }

      return lines;
    };

    // Build output
    const lines: string[] = [];
    lines.push('─'.repeat(60));

    if (data.skillTree) {
      const tree = data.skillTree;
      lines.push(`📋 ${tree.skill}`);
      for (let i = 0; i < tree.nestedCalls.length; i++) {
        const child = tree.nestedCalls[i];
        lines.push(...formatCallNode(child, '', i === tree.nestedCalls.length - 1));
      }
    } else {
      lines.push('📋 (无 Skill 调用)');
    }

    lines.push('─'.repeat(60));
    lines.push(`⏱️  耗时: ${data.sessionDuration}ms`);

    if (data.totalUsage.inputTokens > 0) {
      lines.push(`📊 Token: in=${data.totalUsage.inputTokens} out=${data.totalUsage.outputTokens} cache=${data.totalUsage.cacheReadTokens}`);
    } else {
      lines.push(`📊 Token: (未获取到)`);
    }

    if (data.stopReason) {
      lines.push(`📌 停止原因: ${data.stopReason}`);
    }

    process.stdout.write(`[Relay]\n${lines.join('\n')}\n\n`);
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
