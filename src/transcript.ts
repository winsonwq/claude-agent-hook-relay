// src/transcript.ts

import * as fs from 'fs';
import * as readline from 'readline';
import type { SkillTree, SkillCallNode, ToolCallNode } from './types.js';

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

      const content = this.getMessageContent(entry);
      if (content) {
        for (const msg of content) {
          if (msg.type === 'message' && msg.usage) {
            const usage = msg.usage as Record<string, number>;
            inputTokens += usage.input_tokens ?? 0;
            outputTokens += usage.output_tokens ?? 0;
            cacheReadTokens += usage.cache_read_input_tokens ?? 0;
            cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
          }
        }
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
      if (entry.type === 'assistant') {
        const content = this.getMessageContent(entry);
        if (content) {
          for (const msg of content) {
            if (msg.type === 'message' && msg.usage) {
              const usage = msg.usage as Record<string, number>;
              inputTokens += usage.input_tokens ?? 0;
              outputTokens += usage.output_tokens ?? 0;
              cacheReadTokens += usage.cache_read_input_tokens ?? 0;
              cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
            }
          }
        }
      }
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  }

  /**
   * Analyze transcript to build a unified skill tree.
   *
   * Returns a single SkillTree rooted at the first (outermost) skill,
   * with nested calls represented as a tree of CallNodes (both SkillCallNodes and ToolCallNodes).
   */
  static async analyzeNestedCalls(transcriptPath: string): Promise<SkillTree | null> {
    const entries = await this.read(transcriptPath);

    // Build tool_use_id -> { name, input, skill }
    const toolUseById = new Map<string, { name: string; input?: Record<string, unknown>; skill: string | null }>();
    for (const entry of entries) {
      if (entry.type === 'assistant') {
        const content = this.getMessageContent(entry);
        if (content) {
          for (const item of content) {
            if (item.type === 'tool_use') {
              const toolUse = item as Record<string, unknown>;
              const id = toolUse.id as string;
              const name = toolUse.name as string;
              const input = toolUse.input as Record<string, unknown> | undefined;
              const skillName = typeof input?.skill === 'string' ? input.skill : null;
              toolUseById.set(id, { name, input, skill: skillName });
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
        // Add more tools as needed
      }
      return info;
    };

    interface StackEntry {
      node: SkillCallNode;
      pendingTools: number;
      isDone: boolean;
    }

    const skillStack: StackEntry[] = [];
    // Map: tool_use_id -> stack index (which skill owns this tool)
    const toolOwnership = new Map<string, number>();

    const popDoneSkills = () => {
      while (skillStack.length > 1 && skillStack[skillStack.length - 1].isDone) {
        skillStack.pop();
      }
    };

    for (const entry of entries) {
      if (entry.type === 'assistant') {
        const content = this.getMessageContent(entry);
        if (!content) continue;

        for (const item of content) {
          if (item.type !== 'tool_use') continue;
          const toolUse = item as Record<string, unknown>;
          const toolId = toolUse.id as string;
          const toolName = toolUse.name as string;
          const toolInput = toolUse.input as Record<string, unknown> | undefined;
          const skillName = typeof toolInput?.skill === 'string' ? toolInput.skill : null;

          if (toolName === 'Skill' && skillName) {
            // Skill call - pop done skills, then create node and add to parent's nestedCalls
            popDoneSkills();

            const skillNode: SkillCallNode = {
              type: 'skill',
              name: skillName,
              toolUseId: toolId,
              startTime: Date.now(), // Transcript doesn't have precise timing
              nestedCalls: [],
            };

            // Add to parent's nestedCalls
            if (skillStack.length > 0) {
              skillStack[skillStack.length - 1].node.nestedCalls.push(skillNode);
            }

            // Push onto stack
            skillStack.push({ node: skillNode, pendingTools: 0, isDone: false });
          } else {
            // Tool call - pop done skills first, then attribute to current skill
            popDoneSkills();

            const toolInfo = extractToolInfo(toolName, toolInput);
            const toolNode: ToolCallNode = {
              type: 'tool',
              name: toolName,
              toolUseId: toolId,
              ...toolInfo,
            };

            if (skillStack.length > 0) {
              skillStack[skillStack.length - 1].node.nestedCalls.push(toolNode);
              skillStack[skillStack.length - 1].pendingTools++;
            }
            toolOwnership.set(toolId, skillStack.length > 0 ? skillStack.length - 1 : -1);
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
            // Skill result - nothing to do (Launching status)
          } else {
            // Tool result - decrement pending and check if done
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
    if (skillStack.length === 0) return null;

    const root = skillStack[0].node;
    return {
      skill: root.name,
      toolUseId: root.toolUseId,
      startTime: root.startTime,
      nestedCalls: root.nestedCalls,
    };
  }
}
