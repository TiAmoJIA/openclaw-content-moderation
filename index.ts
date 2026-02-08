/**
 * Content Moderation Plugin
 * 
 * Features:
 * - Message moderation via OpenClaw hooks
 * - Uses OpenClaw's config system
 * - REST API for keyword management
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');

// Keywords storage (in-memory, synced with OpenClaw config)
let keywords: Set<string> = new Set([
  "敏感词1",
  "敏感词2"
]);

// ==================== Keyword Filter ====================

export function checkContent(text: string): string | null {
  if (!text) return null;
  for (const keyword of keywords) {
    if (text.toLowerCase().includes(keyword.toLowerCase())) {
      return keyword;
    }
  }
  return null;
}

// ==================== Keyword API Functions ====================

export function getKeywords(): string[] {
  return Array.from(keywords);
}

export function addKeyword(word: string): boolean {
  if (keywords.has(word)) return false;
  keywords.add(word);
  return true;
}

export function removeKeyword(word: string): boolean {
  return keywords.delete(word);
}

export function updateKeywords(newKeywords: string[]): boolean {
  keywords = new Set(newKeywords);
  return true;
}

export function clearKeywords(): boolean {
  keywords.clear();
  return true;
}

// ==================== OpenClaw Plugin ====================

export default {
  id: 'content-moderation',
  name: 'Content Moderation',
  description: 'Message content moderation with keyword filtering',
  
  register(api: {
    logger: { info: (msg: string) => void };
    config: Record<string, unknown>;
    registerHook: (events: string[], handler: (event: {
      type: string;
      action: string;
      text?: string;
      cancel?: boolean;
      cancelReason?: string;
    }) => Promise<void>;
    registerHttpRoute: (params: {
      path: string;
      handler: (req: { url: string; method: string; body?: unknown }) => Promise<{ status: number; data: unknown }>;
    }) => void;
  }) {
    api.logger.info('[content-moderation] Registering...');
    
    // Load keywords from OpenClaw config
    const cfgKeywords = api.config?.keywords;
    if (Array.isArray(cfgKeywords)) {
      keywords = new Set(cfgKeywords);
    }
    api.logger.info(`[content-moderation] Loaded ${keywords.size} keywords from config`);
    
    // Register message received hook
    api.registerHook(['message:received'], async (event) => {
      if (event.type !== "message" || event.action !== "received") {
        return;
      }
      
      const text = event.text || "";
      if (!text) return;
      
      const matched = checkContent(text);
      if (matched) {
        event.cancel = true;
        event.cancelReason = `Contains keyword: ${matched}`;
        api.logger.info(`[content-moderation] Blocked: ${matched}`);
      }
    });
    
    // Register HTTP API routes
    api.registerHttpRoute({
      path: '/keywords',
      handler: async (req) => {
        const url = req.url?.replace('/keywords', '') || '';
        const method = req.method;
        
        // GET /keywords - list all keywords
        if (method === 'GET' && url === '') {
          return {
            status: 200,
            data: { keywords: getKeywords() }
          };
        }
        
        // POST /keywords - add keyword
        if (method === 'POST' && url === '') {
          const body = req.body as { word?: string };
          if (body?.word && addKeyword(body.word)) {
            return {
              status: 200,
              data: { success: true, keywords: getKeywords() }
            };
          }
          return {
            status: 400,
            data: { error: 'Failed to add keyword' }
          };
        }
        
        // DELETE /keywords - remove keyword
        if (method === 'DELETE' && url === '') {
          const body = req.body as { word?: string };
          if (body?.word && removeKeyword(body.word)) {
            return {
              status: 200,
              data: { success: true, keywords: getKeywords() }
            };
          }
          return {
            status: 400,
            data: { error: 'Failed to remove keyword' }
          };
        }
        
        return {
          status: 404,
          data: { error: 'Not Found' }
        };
      }
    });
    
    api.logger.info('[content-moderation] Ready');
  }
};
