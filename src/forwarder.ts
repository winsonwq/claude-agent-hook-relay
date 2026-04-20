import type { ForwardPayload, Forwarder, CallNode, SkillCallNode, ToolCallNode, ModelUsage } from './types.js';

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

    // Helper to format usage summary
    const fmtUsage = (u: { inputTokens: number; outputTokens: number; cacheReadTokens: number } | undefined): string => {
      if (!u || (u.inputTokens === 0 && u.outputTokens === 0 && u.cacheReadTokens === 0)) return '';
      return ` [in=${u.inputTokens} out=${u.outputTokens} cache=${u.cacheReadTokens}]`;
    };

    // Helper to format a call node recursively
    const formatCallNode = (node: CallNode, indent: string, isLast: boolean): string[] => {
      const prefix = isLast ? '└── ' : '├── ';
      const nextIndent = indent + (isLast ? '    ' : '│   ');
      const lines: string[] = [];

      if (node.type === 'skill') {
        const sn = node as SkillCallNode;
        lines.push(`${indent}${prefix}🤖 Skill: ${sn.name}${fmtUsage(sn.usage)}`);
        for (let i = 0; i < sn.nestedCalls.length; i++) {
          const child = sn.nestedCalls[i];
          lines.push(...formatCallNode(child, nextIndent, i === sn.nestedCalls.length - 1));
        }
      } else {
        const tn = node as ToolCallNode;
        let info = '';
        if (tn.command) {
          info = `: ${tn.command}`;
        } else if (tn.file) {
          info = `: ${tn.file}`;
        } else if (tn.url) {
          info = `: ${tn.url}`;
        } else if (tn.pattern) {
          info = `: ${tn.pattern}`;
        } else if (tn.query) {
          info = `: ${tn.query}`;
        } else if (tn.content) {
          info = `: ${tn.content.substring(0, 50)}...`;
        }
        lines.push(`${indent}${prefix}🔧 ${tn.name}${info}${fmtUsage(tn.usage)}`);
      }

      return lines;
    };

    // Build output
    const lines: string[] = [];
    lines.push('─'.repeat(60));

    if (data.skillTree) {
      const tree = data.skillTree;
      lines.push(`📋 ${tree.skill}${fmtUsage(tree.usage)}`);
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

    if (data.failures && data.failures.length > 0) {
      lines.push(`❌ 失败: ${data.failures.length} 个`);
      for (const f of data.failures) {
        const skillPart = f.skillName ? ` (${f.skillName} 内)` : '';
        lines.push(`   ❌ ${f.toolName}${skillPart}: ${f.error}`);
      }
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

/**
 * OTel Forwarder - converts SkillTree to OpenTelemetry-compatible format
 *
 * Converts the SkillTree into an array of SkillSpan objects that are
 * compatible with the OTel span model. Each Skill node becomes a span
 * with appropriate attributes for parent-child relationships.
 *
 * @see docs/otel-integration.md
 */
export class OtelForwarder implements Forwarder {
  constructor(
    private url: string,
    private headers: Record<string, string> = {},
    private serviceName: string = 'claude-code'
  ) {}

  async forward(data: ForwardPayload): Promise<void> {
    if (!data.skillTree) {
      return; // No skill to export
    }

    const spans = this.buildSpans(data);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(spans),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        process.stderr.write(`[OtelForwarder] HTTP ${response.status}: ${response.statusText}\n`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[OtelForwarder] Failed to forward: ${msg}\n`);
    }
  }

  /**
   * Convert SkillTree to OTLP format (resourceSpans > scopeSpans > spans)
   */
  private buildSpans(data: ForwardPayload): OtlpPayload {
    const spans: OtelSpan[] = [];
    const tree = data.skillTree!;

    // SkillTree has 'skill' property, SkillCallNode has 'name' property
    const rootNode = {
      name: tree.skill,
      toolUseId: tree.toolUseId,
      nestedCalls: tree.nestedCalls,
      durationMs: tree.durationMs,
      usage: tree.usage,
    };

    // Process the tree recursively
    this.processNode(rootNode, undefined, 0, data, spans);

    // Add session-level total usage as a separate span
    if (data.totalUsage) {
      spans.push(this.buildTotalUsageSpan(data));
    }

    // Wrap in standard OTLP format
    return {
      resourceSpans: [{
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: this.serviceName } },
            { key: 'user.id', value: { stringValue: data.sourceId || 'unknown' } },
          ],
        },
        scopeSpans: [{
          scope: {
            name: this.serviceName,
            version: '0.1.20',
          },
          spans: spans,
        }],
      }],
    };
  }

  private processNode(
    node: { name: string; toolUseId: string; nestedCalls: CallNode[]; durationMs?: number; usage?: ModelUsage },
    parentInvocationId: string | undefined,
    depth: number,
    data: ForwardPayload,
    spans: OtelSpan[]
  ): void {
    const invocationId = node.toolUseId || `auto-${spans.length}`;
    const startTime = Date.now();
    const duration = node.durationMs || data.sessionDuration;

    // Collect direct tool names and child skill names
    const nestedTools: string[] = [];
    const childSkills: string[] = [];

    for (const child of node.nestedCalls) {
      if (child.type === 'skill') {
        childSkills.push(child.name);
        this.processNode(child, invocationId, depth + 1, data, spans);
      } else {
        nestedTools.push(child.name);
      }
    }

    const childToolCalls = this.countChildToolCalls(node.nestedCalls);
    const totalToolCalls = nestedTools.length + childToolCalls;

    // Convert attributes to OTel key-value pairs
    const attributes: OtelKeyValue[] = [
      { key: 'span.type', value: { stringValue: 'skill' } },
      { key: 'user.id', value: { stringValue: data.sourceId || '' } },
      { key: 'session.id', value: { stringValue: data.sessionId || '' } },
      { key: 'skill.name', value: { stringValue: node.name } },
      { key: 'skill.invocation_id', value: { stringValue: invocationId } },
      { key: 'skill.depth', value: { intValue: depth } },
      { key: 'skill.nested_tools', value: { arrayValue: { values: nestedTools.map(t => ({ stringValue: t })) } } },
      { key: 'skill.child_skills', value: { arrayValue: { values: childSkills.map(s => ({ stringValue: s })) } } },
      { key: 'skill.duration_ms', value: { intValue: duration } },
      { key: 'skill.total_tool_calls', value: { intValue: totalToolCalls } },
      { key: 'skill.input_tokens', value: { intValue: node.usage?.inputTokens ?? 0 } },
      { key: 'skill.output_tokens', value: { intValue: node.usage?.outputTokens ?? 0 } },
      { key: 'skill.cache_read_tokens', value: { intValue: node.usage?.cacheReadTokens ?? 0 } },
    ];

    if (parentInvocationId) {
      attributes.push({ key: 'skill.parent_invocation_id', value: { stringValue: parentInvocationId } });
    }

    const span: OtelSpan = {
      traceId: this.generateTraceId(data.sessionId),
      spanId: this.generateSpanId(),
      parentSpanId: parentInvocationId ? this.generateSpanIdFromId(parentInvocationId) : undefined,
      name: 'claude_code.skill',
      kind: 1, // SpanKind.INTERNAL
      startTimeUnixNano: String(BigInt(startTime) * 1000000n),
      endTimeUnixNano: String(BigInt(startTime + duration) * 1000000n),
      attributes,
    };

    spans.push(span);
  }

  private buildTotalUsageSpan(data: ForwardPayload): OtelSpan {
    const u = data.totalUsage;
    const startTime = Date.now();
    const attributes: OtelKeyValue[] = [
      { key: 'span.type', value: { stringValue: 'session_summary' } },
      { key: 'user.id', value: { stringValue: data.sourceId || '' } },
      { key: 'session.id', value: { stringValue: data.sessionId || '' } },
      { key: 'session.duration_ms', value: { intValue: data.sessionDuration } },
      { key: 'session.stop_reason', value: { stringValue: data.stopReason ?? '' } },
      { key: 'session.input_tokens', value: { intValue: u.inputTokens } },
      { key: 'session.output_tokens', value: { intValue: u.outputTokens } },
      { key: 'session.cache_read_tokens', value: { intValue: u.cacheReadTokens } },
      { key: 'session.cache_creation_tokens', value: { intValue: u.cacheCreationTokens } },
      { key: 'session.total_cost_usd', value: { doubleValue: u.costUsd } },
    ];

    return {
      traceId: this.generateTraceId(data.sessionId),
      spanId: this.generateSpanId(),
      name: 'claude_code.session_summary',
      kind: 1,
      startTimeUnixNano: String(BigInt(startTime) * 1000000n),
      endTimeUnixNano: String(BigInt(startTime + data.sessionDuration) * 1000000n),
      attributes,
    };
  }

  private countChildToolCalls(nestedCalls: CallNode[]): number {
    let count = 0;
    for (const child of nestedCalls) {
      if (child.type === 'skill') {
        count += this.countChildToolCalls(child.nestedCalls);
      } else {
        count += 1;
      }
    }
    return count;
  }

  private generateTraceId(sessionId?: string): string {
    // Generate a 32-char hex traceId (16 bytes)
    const base = sessionId || Date.now().toString(36) + Math.random().toString(36).slice(2);
    let hash = 0;
    for (let i = 0; i < base.length; i++) {
      hash = ((hash << 5) - hash + base.charCodeAt(i)) | 0;
    }
    const h1 = Math.abs(hash).toString(16).padStart(8, '0');
    const h2 = Math.abs(~hash >>> 0).toString(16).padStart(8, '0');
    return (h1 + h2 + h1 + h2).slice(0, 32).padEnd(32, '0');
  }

  private generateSpanId(): string {
    // Generate a 16-char hex spanId (8 bytes)
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private generateSpanIdFromId(invocationId: string): string {
    // Derive a deterministic spanId from invocationId
    let hash = 0;
    for (let i = 0; i < invocationId.length; i++) {
      hash = ((hash << 5) - hash + invocationId.charCodeAt(i)) | 0;
    }
    return Math.abs(hash >>> 0).toString(16).padStart(16, '0');
  }
}

/**
 * OTel-compatible span structure
 * @see docs/otel-integration.md#最终格式设计
 */
interface OtelSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name: string;
  kind: number;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  attributes: OtelKeyValue[];
}

interface OtelKeyValue {
  key: string;
  value: OtelAnyValue;
}

interface OtelAnyValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  arrayValue?: { values: OtelAnyValue[] };
}

interface OtlpPayload {
  resourceSpans: [{
    resource: {
      attributes: OtelKeyValue[];
    };
    scopeSpans: [{
      scope: { name: string; version?: string };
      spans: OtelSpan[];
    }];
  }];
}
