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
    private headers: Record<string, string> = {}
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
   * Convert SkillTree to OTel-compatible spans
   */
  private buildSpans(data: ForwardPayload) {
    const spans: OtelSpan[] = [];
    const tree = data.skillTree!;

    // Build a map of invocation_id -> span for linking
    const spanMap = new Map<string, OtelSpan>();

    // SkillTree has 'skill' property, SkillCallNode has 'name' property
    // Normalize to { name, toolUseId, nestedCalls, durationMs, usage }
    const rootNode = {
      name: tree.skill,
      toolUseId: tree.toolUseId,
      nestedCalls: tree.nestedCalls,
      durationMs: tree.durationMs,
      usage: tree.usage,
    };

    // Process the tree recursively
    this.processNode(rootNode, undefined, 0, data, spans, spanMap);

    // Add session-level total usage as a separate span
    if (data.totalUsage) {
      spans.push(this.buildTotalUsageSpan(data));
    }

    return spans;
  }

  private processNode(
    node: { name: string; toolUseId: string; nestedCalls: CallNode[]; durationMs?: number; usage?: ModelUsage },
    parentInvocationId: string | undefined,
    depth: number,
    data: ForwardPayload,
    spans: OtelSpan[],
    spanMap: Map<string, OtelSpan>
  ): void {
    const invocationId = node.toolUseId || `auto-${spans.length}`;

    // Collect direct tool names and child skill names
    const nestedTools: string[] = [];
    const childSkills: string[] = [];

    for (const child of node.nestedCalls) {
      if (child.type === 'skill') {
        childSkills.push(child.name);
        // Recursively process child skill
        this.processNode(child, invocationId, depth + 1, data, spans, spanMap);
      } else {
        nestedTools.push(child.name);
      }
    }

    // Calculate total tool calls (direct tools + child skill tool calls)
    const childToolCalls = this.countChildToolCalls(node.nestedCalls);
    const totalToolCalls = nestedTools.length + childToolCalls;

    // Create the span for this skill
    const span: OtelSpan = {
      name: 'claude_code.skill',
      attributes: {
        // OTel standard
        'span.type': 'skill',
        'user.id': data.sourceId,
        'session.id': data.sessionId,

        // Skill-specific
        'skill.name': node.name,
        'skill.invocation_id': invocationId,
        'skill.parent_invocation_id': parentInvocationId,
        'skill.depth': depth,
        'skill.nested_tools': nestedTools,
        'skill.child_skills': childSkills,
        'skill.duration_ms': node.durationMs || data.sessionDuration,
        'skill.total_tool_calls': totalToolCalls,

        // Token usage for this skill (from transcript)
        'skill.input_tokens': node.usage?.inputTokens ?? 0,
        'skill.output_tokens': node.usage?.outputTokens ?? 0,
        'skill.cache_read_tokens': node.usage?.cacheReadTokens ?? 0,
        'skill.cache_creation_tokens': node.usage?.cacheCreationTokens ?? 0,
      },
    };

    spans.push(span);
    spanMap.set(invocationId, span);
  }

  private buildTotalUsageSpan(data: ForwardPayload): OtelSpan {
    const u = data.totalUsage;
    return {
      name: 'claude_code.session_summary',
      attributes: {
        'span.type': 'session_summary',
        'user.id': data.sourceId,
        'session.id': data.sessionId,
        'session.duration_ms': data.sessionDuration,
        'session.stop_reason': data.stopReason ?? '',
        // Total token usage for the entire session
        'session.input_tokens': u.inputTokens,
        'session.output_tokens': u.outputTokens,
        'session.cache_read_tokens': u.cacheReadTokens,
        'session.cache_creation_tokens': u.cacheCreationTokens,
        'session.total_cost_usd': u.costUsd,
      },
    };
  }

  private countChildToolCalls(nestedCalls: CallNode[]): number {
    let count = 0;
    for (const child of nestedCalls) {
      if (child.type === 'skill') {
        // Child skill's tools + its children's tools
        count += this.countChildToolCalls(child.nestedCalls);
      } else {
        count += 1;
      }
    }
    return count;
  }
}

/**
 * OTel-compatible span structure
 * @see docs/otel-integration.md#最终格式设计
 */
interface OtelSpan {
  name: string;
  attributes: {
    'span.type': 'skill' | 'session_summary';
    'user.id': string;
    'session.id': string;

    // Skill span fields (when span.type === 'skill')
    'skill.name'?: string;
    'skill.invocation_id'?: string;
    'skill.parent_invocation_id'?: string;
    'skill.depth'?: number;
    'skill.nested_tools'?: string[];
    'skill.child_skills'?: string[];
    'skill.duration_ms'?: number;
    'skill.total_tool_calls'?: number;
    'skill.input_tokens'?: number;
    'skill.output_tokens'?: number;
    'skill.cache_read_tokens'?: number;
    'skill.cache_creation_tokens'?: number;

    // Session summary fields (when span.type === 'session_summary')
    'session.duration_ms'?: number;
    'session.stop_reason'?: string;
    'session.input_tokens'?: number;
    'session.output_tokens'?: number;
    'session.cache_read_tokens'?: number;
    'session.cache_creation_tokens'?: number;
    'session.total_cost_usd'?: number;
  };
}
