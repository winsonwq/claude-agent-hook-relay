# Claude Agent Hook Relay - 测试结果

## 测试时间
- 2026-04-18：初始测试，验证嵌套 Skill 追踪算法
- 2026-04-19：重构为单一入口树形结构，优化输出格式

## 测试场景矩阵

| # | 场景 | 描述 | 期望 | 实际 | 状态 |
|---|------|------|------|------|------|
| 1 | 单层 Skill | 直接调用一个 skill | skillTree 包含 skill 和其工具调用 | ✅ 正确 | ✅ PASS |
| 2 | 两层嵌套 | nested-test-skill → weather-checker | 树形展示嵌套关系 | ✅ 正确 | ✅ PASS |
| 3 | 三层嵌套 | level-3-skill → level-2-skill → level-1-skill | 完整的三层树形结构 | ✅ 正确 | ✅ PASS |
| 4 | 连续调用同名 Skill | A → B → A（顺序调用两次 B） | 两个 B 都正确归因到各自的父 Skill | ✅ 正确 | ✅ PASS |

## 输出格式

### 单层 Skill
```
📋 weather-checker
└── 🔧 Bash: echo 'Weather check: ' && date
```

### 两层嵌套
```
📋 nested-test-skill
├── 🤖 Skill: weather-checker
│   └── 🔧 Bash: echo 'Weather check: ' && date
├── 🔧 Bash: date
└── 🔧 Read: example.txt
```

### 三层嵌套
```
📋 level-3-skill
├── 🤖 Skill: level-2-skill
│   ├── 🤖 Skill: level-1-skill
│   │   └── 🔧 Bash: date
│   └── 🔧 Bash: echo "level2-step2"
└── 🔧 Bash: echo "level3-step3"
```

### 连续调用同名 Skill
```
📋 sequential-skill
├── 🤖 Skill: weather-checker
│   └── 🔧 Bash: echo 'Weather check: ' && date
├── 🔧 Bash: echo "after-first-weather"
└── 🤖 Skill: weather-checker
    └── 🔧 Bash: echo 'Weather check: ' && date
```

## 实现说明

### 架构

1. **实时 Hook 收集**：通过 Hook 事件获取 Skill 调用和工具调用
2. **Transcript 分析**：在 Stop 事件时读取 transcript 文件，利用完整的上下文重建调用链
3. **树形结构**：单一入口（最外层 Skill）+ 递归嵌套（Skill/Tool 节点）

### 数据结构

```typescript
interface SkillTree {
  skill: string;           // 入口 Skill 名称
  toolUseId: string;       // 入口 Skill 的 tool_use_id
  startTime: number;
  nestedCalls: CallNode[]; // 子调用列表
}

type CallNode = SkillCallNode | ToolCallNode;

interface SkillCallNode {
  type: 'skill';
  name: string;
  toolUseId: string;
  startTime: number;
  nestedCalls: CallNode[];
}

interface ToolCallNode {
  type: 'tool';
  name: string;
  toolUseId?: string;
  // 工具特定信息
  command?: string;  // Bash
  file?: string;     // Read
  pattern?: string;  // Glob
  url?: string;      // WebFetch
  query?: string;    // WebSearch
}
```

## 已知限制

### 1. Token 统计未获取
- Hook 事件的 `body.usage` 字段为空
- Transcript 文件中的 usage 格式与预期不符
- 导致 `totalUsage` 全为 0

### 2. Session 重复输出
- Stop 和 SessionEnd 事件都会触发转发
- 已通过 `processedSessions` Set 做去重
- 实际只输出一次

## 验证方法

```bash
# 启动 relay
cd ~/.openclaw/workspace/claude-agent-hook-relay
fuser -k 8080/tcp 2>/dev/null
npm run build && node dist/index.js start

# 运行测试 skill
claude -p "run weather-checker"
claude -p "run nested-test-skill"
claude -p "run level-3-skill"
claude -p "run sequential-skill"
```

## Skill 测试用例

测试 skills 已通过 `cahr install-test-skill` 安装到 `~/.claude/skills/`：

| Skill | 描述 |
|-------|------|
| weather-checker | 单层：调用 Bash |
| nested-test-skill | 两层：调用 weather-checker + Bash + Read |
| level-1-skill | 三层：第一层 |
| level-2-skill | 三层：调用 level-1-skill |
| level-3-skill | 三层：调用 level-2-skill |
| sequential-skill | 连续调用：两次 weather-checker |
