import chalk from 'chalk';
import type { ForwardPayload, Forwarder, CallNode, SkillCallNode, ToolCallNode, ModelUsage } from './types.js';

// chalk auto-detects terminal color support — no manual config needed

/**
 * Console Forwarder - real-time colored output to stdout
 *
 * Outputs events as they arrive (real-time mode), plus a formatted
 * summary at Stop/SessionEnd. All output goes to stdout/stderr.
 *
 * This forwarder is independent from OtelForwarder - they can run
 * concurrently without affecting each other.
 */
export class ConsoleForwarder implements Forwarder {
  // Track tool start times per session+toolUseId for duration calculation
  private pendingTools = new Map<string, number>();

  private toolKey(sessionId: string, toolUseId: string): string {
    return `${sessionId}:${toolUseId}`;
  }

  // ─── Public: called by HookCollector at Stop/SessionEnd ───────────────────────

  async forward(data: ForwardPayload): Promise<void> {
    // Print the final summary for this session
    this.printSummary(data);
  }

  // ─── Real-time event logging (called by collector before forward) ───────────

  logPreToolUse(params: { sessionId: string; toolUseId: string; toolName: string; skillName?: string }): void {
    const key = this.toolKey(params.sessionId, params.toolUseId);
    this.pendingTools.set(key, Date.now());

    const skillHint = params.skillName ? chalk.gray(` @ ${params.skillName}`) : '';
    process.stdout.write(
      chalk.gray(`[${this.ts()}] `) +
      chalk.cyan('→ ') +
      chalk.bold(params.toolName) +
      skillHint +
      '\n'
    );
  }

  logPostToolUse(params: { sessionId: string; toolUseId: string; toolName: string; skillName?: string }): void {
    const key = this.toolKey(params.sessionId, params.toolUseId);
    const startTime = this.pendingTools.get(key);
    const duration = startTime ? Date.now() - startTime : null;
    this.pendingTools.delete(key);

    const skillHint = params.skillName ? chalk.gray(` @ ${params.skillName}`) : '';
    const durHint = duration !== null ? chalk.gray(` ${duration}ms`) : '';

    process.stdout.write(
      chalk.gray(`[${this.ts()}] `) +
      chalk.green('✓ ') +
      chalk.bold(params.toolName) +
      skillHint +
      durHint +
      '\n'
    );
  }

  logToolFailure(params: { sessionId: string; toolUseId: string; toolName: string; error: string; skillName?: string }): void {
    const key = this.toolKey(params.sessionId, params.toolUseId);
    this.pendingTools.delete(key);

    const skillHint = params.skillName ? chalk.gray(` @ ${params.skillName}`) : '';
    process.stderr.write(
      chalk.gray(`[${this.ts()}] `) +
      chalk.red('✗ ') +
      chalk.bold(params.toolName) +
      skillHint +
      chalk.red(` — ${params.error}`) +
      '\n'
    );
  }

  // ─── Summary printer (called at Stop/SessionEnd) ───────────────────────────

  private printSummary(data: ForwardPayload): void {
    const divider = chalk.gray('─'.repeat(60));
    const lines: string[] = [];
    lines.push('');
    lines.push(divider);

    // Header with session info
    const sessionLabel = data.sessionId.length > 12
      ? data.sessionId.slice(0, 12) + '…'
      : data.sessionId;
    lines.push(
      chalk.bold.white('📋 Session ') + chalk.cyan(sessionLabel) +
      chalk.gray(' · ') + chalk.yellow(`${data.sessionDuration}ms`)
    );

    // Skill tree
    if (data.skillTree) {
      lines.push(this.formatSkillTree(data.skillTree));
    } else {
      lines.push(chalk.gray('  (no skill calls)'));
    }

    lines.push(divider);

    // Token usage
    if (data.totalUsage.inputTokens > 0 || data.totalUsage.outputTokens > 0) {
      const cacheInfo = data.totalUsage.cacheReadTokens > 0
        ? chalk.gray(` cache=${data.totalUsage.cacheReadTokens}`)
        : '';
      lines.push(
        chalk.bold('📊 Tokens  ') +
        chalk.green(`in=${data.totalUsage.inputTokens}`) +
        chalk.gray(', ') +
        chalk.blue(`out=${data.totalUsage.outputTokens}`) +
        cacheInfo
      );
    }

    // Stop reason
    if (data.stopReason) {
      lines.push(chalk.bold('📌 Reason  ') + chalk.white(data.stopReason));
    }

    // Failures
    if (data.failures && data.failures.length > 0) {
      lines.push(chalk.bold.red(`❌ Failures (${data.failures.length})`));
      for (const f of data.failures) {
        const loc = f.skillName ? chalk.red(` [${f.skillName}]`) : '';
        lines.push(chalk.red(`   ✗ ${f.toolName}${loc}: ${f.error}`));
      }
    }

    lines.push(divider);
    lines.push('');
    process.stdout.write(lines.join('\n') + '\n');
  }

  private formatSkillTree(tree: { skill: string; nestedCalls: CallNode[]; durationMs?: number; usage?: ModelUsage }): string {
    const lines: string[] = [];
    const dur = tree.durationMs ? chalk.gray(` ${tree.durationMs}ms`) : '';
    lines.push(chalk.bold.green('🤖 ') + chalk.bold.white(tree.skill) + dur);

    const fmtNode = (node: CallNode, indent: string, isLast: boolean): string[] => {
      const pipe = isLast ? '    ' : '│   ';
      const prefix = isLast ? '└── ' : '├── ';
      const childIndent = indent + pipe;
      const childPrefix = indent + prefix;
      const result: string[] = [];

      if (node.type === 'skill') {
        const sn = node as SkillCallNode;
        const nested = sn.nestedCalls.length > 0
          ? chalk.gray(` (${sn.nestedCalls.length} calls)`)
          : '';
        result.push(childPrefix + chalk.bold.green('🤖 ') + chalk.white(sn.name) + nested);
        sn.nestedCalls.forEach((child, i) => {
          result.push(...fmtNode(child, childIndent, i === sn.nestedCalls.length - 1));
        });
      } else {
        const tn = node as ToolCallNode;
        let detail = '';
        if (tn.command) detail = ` ${tn.command}`;
        else if (tn.file) detail = ` ${tn.file}`;
        else if (tn.url) detail = ` ${tn.url}`;
        else if (tn.pattern) detail = ` ${tn.pattern}`;
        else if (tn.query) detail = ` ${tn.query}`;

        // Truncate long detail strings
        if (detail.length > 40) detail = detail.slice(0, 40) + '…';

        const durMs = tn.durationMs ? chalk.gray(`+${tn.durationMs}ms`) : '';
        result.push(childPrefix + chalk.bold.cyan('🔧 ') + chalk.white(tn.name) + chalk.gray(detail) + durMs);
      }

      return result;
    };

    tree.nestedCalls.forEach((child, i) => {
      lines.push(...fmtNode(child, '  ', i === tree.nestedCalls.length - 1));
    });

    return lines.join('\n');
  }

  private ts(): string {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
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
