// src/transcript.ts

import * as fs from 'fs';
import * as readline from 'readline';

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
   * Analyze transcript to reconstruct nested skill call chains.
   *
   * Algorithm:
   * 1. Track a skill stack with pending tool counts and done status
   * 2. When a non-Skill tool returns with pending=0, mark that skill as DONE (deferred pop)
   * 3. When the NEXT tool call arrives, FIRST pop done skills from top of stack, THEN attribute
   * This correctly handles the case where a skill's script continues after one command completes.
   *
   * Returns: Map<skillToolUseId, nestedCalls>
   * - Key is the tool_use_id of the Skill call
   * - Value is array of nested tool names called by that skill
   */
  static async analyzeNestedCalls(transcriptPath: string): Promise<Map<string, string[]>> {
    const entries = await this.read(transcriptPath);
    const result = new Map<string, string[]>();

    interface SkillEntry {
      skill: string;
      toolUseId: string;  // tool_use_id of this Skill call
      pendingTools: number;
      isDone: boolean;
    }

    // Build tool_use_id -> tool_use info map
    const toolUseById = new Map<string, { name: string; skill: string | null }>();
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
              toolUseById.set(id, { name, skill: skillName });
            }
          }
        }
      }
    }

    const skillStack: SkillEntry[] = [];
    // Map: non-skill tool_use_id -> skill tool_use_id (which Skill call owns this tool)
    const toolOwnership = new Map<string, string>();

    // Pop done skills from top of stack, keeping at least one
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
          const input = toolUse.input as Record<string, unknown> | undefined;
          const skillName = typeof input?.skill === 'string' ? input.skill : null;

          if (toolName === 'Skill' && skillName) {
            // Skill tool call - pop done skills first, then push
            popDoneSkills();
            skillStack.push({ skill: skillName, toolUseId: toolId, pendingTools: 0, isDone: false });
          } else {
            // Other tool - pop done skills FIRST, then attribute
            popDoneSkills();
            const ownerSkillToolUseId = skillStack.length > 0 ? skillStack[skillStack.length - 1].toolUseId : null;
            toolOwnership.set(toolId, ownerSkillToolUseId || 'NO_OWNER');
            if (skillStack.length > 0) {
              skillStack[skillStack.length - 1].pendingTools++;
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
            // Skill tool result - just log (Launching status is handled by the fact
            // that we don't increment pending for skill calls)
          } else {
            // Non-skill tool result - decrement pending
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

    // Aggregate tool ownership by skill tool_use_id
    const ownedTools = new Map<string, string[]>();
    for (const [toolId, skillToolUseId] of toolOwnership) {
      if (!ownedTools.has(skillToolUseId)) ownedTools.set(skillToolUseId, []);
      const toolUse = toolUseById.get(toolId);
      ownedTools.get(skillToolUseId)!.push(toolUse?.name || toolId);
    }

    // Convert to result format (key is skill tool_use_id)
    for (const [skillToolUseId, tools] of ownedTools) {
      if (skillToolUseId !== 'NO_OWNER') {
        result.set(skillToolUseId, tools);
      }
    }

    return result;
  }
}
