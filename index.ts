/**
 * Content Moderation Plugin
 * 
 * Features:
 * - Message moderation via OpenClaw hooks
 * - Configurable keyword filtering
 * - REST API for keyword management
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent in ESM
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIR = path.resolve(__dirname, '..');

// Config file path
const CONFIG_PATH = path.join(PLUGIN_DIR, 'config.yaml');

// Keywords storage (in-memory, backed by config file)
let keywords: Set<string> = new Set([
  "敏感词1",
  "敏感词2"
]);

// ==================== Config ====================

interface Config {
  enabled: boolean;
  keywords: string[];
}

function loadConfig(): Config {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      const config = parseYAML(content);
      return {
        enabled: config.enabled ?? true,
        keywords: config.keywords ?? []
      };
    }
  } catch (err) {
    console.error('[content-moderation] Failed to load config:', err);
  }
  return { enabled: true, keywords: [] };
}

function saveConfig(config: Config): boolean {
  try {
    fs.writeFileSync(CONFIG_PATH, stringifyYAML(config));
    return true;
  } catch (err) {
    console.error('[content-moderation] Failed to save config:', err);
    return false;
  }
}

function loadKeywords(): void {
  const config = loadConfig();
  keywords = new Set(config.keywords);
}

// ==================== Keyword API ====================

export function getKeywords(): string[] {
  return Array.from(keywords);
}

export function addKeyword(word: string): boolean {
  if (keywords.has(word)) return false;
  keywords.add(word);
  const config = loadConfig();
  config.keywords = Array.from(keywords);
  return saveConfig(config);
}

export function removeKeyword(word: string): boolean {
  if (!keywords.has(word)) return false;
  keywords.delete(word);
  const config = loadConfig();
  config.keywords = Array.from(keywords);
  return saveConfig(config);
}

export function updateKeywords(newKeywords: string[]): boolean {
  keywords = new Set(newKeywords);
  const config = loadConfig();
  config.keywords = newKeywords;
  return saveConfig(config);
}

export function clearKeywords(): boolean {
  return updateKeywords([]);
}

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

// ==================== Hook Handler ====================

async function handler(event: {
  type: string;
  action: string;
  text?: string;
  cancel?: boolean;
  cancelReason?: string;
}) {
  // Only process message received events
  if (event.type !== "message" || event.action !== "received") {
    return;
  }

  const text = event.text || "";
  if (!text) return;

  // Check against keywords
  const matched = checkContent(text);
  if (matched) {
    event.cancel = true;
    event.cancelReason = `Contains keyword: ${matched}`;
  }
}

// ==================== YAML Parser ====================

function parseYAML(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  let stack: { indent: number; obj: Record<string, unknown> }[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);
    while (stack.length > 0 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const parent = stack.length > 0 ? stack[stack.length - 1].obj : result;
    const key = trimmed.split(':')[0].trim();
    const value = trimmed.split(':').slice(1).join(':').trim();

    if (!value) {
      parent[key] = {};
      stack.push({ indent, obj: parent[key] as Record<string, unknown> });
    } else {
      parent[key] = parseValue(value);
    }
  }

  return result;
}

function parseValue(value: string): unknown {
  if ((value.startsWith('"') && value.endsWith('"')) || 
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!isNaN(Number(value)) && value !== '') return Number(value);
  return value;
}

function stringifyYAML(obj: Record<string, unknown>, indent = 0): string {
  let yaml = '';
  const spaces = '  '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      yaml += `${spaces}${key}:\n${stringifyYAML(value as Record<string, unknown>, indent + 1)}`;
    } else if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      for (const item of value) {
        yaml += `${spaces}  - ${item}\n`;
      }
    } else if (typeof value === 'string') {
      yaml += `${spaces}${key}: "${value}"\n`;
    } else {
      yaml += `${spaces}${key}: ${value}\n`;
    }
  }

  return yaml;
}

// ==================== OpenClaw Plugin ====================

export default {
  id: 'content-moderation',
  name: 'Content Moderation',
  description: 'Message content moderation with keyword filtering',
  
  register(api: {
    logger: { info: (msg: string) => void };
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
    
    // Load keywords from config
    loadKeywords();
    api.logger.info(`[content-moderation] Loaded ${keywords.size} keywords`);
    
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
        
        // PUT /keywords - replace all keywords
        if (method === 'PUT' && url === '') {
          const body = req.body as { keywords?: string[] };
          if (body?.keywords && updateKeywords(body.keywords)) {
            return {
              status: 200,
              data: { success: true, keywords: getKeywords() }
            };
          }
          return {
            status: 400,
            data: { error: 'Failed to update keywords' }
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
