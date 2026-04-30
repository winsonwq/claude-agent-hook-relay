// src/transcript.ts

import * as fs from 'fs';
import * as readline from 'readline';
import type { SkillTree, SkillCallNode, ToolCallNode, ModelUsage } from './types.js';

export interface TranscriptEntry {
  type: 'user' | 'assistant' | 'system' | 'attachment';
  role?: string;
  content?: unknown;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  timestamp?: string;
  uuid?: string;
  parentUuid?: string;
  message?: {
    id?: string;
    type?: string;
    role?: string;
    content?: unknown;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

export class TranscriptReader {
  static async read(transcriptPath: string): Promise<TranscriptEntry[]> {
    return new Promise((resolve, reject) => {
      const entries: TranscriptEntry[] = [];

      if (!fs.existsSync(transcriptPath)) {
        resolve(entries);
        return;
      }

      const rl = readline.createInterface({
        input: fs.createReadStream(transcriptPath),
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        if (line.trim()) {
          try {
            const parsed = JSON.parse(line);
            entries.push(parsed as TranscriptEntry);
          } catch {
            // ignore parse errors
          }
        }
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', reject);
    });
  }

  // Helper to get content array from an entry's message
  private static getMessageContent(entry: TranscriptEntry): Array<Record<string, unknown>> | null {
    const msg = entry.message;
    if (msg && Array.isArray(msg.content)) {
      return msg.content as Array<Record<string, unknown>>;
    }
    return null;
  }

  static calculateUsage(
    entries: TranscriptEntry[],
    startTime: number,
    endTime: number
  ) {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    for (const entry of entries) {
      if (entry.type !== 'assistant') continue;

      const entryTime = entry.timestamp ? new Date(entry.timestamp).getTime() : 0;
      if (entryTime < startTime || entryTime > endTime) continue;

      // Usage is at entry.message.usage (not inside content array)
      const usage = entry.message?.usage;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
        cacheReadTokens += usage.cache_read_input_tokens ?? 0;
        cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      }
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  }

  static async getSessionUsage(transcriptPath: string) {
    const entries = await this.read(transcriptPath);

    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let cacheCreationTokens = 0;

    for (const entry of entries) {
      if (entry.type !== 'assistant') continue;

      // Usage is at entry.message.usage (not inside content array)
      const usage = entry.message?.usage;
      if (usage) {
        inputTokens += usage.input_tokens ?? 0;
        outputTokens += usage.output_tokens ?? 0;
        cacheReadTokens += usage.cache_read_input_tokens ?? 0;
        cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
      }
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  }

  /**
   * Analyze transcript to build a unified skill tree.
   *
   * Returns a single SkillTree rooted at the first (outermost) skill,
   * with nested calls represented as a tree of CallNodes (both SkillCallNodes and ToolCallNodes).
   *
   * Also extracts:
   * - skill loading success/failure (from tool_result <tool_use_error> tags)
   * - discovery calls (Glob/Read/Bash filesystem probes that follow a skill call)
   * - loadedFromNestedPath inference (from Base directory meta entries)
   */
  static async analyzeNestedCalls(transcriptPath: string): Promise<SkillTree | null> {
    const entries = await this.read(transcriptPath);

    // Build tool_use_id -> { name, input, skill, ts }
    const toolUseById = new Map<string, { name: string; input?: Record<string, unknown>; skill: string | null; ts?: number }>();
    for (const entry of entries) {
      if (entry.type === 'assistant') {
        const content = this.getMessageContent(entry);
        const entryTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();
        if (content) {
          for (const item of content) {
            if (item.type === 'tool_use') {
              const toolUse = item as Record<string, unknown>;
              const id = toolUse.id as string;
              const name = toolUse.name as string;
              const input = toolUse.input as Record<string, unknown> | undefined;
              const skillName = typeof input?.skill === 'string' ? input.skill : null;
              toolUseById.set(id, { name, input, skill: skillName, ts: entryTs });
            }
          }
        }
      }
    }

    // Extract Base directory from isMeta: true entries (for loadedFromNestedPath inference)
    // Map: skillUseId -> baseDir
    const skillBaseDir = new Map<string, string>();
    for (const entry of entries) {
      if (entry.type === 'user' && (entry as unknown as Record<string, unknown>).isMeta === true) {
        const content = this.getMessageContent(entry);
        if (!content) continue;
        for (const item of content) {
          if (typeof item === 'object' && (item as Record<string, unknown>).type === 'text') {
            const text = (item as Record<string, unknown>).text as string;
            const match = text.match(/Base directory for this skill: (.+)/);
            if (match) {
              // This meta entry is attached to the preceding tool_use via sourceToolUseID
              const sourceToolUseId = (entry as unknown as Record<string, unknown>).sourceToolUseID as string;
              if (sourceToolUseId) {
                skillBaseDir.set(sourceToolUseId, match[1]);
              }
            }
          }
        }
      }
    }

    // Helper to extract tool-specific info
    const extractToolInfo = (toolName: string, input?: Record<string, unknown>): Partial<ToolCallNode> => {
      const info: Partial<ToolCallNode> = {};
      if (!input) return info;

      switch (toolName) {
        case 'Bash':
          if (typeof input.command === 'string') info.command = input.command;
          break;
        case 'Read':
          if (typeof input.file_path === 'string') info.file = input.file_path;
          break;
        case 'Write':
        case 'Edit':
          if (typeof input.file_path === 'string') info.file = input.file_path;
          if (typeof input.content === 'string') info.content = input.content.substring(0, 100);
          break;
        case 'Glob':
          if (typeof input.pattern === 'string') info.pattern = input.pattern;
          break;
        case 'Grep':
          if (typeof input.pattern === 'string') info.pattern = input.pattern;
          if (typeof input.path === 'string') info.file = input.path;
          break;
        case 'WebFetch':
          if (typeof input.url === 'string') info.url = input.url;
          break;
        case 'WebSearch':
          if (typeof input.query === 'string') info.query = input.query;
          break;
      }
      return info;
    };

    // Helper: check if a tool call looks like a filesystem discovery probe
    const isDiscoveryCall = (
      toolName: string,
      toolInput: Record<string, unknown> | undefined,
      parentSkillName: string | null
    ): boolean => {
      if (!toolInput) return false;
      switch (toolName) {
        case 'Glob': {
          const pattern = (toolInput as Record<string, unknown>).pattern as string;
          // A Glob that searches for the nested skill name
          return !!pattern && !!parentSkillName && pattern.includes(parentSkillName);
        }
        case 'Read': {
          const filePath = (toolInput as Record<string, unknown>).file_path as string;
          // A Read targeting the skills directory
          return !!filePath && filePath.includes('.claude/skills');
        }
        case 'Bash': {
          const command = (toolInput as Record<string, unknown>).command as string;
          // A Bash that lists/check the nested skill directory (ls, find, test -d)
          if (!command) return false;
          const isProbe = /\b(ls|find|test\s+-d)\b/.test(command);
          if (!isProbe) return false;
          // Must reference skills directory and likely the parent skill
          return command.includes('.claude/skills') || command.includes('skills/');
        }
        default:
          return false;
      }
    };

    // Helper: check if baseDir suggests nested path (e.g. .../parent-skill/scripts/child-skill/)
    const isNestedPath = (baseDir: string): boolean => {
      // Nested path has scripts/ or other subdirectory markers
      return /\/scripts\/[^\/]+\//.test(baseDir) || /\/[^\/]+\/scripts\/[^\/]+\//.test(baseDir);
    };

    // Helper: add usage to a skill node
    const addUsageToSkill = (node: SkillCallNode, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) => {
      if (!node.usage) {
        node.usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0 };
      }
      node.usage!.inputTokens += usage.inputTokens;
      node.usage!.outputTokens += usage.outputTokens;
      node.usage!.cacheReadTokens += usage.cacheReadTokens;
      node.usage!.cacheCreationTokens += usage.cacheCreationTokens;
    };

    interface StackEntry {
      node: SkillCallNode;
      pendingTools: number;
      isDone: boolean;
      // Pending discovery calls collected after this skill's tool_use but before its tool_result
      pendingDiscovery: ToolCallNode[];
    }

    const skillStack: StackEntry[] = [];
    const bareTools: ToolCallNode[] = [];

    // Track assistant turn index for discovery call window
    let assistantTurnIndex = 0;

    const popDoneSkills = () => {
      while (skillStack.length > 1 && skillStack[skillStack.length - 1].isDone) {
        skillStack.pop();
      }
    };

    for (const entry of entries) {
      if (entry.type === 'assistant') {
        const content = this.getMessageContent(entry);
        const thisTurnIndex = assistantTurnIndex++;

        // Attribute this assistant turn's usage to the current skill (top of stack)
        const usage = entry.message?.usage;
        if (usage && skillStack.length > 0) {
          addUsageToSkill(skillStack[skillStack.length - 1].node, {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          });
        }

        if (!content) continue;

        for (const item of content) {
          if (item.type !== 'tool_use') continue;
          const toolUse = item as Record<string, unknown>;
          const toolId = toolUse.id as string;
          const toolName = toolUse.name as string;
          const toolInput = toolUse.input as Record<string, unknown> | undefined;
          const skillName = typeof toolInput?.skill === 'string' ? toolInput.skill : null;
          const entryTs = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now();

          if (toolName === 'Skill' && skillName) {
            popDoneSkills();

            const skillNode: SkillCallNode = {
              type: 'skill',
              name: skillName,
              toolUseId: toolId,
              startTime: entryTs,
              nestedCalls: [],
              success: true,   // optimistic — will be updated when tool_result arrives
              discoveryCalls: [],
              loadedFromNestedPath: false,
            };

            // Check Base directory meta for loadedFromNestedPath inference
            const baseDir = skillBaseDir.get(toolId);
            if (baseDir && isNestedPath(baseDir)) {
              skillNode.loadedFromNestedPath = true;
            }

            if (skillStack.length > 0) {
              skillStack[skillStack.length - 1].node.nestedCalls.push(skillNode);
            }

            skillStack.push({ node: skillNode, pendingTools: 0, isDone: false, pendingDiscovery: [] });
          } else {
            // Non-Skill tool: check if it's a discovery call for the most recent skill
            const isDiscovery = skillStack.length > 0 && isDiscoveryCall(toolName, toolInput, skillStack[skillStack.length - 1].node.name);

            const toolInfo = extractToolInfo(toolName, toolInput);
            const toolNode: ToolCallNode = {
              type: 'tool',
              name: toolName,
              toolUseId: toolId,
              startTime: entryTs,
              ...toolInfo,
            };

            if (skillStack.length > 0) {
              if (isDiscovery) {
                // Attach to parent's pendingDiscovery, not nestedCalls
                skillStack[skillStack.length - 1].pendingDiscovery.push(toolNode);
              } else {
                skillStack[skillStack.length - 1].node.nestedCalls.push(toolNode);
                skillStack[skillStack.length - 1].pendingTools++;
              }
            } else {
              bareTools.push(toolNode);
            }
          }
        }
      }

      if (entry.type === 'user') {
        const content = this.getMessageContent(entry);
        if (!content) continue;

        for (const item of content) {
          if (item.type !== 'tool_result') continue;
          const toolResult = item as Record<string, unknown>;
          const toolUseId = toolResult.tool_use_id as string;
          const toolUse = toolUseById.get(toolUseId);

          if (toolUse?.skill) {
            // This is a skill tool_result — determine success/failure and extract error
            // Find the matching skill node on the stack
            const skillEntry = skillStack.find(s => s.node.toolUseId === toolUseId);
            if (skillEntry) {
              const resultContent = toolResult.content;
              if (typeof resultContent === 'string') {
                const errorMatch = resultContent.match(/<tool_use_error>(.*?)<\/tool_use_error>/s);
                if (errorMatch) {
                  skillEntry.node.success = false;
                  skillEntry.node.error = errorMatch[1].trim();
                } else {
                  skillEntry.node.success = !resultContent.includes('<tool_use_error>');
                }
              }
              // Move pending discovery calls to discoveryCalls
              skillEntry.node.discoveryCalls = [...skillEntry.pendingDiscovery];
              // Update loadedFromNestedPath based on discovery calls
              if (!skillEntry.node.loadedFromNestedPath) {
                for (const dc of skillEntry.node.discoveryCalls) {
                  const path = dc.file || dc.pattern || dc.command || '';
                  if (/\/scripts\/[^\/]+\//.test(path)) {
                    skillEntry.node.loadedFromNestedPath = true;
                    break;
                  }
                }
              }
              // Skill tool_result: set isDone = true immediately and unconditionally.
              // (pendingTools is always 0 for Skill tools since they don't increment it
              // when called — they push a new stack entry instead. So we set isDone
              // here rather than relying on pendingTools count.)
              skillEntry.isDone = true;
            }
          } else {
            if (skillStack.length > 0) {
              skillStack[skillStack.length - 1].pendingTools--;
              if (skillStack[skillStack.length - 1].pendingTools === 0) {
                skillStack[skillStack.length - 1].isDone = true;
              }
            }
          }
        }
      }
    }

    // Return the root skill (first skill on stack)
    if (skillStack.length === 0) {
      if (bareTools.length > 0) {
        const bareRoot: SkillCallNode = {
          type: 'skill',
          name: '<no-skill>',
          toolUseId: '',
          startTime: bareTools[0].startTime ?? Date.now(),
          nestedCalls: bareTools,
          success: true,
          discoveryCalls: [],
          loadedFromNestedPath: false,
        };
        return {
          skill: '<no-skill>',
          toolUseId: '',
          startTime: bareRoot.startTime,
          nestedCalls: bareTools,
          root: bareRoot,
        };
      }
      return null;
    }

    const root = skillStack[0].node;
    return {
      skill: root.name,
      toolUseId: root.toolUseId,
      startTime: root.startTime,
      nestedCalls: root.nestedCalls,
      usage: root.usage,
      root,
    };
  }
}
