import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

function loadLocalEnv(root) {
  ['.env.local', '.env'].forEach(file => {
    const envPath = path.join(root, file);
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) return;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    });
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function localAIProvider() {
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY) {
    return {
      name: 'gemini',
      model: process.env.GOOGLE_AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  return null;
}

function normalizeMessages(type, context) {
  let parsed = context;
  if (typeof context === 'string') {
    try {
      parsed = JSON.parse(context);
    } catch {
      parsed = { userMessage: context };
    }
  }
  const system = parsed?.system || 'You are Alex Ingram, a fantasy football GM assistant. Give direct, format-aware, league-grounded advice using the supplied context.';
  const sourceMessages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const userMessage = parsed?.userMessage || parsed?.userPrompt || parsed?.question || '';
  const messages = sourceMessages.length
    ? sourceMessages
    : [{ role: 'user', content: userMessage || `Analyze this ${type || 'fantasy football'} context:\n${JSON.stringify(parsed, null, 2)}` }];
  const maxTokens = Math.max(100, Math.min(Number(parsed?.maxTokens || 700), 2200));
  return { system, messages, maxTokens };
}

async function callOpenAI(provider, request) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      instructions: request.system,
      input: request.messages.map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || ''),
      })),
      max_output_tokens: request.maxTokens,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI API error ${response.status}`);
  return {
    analysis: data.output_text || (data.output || [])
      .flatMap(item => item?.content || [])
      .filter(part => part?.type === 'output_text' || part?.type === 'text')
      .map(part => part?.text || '')
      .join('') || 'No response.',
    usage: data.usage || {},
  };
}

async function callGemini(provider, request) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: request.maxTokens,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini API error ${response.status}`);
  return {
    analysis: data.choices?.[0]?.message?.content || 'No response.',
    usage: data.usage || {},
  };
}

async function callAnthropic(provider, request) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: request.messages
        .filter(message => message.role !== 'system')
        .map(message => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: String(message.content || ''),
        })),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic API error ${response.status}`);
  return {
    analysis: (data.content || [])
      .filter(part => part.type === 'text')
      .map(part => part.text || '')
      .join('') || 'No response.',
    usage: data.usage || {},
  };
}

async function handleDevAI(req, res) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const provider = localAIProvider();
    if (!provider) {
      sendJson(res, 503, {
        error: 'Local AI preview bridge is not configured. Add OPENAI_API_KEY, GOOGLE_AI_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY to reconai/.env.local and restart the preview.',
      });
      return;
    }
    const body = await readJson(req);
    const request = normalizeMessages(body.type, body.context);
    const result = provider.name === 'openai'
      ? await callOpenAI(provider, request)
      : provider.name === 'gemini'
        ? await callGemini(provider, request)
        : await callAnthropic(provider, request);

    sendJson(res, 200, {
      analysis: result.analysis,
      provider: provider.name,
      model: provider.model,
      usage: {
        ...(result.usage || {}),
        plan: 'local-preview',
        routeTier: 'preview',
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Local AI preview failed.' });
  }
}

export default defineConfig({
  plugins: [
    {
      name: 'scout-dev-ai-bridge',
      configureServer(server) {
        loadLocalEnv(process.cwd());
        server.middlewares.use((req, res, next) => {
          const pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname;
          if (pathname === '/api/dev-ai-analyze' || pathname === '/ReconAI/api/dev-ai-analyze') {
            handleDevAI(req, res);
            return;
          }
          next();
        });
      },
    },
  ],
  root: '.',
  // Relative base so the built app loads correctly no matter what path it's
  // served from (e.g. the sandbox Pages URL /ReconAI-sandbox-dev/), instead of
  // hard-coding /ReconAI/ which 404s its own assets on this repo.
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
      output: {
        manualChunks(id) {
          if (id.includes('/shared/dhq-engine') || id.includes('/shared/team-assess') || id.includes('/shared/analytics-engine')) return 'dhq-engine';
          if (id.includes('/shared/')) return 'shared-core';
          if (id.includes('/js/draft-ui') || id.includes('/js/trade-calc') || id.includes('/js/trade-builder')) return 'tooling';
          if (id.includes('/js/scout-ui')) return 'scout-ui';
        }
      }
    }
  },
  server: {
    port: 3000,
    open: true,
    watch: {
      usePolling: true
    }
  }
});
