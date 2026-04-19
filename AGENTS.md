# AGENTS.md - 项目规范

## 概述

claude-agent-hook-relay 是一个 TypeScript 项目，用于收集 Claude Code HTTP Hook 事件并转发到外部系统。

## 开发环境

```bash
# Node.js 18+
node --version

# 安装依赖
npm install

# 开发模式
npm run dev

# 编译
npm run build
```

## 代码规范

### 目录结构

```
src/
├── index.ts       # 主入口 + CLI 命令
├── collector.ts   # Hook 收集逻辑
├── session.ts     # Session 状态管理
├── transcript.ts  # Transcript 文件读取
├── forwarder.ts    # Console + HTTP + Composite 转发器
├── types.ts       # 类型定义
└── utils/
    ├── port.ts    # 端口自动选择
    └── install.ts # Claude Code hooks 安装/卸载
```

### 命名规范

| 类型 | 规范 | 示例 |
|------|------|------|
| 文件 | kebab-case | `session-manager.ts` |
| 类 | PascalCase | `SessionManager` |
| 接口 | PascalCase | `Forwarder` |
| 类型 | PascalCase | `ModelUsage` |
| 函数 | camelCase | `getSessionUsage()` |
| 常量 | UPPER_SNAKE | `DEFAULT_TIMEOUT_MS` |
| 枚举成员 | PascalCase | `HookEvent.Stop` |

### DRY 原则

**Don't Repeat Yourself**

- 相同逻辑只写一次，抽取为函数或工具类
- 重复代码必须重构，不允许复制粘贴
- 共享逻辑放在独立模块中

**何时违反 DRY 是可接受的**：
- 测试代码中的 fixtures
- 配置声明（但应尽量使用常量）
- 文档示例（但示例应尽量从实际代码衍生）

### TypeScript 规范

#### 严格模式

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true
  }
}
```

#### 类型规则

| 规则 | 要求 |
|------|------|
| `any` | 🚫 禁止使用 |
| `@ts-ignore` | 🚫 禁止使用 |
| `@ts-nocheck` | 🚫 禁止使用 |
| `unknown` | ✅ 优先用于替代 any |
| 类型断言 `as` | ⚠️ 尽量避免，使用类型守卫 |
| 函数返回值 | ✅ 必须显式声明 |

#### 示例

```typescript
// ❌ 禁止
function process(data: any): any {
  return data;
}

// ✅ 正确
function process(data: string): string {
  return data;
}

// ⚠️ 必要时使用 unknown
async function parseInput(input: unknown): Promise<ModelUsage> {
  if (isModelUsage(input)) {
    return input;
  }
  throw new Error('Invalid input');
}
```

#### 接口 vs 类型别名

| 使用场景 | 推荐 |
|---------|------|
| 对象结构 | `interface` |
| 联合类型 | `type` |
| 复杂类型 | `type` |
| 枚举 | `const enum` 或 `as const` |

```typescript
// ✅ 对象用 interface
interface Session {
  sessionId: string;
  skillStack: SkillInvocation[];
}

// ✅ 联合类型用 type
type HookEventType = 'PreToolUse' | 'PostToolUse' | 'Stop';
```

### ESLint 配置

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "plugins": ["@typescript-eslint"],
  "rules": {
    "no-unused-vars": "off",
    "@typescript-eslint/no-unused-vars": ["error", {
      "argsIgnorePattern": "^_",
      "varsIgnorePattern": "^_"
    }],
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "no-console": "warn"
  }
}
```

#### 关键规则

| 规则 | 级别 | 说明 |
|------|------|------|
| `@typescript-eslint/no-explicit-any` | error | 禁止 any |
| `@typescript-eslint/no-unused-vars` | error | 禁止未使用变量 |
| `no-console` | warn | 控制台仅用于调试 |
| `@typescript-eslint/no-floating-promises` | error | 必须处理 Promise |

## Hook 事件处理

### 事件端点命名

```
PreToolUse      → /hook/pre-tool-use
PostToolUse     → /hook/post-tool-use
Stop            → /hook/stop
SessionEnd      → /hook/session-end
```

转换规则：`/hook/` + 事件名.replace(/[A-Z]/g, '-$&').toLowerCase()

### Session 管理

- 每个 session_id 对应一个 Session 对象
- Session 包含 skillStack（追踪嵌套调用）和 events（所有事件）
- Stop 时清理 Session

### 转发器模式

转发器必须实现 `Forwarder` 接口：

```typescript
interface Forwarder {
  forward(data: ForwardPayload): Promise<void>;
}
```

## 配置

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| PORT | HTTP 服务端口 | 8080 |

### Claude Code 配置示例

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
    }]
  }
}
```

## 测试

TODO: 测试规范待定

## 发布流程

发布通过 GitHub Actions 完成，触发条件是 push tag。版本号以 `package.json` 为准。

### 发版步骤

```bash
# 1. 修改 package.json 版本号
# 例如从 0.1.3 → 0.1.4

# 2. 提交修改（不触发 action）
git add package.json
git commit -m "chore: bump version to 0.1.4"
git push origin main

# 3. 打 tag 并推送（触发 GitHub Actions 发布）
git tag v0.1.4
git push --tags
```

### 注意事项

- **不要手动 `npm publish`**，由 CI 自动完成
- tag 名称格式：`v*`（如 `v0.1.4`）
- `package.json` 版本号必须和 tag 版本一致
- 需要在 GitHub 仓库设置中添加 `NPM_TOKEN` secret（用于发布到 npm）

### 验证发布成功

```bash
npm view claude-agent-hook-relay version
```

## 文档

- `SPEC.md` - 需求规格
- `README.md` - 简介和快速开始
- `docs/tech.md` - 技术架构
- `docs/api.md` - API 端点说明
- `docs/otel-integration.md` - OpenTelemetry 集成（SkillTree → OTel Span 格式）
- `docs/data-collection-matrix.md` - HTTP Hook vs 原生 OTel 数据能力对比
