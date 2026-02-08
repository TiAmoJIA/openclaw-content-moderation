/**
 * Content Moderation Plugin for OpenClaw
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PLUGIN_DIR = path.dirname(__filename);
const ADMIN_PATH = path.join(PLUGIN_DIR, 'admin');
const PUBLIC_PATH = path.join(ADMIN_PATH, 'public');
const PORT = process.env.PORT || 8080;

let server = null;

function loadConfig() {
  try {
    const configPath = path.join(PLUGIN_DIR, 'config.yaml');
    if (fs.existsSync(configPath)) {
      return parseYAML(fs.readFileSync(configPath, 'utf8'));
    }
  } catch (err) {
    console.error('[content-moderation] Load config failed:', err);
  }
  return { enabled: true, mode: 'both', keywords: [], whitelist: [], stats: { totalChecks: 0, blocked: 0 } };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(path.join(PLUGIN_DIR, 'config.yaml'), stringifyYAML(config));
    return true;
  } catch (err) {
    console.error('[content-moderation] Save config failed:', err);
    return false;
  }
}

function checkKeywords(text, config) {
  if (!config.enabled || !config.keywords) return null;
  for (const k of config.keywords) {
    if (text.toLowerCase().includes(k.toLowerCase())) return k;
  }
  return null;
}

function isWhitelisted(sessionKey, config) {
  for (const p of config.whitelist || []) {
    const regex = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    if (new RegExp(`^${regex}$`).test(sessionKey)) return true;
  }
  return false;
}

function createServer() {
  return http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      if (req.url.startsWith('/api/')) {
        const config = loadConfig();
        const url = req.url.replace('/api/', '');
        
        if (url === 'data') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ keywords: config.keywords, whitelist: config.whitelist, stats: config.stats, enabled: config.enabled }));
          return;
        }
        
        if (url === 'test' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => {
            const data = JSON.parse(body);
            const matched = checkKeywords(data.text || '', config);
            res.writeHead(200);
            res.end(JSON.stringify({ passed: !matched, matched: matched || null }));
          });
          return;
        }
        
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not Found' }));
        return;
      }
      
      let filePath = req.url === '/' ? '/index.html' : req.url;
      filePath = path.join(PUBLIC_PATH, filePath);
      
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal Error' }));
    }
  });
}

function startServer() {
  if (server) return;
  server = createServer();
  server.listen(PORT, '127.0.0.1', () => console.log(`[content-moderation] Admin: http://localhost:${PORT}`));
}

function stopServer() {
  if (server) { server.close(); server = null; }
}

function parseYAML(content) {
  const r = {}, ls = content.split('\n'), st = [];
  for (const l of ls) {
    const t = l.trim();
    if (!t || t.startsWith('#')) continue;
    const i = l.search(/\S/);
    while (st.length && i <= st[st.length - 1].ind) st.pop();
    const p = st.length ? st[st.length - 1].o : r;
    const k = t.split(':')[0].trim();
    const v = t.split(':').slice(1).join(':').trim();
    if (!v) { p[k] = {}; st.push({ ind: i, o: p[k] }); }
    else {
      let val = v;
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) val = v.slice(1, -1);
      else if (v === 'true') val = true;
      else if (v === 'false') val = false;
      else if (!isNaN(Number(v))) val = Number(v);
      p[k] = val;
    }
  }
  return r;
}

function stringifyYAML(obj, ind = 0) {
  let y = '', s = '  '.repeat(ind);
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v && !Array.isArray(v)) y += `${s}${k}:\n${stringifyYAML(v, ind + 1)}`;
    else if (Array.isArray(v)) { y += `${s}${k}:\n`; v.forEach(i => y += `${s}  - ${i}\n`); }
    else y += `${s}${k}: ${typeof v === 'string' ? `"${v}"` : v}\n`;
  }
  return y;
}

const plugin = {
  id: 'content-moderation',
  name: 'Content Moderation',
  description: 'Message moderation with keyword filtering',
  register(api) {
    api.logger.info('[content-moderation] Registering...');
    
    api.registerHook(['message:received'], async (e) => {
      const c = loadConfig();
      if (!c.enabled || c.mode === 'output_only') return;
      if (isWhitelisted(e.sessionKey || '', c)) return;
      const m = checkKeywords(e.text || e.content || '', c);
      if (m) {
        c.stats = c.stats || { totalChecks: 0, blocked: 0 };
        c.stats.totalChecks++; c.stats.blocked++;
        saveConfig(c);
        e.cancel = true; e.cancelReason = `Keyword: ${m}`;
        api.logger.info(`[content-moderation] Blocked input: ${m}`);
      }
    });
    
    api.registerHook(['message:sending'], async (e) => {
      const c = loadConfig();
      if (!c.enabled || c.mode === 'input_only') return;
      if (isWhitelisted(e.sessionKey || '', c)) return;
      const m = checkKeywords(e.content || e.text || '', c);
      if (m) {
        c.stats = c.stats || { totalChecks: 0, blocked: 0 };
        c.stats.totalChecks++; c.stats.blocked++;
        saveConfig(c);
        e.cancel = true; e.cancelReason = `Keyword: ${m}`;
        api.logger.info(`[content-moderation] Blocked output: ${m}`);
      }
    });
    
    api.registerService({ id: 'content-moderation-admin', start: () => { api.logger.info('[content-moderation] Starting...'); startServer(); }, stop: () => { stopServer(); } });
    
    api.registerCli(async (a) => {
      const c = loadConfig();
      switch (a._[0]) {
        case 'status': console.log(`Enabled: ${c.enabled}, Keywords: ${c.keywords?.length || 0}, Checks: ${c.stats?.totalChecks || 0}`); break;
        case 'test': console.log(checkKeywords(a.text || a[1] || '', c) ? 'Blocked' : 'Passed'); break;
        case 'enable': c.enabled = true; saveConfig(c); break;
        case 'disable': c.enabled = false; saveConfig(c); break;
        default: console.log('/moderation status|test|enable|disable');
      }
    }, { name: 'moderation', description: 'Content moderation' });
    
    api.logger.info(`[content-moderation] Ready (port ${PORT})`);
  }
};

module.exports = plugin;
