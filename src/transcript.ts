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
            entries.push(JSON.parse(line));
          } catch {
            // ignore parse errors
          }
        }
      });

      rl.on('close', () => resolve(entries));
      rl.on('error', reject);
    });
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

      if (entry.content && Array.isArray(entry.content)) {
        for (const msg of entry.content) {
          if (msg.type === 'message' && msg.usage) {
            inputTokens += msg.usage.input_tokens ?? 0;
            outputTokens += msg.usage.output_tokens ?? 0;
            cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
            cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
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
      if (entry.type === 'assistant' && entry.content && Array.isArray(entry.content)) {
        for (const msg of entry.content) {
          if (msg.type === 'message' && msg.usage) {
            inputTokens += msg.usage.input_tokens ?? 0;
            outputTokens += msg.usage.output_tokens ?? 0;
            cacheReadTokens += msg.usage.cache_read_input_tokens ?? 0;
            cacheCreationTokens += msg.usage.cache_creation_input_tokens ?? 0;
          }
        }
      }
    }

    return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens };
  }
}
