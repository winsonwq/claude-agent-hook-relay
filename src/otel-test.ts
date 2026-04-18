/**
 * OTel 测试 - 发送到 Jaeger（修复版）
 */

import { trace, context } from '@opentelemetry/api'
import { NodeTracerProvider, ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SEMRESATTRS_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

async function testSkillTree() {
  console.log('=== OTel → Jaeger 测试 ===\n')

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318'
  console.log('OTLP Endpoint:', endpoint)

  const resource = resourceFromAttributes({
    [SEMRESATTRS_SERVICE_NAME]: 'relay-otel-test',
  })

  const provider = new NodeTracerProvider({ resource })

  // 使用 hack 方法添加 exporter
  const otlpExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  })
  const consoleExporter = new ConsoleSpanExporter()
  
  // 通过内部方法添加 processor
  ;(provider as any)._activeSpanProcessor = new SimpleSpanProcessor(otlpExporter)

  provider.register()

  const tracer = trace.getTracer('relay-otel-test')

  console.log('\n创建 Skill 树形...')

  const skill1Span = tracer.startSpan('claude_code.skill', {
    attributes: {
      'span.type': 'skill',
      'skill.name': 'batch',
      'skill.invocation_id': 'skill1-uuid',
      'skill.depth': 0,
    },
  })

  const ctx = trace.setSpan(context.active(), skill1Span)

  await context.with(ctx, async () => {
    const tool1 = tracer.startSpan('claude_code.tool', {
      attributes: { 'span.type': 'tool', 'tool_name': 'Bash' },
    })
    await new Promise(r => setTimeout(r, 100))
    tool1.end()
    console.log('  Tool: Bash')

    const tool2 = tracer.startSpan('claude_code.tool', {
      attributes: { 'span.type': 'tool', 'tool_name': 'Edit' },
    })
    await new Promise(r => setTimeout(r, 50))
    tool2.end()
    console.log('  Tool: Edit')

    const skill2Span = tracer.startSpan('claude_code.skill', {
      attributes: {
        'span.type': 'skill',
        'skill.name': 'skill2',
        'skill.parent_invocation_id': 'skill1-uuid',
        'skill.depth': 1,
      },
    })

    const ctx2 = trace.setSpan(context.active(), skill2Span)

    await context.with(ctx2, async () => {
      const tool3 = tracer.startSpan('claude_code.tool', {
        attributes: { 'span.type': 'tool', 'tool_name': 'Bash' },
      })
      await new Promise(r => setTimeout(r, 80))
      tool3.end()
      console.log('    Skill2 Tool: Bash')
    })

    skill2Span.end()
    console.log('  Skill: skill2 结束')
  })

  skill1Span.end()
  console.log('Skill: batch 结束')

  console.log('\n等待导出...')
  await new Promise(r => setTimeout(r, 2000))

  console.log('\n=== 完成 ===')
  console.log('\n打开 http://localhost:16686 查看 traces')
  console.log('搜索 "relay-otel-test" 查看 Skill 树形')
}

testSkillTree().catch(console.error)
