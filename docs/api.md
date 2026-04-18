# API 文档

## 概述

claude-agent-hook-relay 提供 HTTP 端点接收 Claude Code Hook 事件。

所有端点：
- Base URL: `http://localhost:8080`
- Content-Type: `application/json`
- Method: `POST`

## 端点列表

| 事件 | 端点 | 说明 |
|------|------|------|
| PreToolUse | POST /hook/pre-tool-use | 工具执行前 |
| PostToolUse | POST /hook/post-tool-use | 工具执行后 |
| PostToolUseFailure | POST /hook/post-tool-use-failure | 工具执行失败 |
| PermissionRequest | POST /hook/permission-request | 请求权限 |
| PermissionDenied | POST /hook/permission-denied | 权限被拒绝 |
| UserPromptSubmit | POST /hook/user-prompt-submit | 用户提交 Prompt |
| Stop | POST /hook/stop | 对话停止 |
| StopFailure | POST /hook/stop-failure | 停止失败 |
| SessionStart | POST /hook/session-start | 会话启动 |
| SessionEnd | POST /hook/session-end | 会话结束 |
| SubagentStart | POST /hook/subagent-start | 子代理启动 |
| SubagentStop | POST /hook/subagent-stop | 子代理停止 |
| TaskCreated | POST /hook/task-created | 任务创建 |
| TaskCompleted | POST /hook/task-completed | 任务完成 |
| PreCompact | POST /hook/pre-compact | 记忆压缩前 |
| PostCompact | POST /hook/post-compact | 记忆压缩后 |
| Notification | POST /hook/notification | 通知 |
| TeammateIdle | POST /hook/teammate-idle | 队友空闲 |
| InstructionsLoaded | POST /hook/instructions-loaded | 指令加载 |
| ConfigChange | POST /hook/config-change | 配置变更 |
| CwdChanged | POST /hook/cwd-changed | 目录变更 |
| FileChanged | POST /hook/file-changed | 文件变更 |
| WorktreeCreate | POST /hook/worktree-create | 创建 Worktree |
| WorktreeRemove | POST /hook/worktree-remove | 删除 Worktree |
| Elicitation | POST /hook/elicitation | MCP 征询 |
| ElicitationResult | POST /hook/elicitation-result | MCP 征询结果 |

## 请求头

### 必须

| Header | 说明 |
|--------|------|
| Content-Type | application/json |

### 可选

| Header | 说明 |
|--------|------|
| X-Source-ID | 终端标识，用于区分不同 Claude Code 实例 |

## 请求体

Claude Code 发送的请求体是标准的 Hook 事件 JSON。

### PreToolUse 请求体

```json
{
  "tool_name": "Bash",
  "tool_use_id": "015c5b12-4cf0-4f89-a2e0-f31c2d3c1e2d",
  "tool_input": {
    "command": "ls -la"
  },
  "query_depth": 0,
  "session_id": "abc-123-def",
  "transcript_path": "/home/user/.claude/projects/project/abc-123-def.jsonl",
  "timestamp": 1713345600000
}
```

### PostToolUse 请求体

```json
{
  "tool_name": "Bash",
  "tool_use_id": "015c5b12-4cf0-4f89-a2e0-f31c2d3c1e2d",
  "tool_response": {
    "type": "completed",
    "output": "..."
  },
  "session_id": "abc-123-def",
  "transcript_path": "/home/user/.claude/projects/project/abc-123-def.jsonl",
  "timestamp": 1713345610000
}
```

### Stop 请求体

```json
{
  "session_id": "abc-123-def",
  "total_cost_usd": 0.05,
  "usage": {
    "input_tokens": 5000,
    "output_tokens": 300,
    "cache_read_input_tokens": 20000,
    "cache_creation_input_tokens": 1000
  },
  "reason": "end_turn",
  "transcript_path": "/home/user/.claude/projects/project/abc-123-def.jsonl",
  "timestamp": 1713345700000
}
```

### SessionEnd 请求体

```json
{
  "session_id": "abc-123-def",
  "exit_reason": "clear",
  "total_cost_usd": 0.12,
  "timestamp": 1713345800000
}
```

## 响应

### 成功响应

```http
HTTP/1.1 200 OK
Content-Type: application/json

{}
```

服务端无需返回特定内容，收到 2xx 即表示成功。

### 错误处理

服务端内部错误不会影响 Claude Code 执行，只会在日志中体现。

## 完整转发数据结构

当 Stop 或 SessionEnd 事件触发时，转发器收到的完整数据：

```typescript
interface ForwardPayload {
  sessionId: string;           // 会话 ID
  sourceId: string;            // X-Source-ID Header
  skillInvocations: {
    skill: string;             // Skill 名称
    startTime: number;         // 开始时间戳
    endTime?: number;          // 结束时间戳
    durationMs?: number;       // 持续时间 (ms)
    nestedCalls: string[];    // 嵌套调用的工具名
    toolUseId?: string;        // 工具调用 ID
  }[];
  totalUsage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
  };
  allEvents: {
    type: string;              // 事件类型
    toolName?: string;         // 工具名
    toolUseId?: string;        // 工具调用 ID
    toolInput?: any;           // 工具输入
    toolResponse?: any;        // 工具响应
    queryDepth?: number;       // 嵌套深度
    sessionId: string;
    timestamp: number;
    transcriptPath?: string;
  }[];
  sessionDuration: number;    // 会话时长 (ms)
  stopReason?: string;        // 停止原因
}
```

## 使用示例

### 本地测试

```bash
# 启动服务
npm run dev

# 测试 PreToolUse 端点
curl -X POST http://localhost:8080/hook/pre-tool-use \
  -H "Content-Type: application/json" \
  -H "X-Source-ID: test-terminal" \
  -d '{
    "tool_name": "Bash",
    "tool_use_id": "test-id",
    "tool_input": {"command": "echo hello"},
    "query_depth": 0,
    "session_id": "test-session",
    "timestamp": 1713345600000
  }'
```

### Claude Code 配置

在 `~/.claude/settings.json` 中配置：

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/pre-tool-use",
        "headers": {
          "X-Source-ID": "my-workstation"
        }
      }]
    }],
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/post-tool-use",
        "headers": {
          "X-Source-ID": "my-workstation"
        }
      }]
    }],
    "Stop": [{
      "matcher": "*",
      "hooks": [{
        "type": "http",
        "url": "http://localhost:8080/hook/stop",
        "headers": {
          "X-Source-ID": "my-workstation"
        }
      }]
    }]
  }
}
```
