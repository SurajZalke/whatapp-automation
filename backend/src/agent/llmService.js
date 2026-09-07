/**
 * SK Agent - LLM Service
 * Priority: Groq (fast cloud PRIMARY) → Gemini (cloud fallback) → Ollama (local LAST RESORT)
 * Features: token trimming, markdown/reasoning stripping, model auto-detection,
 *           image understanding (Gemini Vision), PDF/doc text extraction (pdf-parse)
 */

const axios = require('axios');
const pdfParse = require('pdf-parse');

// ── API Key Pools ──────────────────────────────────────────────────────────────
const GROQ_KEYS = [
  process.env.GROQ_API_KEY,
  process.env.GROQ_API_KEY1,
  process.env.GROQ_API_KEY2,
  process.env.GROQ_API_KEY3,
].filter(Boolean);

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY2,
  process.env.GEMINI_API_KEY3,
].filter(Boolean);

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

// Preferred Groq models (compound is the only chat model on this account)
const GROQ_MODELS = [
  'groq/compound',
  'groq/compound-mini',
  'qwen/qwen3.6-27b',
  'qwen/qwen3.8-27b',
];

const GEMINI_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
];

let groqKeyIdx = 0;
let geminiKeyIdx = 0;
let cachedOllamaModel = null;   // first working Ollama model
let cachedGroqModel = null;
let ollamaAvailable = null;     // null = untested, true/false = tested

function nextGroqKey() {
  return GROQ_KEYS[(groqKeyIdx++) % GROQ_KEYS.length];
}
function nextGeminiKey() {
  return GEMINI_KEYS[(geminiKeyIdx++) % GEMINI_KEYS.length];
}

// ── Token budget ───────────────────────────────────────────────────────────────
// Rough 4-chars-per-token estimate. groq/compound limit ~30k tokens total.
const MAX_PROMPT_CHARS = 8000; // well under 30k tokens to avoid 413

function trimMessages(messages) {
  // Always keep system prompt + last user message at minimum
  const system = messages.filter(m => m.role === 'system');
  const rest = messages.filter(m => m.role !== 'system');

  let totalChars = system.reduce((s, m) => s + m.content.length, 0);
  const kept = [];

  // Walk from newest to oldest, keep until budget
  for (let i = rest.length - 1; i >= 0; i--) {
    const chars = rest[i].content.length;
    if (totalChars + chars > MAX_PROMPT_CHARS && kept.length > 0) break;
    kept.unshift(rest[i]);
    totalChars += chars;
  }

  return [...system, ...kept];
}

// ── Strip reasoning/CoT blocks (Groq compound, deepseek r1, etc.) ─────────
function stripReasoning(text) {
  if (!text) return text;
  let t = text;
  // Common CoT tags
  t = t.replace(/<think>[\s\S]*?<\/think>/g, '');
  t = t.replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '');
  t = t.replace(/<analysis>[\s\S]*?<\/analysis>/gi, '');
  // Lines that start with reasoning markers
  t = t.replace(/^\s*\*?\*?Reasoning[\s\S]*?(?=\n\s*\*?\*?(Final|Message|Here|Answer|Result))/i, '');
  // "Here's the full reasoning..." header blocks — remove from "Reasoning & Time Conversion" etc up to the actual final answer paragraph — greedy until we find a line that contains ">", "Message to", "Final", or "You can copy"
  const reasoningHeaders = /(Here'?s the full reasoning|Reasoning\s*[&\-]|Reasoning\s*[:\-]|Time Conversion|Full reasoning|Let me (think|reason)|My reasoning)/i;
  const idx = t.search(reasoningHeaders);
  if (idx !== -1) {
    // Try to find the actual answer after the reasoning block. The real answer starts with "> ", "Message:", "Final Answer:" or after the last numbered item that looks like the output
    const after = t.slice(idx);
    // If we find "> " quoted line or "Message to Suraj" line:
    const m = after.match(/Message\s+to\s+\w+[\s\S]*?\n\s*>([\s\S]*?)(?=\n\n|$)/i);
    const m2 = after.match(/>\s*([\s\S]*?)(?:\n\n|You can copy|Let me know|$)/);
    if (m && m[1]) { t = t.slice(0, idx) + m[1].trim(); }
    else if (m2 && m2[1]) { t = t.slice(0, idx) + m2[1].trim(); }
    else {
      // take everything before reasoning header
      const before = t.slice(0, idx).trim();
      // take anything after a line that contains ">" in after
      const quoteMatch = after.match(/\n\s*>([\s\S]*)$/);
      t = (quoteMatch && quoteMatch[1]) ? (before + '\n' + quoteMatch[1].trim()) : before;
      t = t.trim();
      if (!t) t = after.replace(/^[\s\S]*?\n\s*\d+\s*[\.\)]\s*/m, '').trim();
    }
  }
  return t.trim();
}

// ── Strip markdown → plain WhatsApp text ──────────────────────────────────────
function stripMarkdown(text) {
  if (!text) return text;
  let t = stripReasoning(text);
  return t
    // Remove bold/italic markers
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    // Remove headers
    .replace(/^#{1,6}\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Convert markdown bullets to plain dash
    .replace(/^\s*[-*+]\s+/gm, '- ')
    // Remove inline code backticks
    .replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove links, keep label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove remaining asterisks used as emphasis
    .replace(/\*/g, '')
    // Clean up multiple blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Ollama (local) ─────────────────────────────────────────────────────────────

const FORCED_OLLAMA_MODEL = (process.env.OLLAMA_MODEL || '').trim();

// Small → fast → larger. llama3.2:3b works on 4GB RAM, llama3:8b needs 8GB+.
const OLLAMA_PREFERRED_ORDER = [
  'llama3.2', 'llama3.1', 'llama3',
  'qwen2.5', 'qwen2',
  'phi3.5', 'phi3',
  'gemma2', 'mistral',
  'deepseek-r1', 'granite',
];

function listLocalOllamaModels() {
  return axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 })
    .then(r => (r.data.models || []).map(m => m.name))
    .catch(() => null);
}

async function getOllamaModel() {
  if (cachedOllamaModel) return cachedOllamaModel;

  if (FORCED_OLLAMA_MODEL) {
    cachedOllamaModel = FORCED_OLLAMA_MODEL.includes(':')
      ? FORCED_OLLAMA_MODEL
      : `${FORCED_OLLAMA_MODEL}:latest`;
    console.log(`[LLM] Ollama force model: ${cachedOllamaModel}`);
    return cachedOllamaModel;
  }

  try {
    const models = await listLocalOllamaModels();
    if (!models || models.length === 0) return null;

    for (const p of OLLAMA_PREFERRED_ORDER) {
      const found = models.find(m => m.toLowerCase().startsWith(p.toLowerCase()));
      if (found) { cachedOllamaModel = found; return found; }
    }
    cachedOllamaModel = models[0];
    return cachedOllamaModel;
  } catch {
    return null;
  }
}

async function callOllama(messages) {
  const model = await getOllamaModel();
  if (!model) throw new Error('No Ollama model available');

  const trimmed = trimMessages(messages);

  let response;
  try {
    // Try /api/chat (native Ollama chat API)
    response = await axios.post(
      `${OLLAMA_URL}/api/chat`,
      {
        model,
        messages: trimmed,
        stream: false,
        options: { temperature: 0.6, num_predict: 600, top_p: 0.9 },
      },
      { timeout: 120000 }
    );
    if (response.data?.message?.content) return response.data.message.content.trim();
  } catch (e) {
    // /api/chat unsupported on older Ollama → fallback to /api/generate
    const system = trimmed.find(m => m.role === 'system')?.content || '';
    const others = trimmed.filter(m => m.role !== 'system');
    const prompt = (system ? `SYSTEM:\n${system}\n\n` : '') +
      others.map(m => `${m.role === 'assistant' ? 'ASSISTANT' : 'USER'}: ${m.content}`).join('\n\n') +
      '\n\nASSISTANT:';
    response = await axios.post(
      `${OLLAMA_URL}/api/generate`,
      { model, prompt, stream: false, options: { temperature: 0.6, num_predict: 600 } },
      { timeout: 120000 }
    );
    if (response.data?.response) return response.data.response.trim();
  }

  return '';
}

let ollamaInstructionsShown = false;

async function isOllamaRunning() {
  if (ollamaAvailable !== null) return ollamaAvailable;

  // Wait up to ~8s in case service is warming up (retry 3x short)
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const models = await listLocalOllamaModels();
      if (models === null) throw new Error('no response');

      const model = await getOllamaModel();
      ollamaAvailable = !!model;

      if (ollamaAvailable) {
        console.log(`[LLM] ✅ Ollama OK — model: ${cachedOllamaModel}  (local, free, private)`);
      } else {
        console.log(`[LLM] ⚠️  Ollama running but NO models pulled. Run:  ollama pull llama3.2`);
        console.log(`       Installed: ${models.join(', ')}`);
        if (!ollamaInstructionsShown) {
          console.log(`[LLM] 💡 Quick setup (in a new terminal):\n` +
                      `        1) ollama serve           (leave running)\n` +
                      `        2) ollama pull llama3.2   (2GB download, once only)`);
          ollamaInstructionsShown = true;
        }
      }
      return ollamaAvailable;
    } catch (e) {
      lastErr = e;
      await new Promise(r => setTimeout(r, attempt === 0 ? 1000 : 2500));
    }
  }

  ollamaAvailable = false;
  console.log('[LLM] 🚫 Ollama NOT running → only cloud APIs (Groq → Gemini) will be used.');
  if (!ollamaInstructionsShown) {
    console.log(`[LLM] 💡 To enable LOCAL FALLBACK LLM (used only if Groq+Gemini both fail):\n` +
                `        Run in a new terminal (once per PC restart):\n` +
                `        1) Start-Process "$env:LOCALAPPDATA\\Programs\\Ollama\\ollama.exe" serve\n` +
                `        2) ollama pull llama3.2    (if not already pulled, ~2GB once)\n` +
                `        (no backend restart needed — Ollama is checked on each cloud failure)`);
    ollamaInstructionsShown = true;
  }
  return ollamaAvailable;
}

// ── Groq ───────────────────────────────────────────────────────────────────────

async function detectGroqModel(apiKey) {
  if (cachedGroqModel) return cachedGroqModel;
  try {
    const r = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 8000,
    });
    const available = r.data.data.map(m => m.id);
    for (const m of GROQ_MODELS) {
      if (available.includes(m)) {
        cachedGroqModel = m;
        console.log('[LLM] Groq model selected:', m);
        return m;
      }
    }
    // fallback to anything usable
    const fallback = available.find(m => !m.includes('whisper') && !m.includes('guard') && !m.includes('orpheus'));
    if (fallback) { cachedGroqModel = fallback; return fallback; }
  } catch {}
  return GROQ_MODELS[0];
}

async function callGroq(messages) {
  const trimmed = trimMessages(messages);

  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const apiKey = nextGroqKey();
    const model = await detectGroqModel(apiKey);
    try {
      const resp = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        { model, messages: trimmed, max_tokens: 500, temperature: 0.7 },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 25000,
        }
      );
      return resp.data.choices[0].message.content.trim();
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      console.warn(`[LLM] Groq ${model} key${i + 1} failed (${status}): ${msg?.substring(0, 80)}`);
      cachedGroqModel = null; // reset for next attempt
      if (status === 413) { continue; } // token too large — next key
      if (status === 429) { await new Promise(r => setTimeout(r, 1500)); continue; }
      if (status === 401 || status === 403) continue;
    }
  }
  throw new Error('Groq unavailable');
}

// ── Gemini ─────────────────────────────────────────────────────────────────────

async function callGemini(messages) {
  const trimmed = trimMessages(messages);
  const systemText = trimmed.find(m => m.role === 'system')?.content || '';
  const contents = trimmed
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const apiKey = nextGeminiKey();
    for (const model of GEMINI_MODELS) {
      try {
        const body = { contents, generationConfig: { maxOutputTokens: 500, temperature: 0.7 } };
        if (systemText) body.system_instruction = { parts: [{ text: systemText }] };

        const resp = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          body,
          { timeout: 25000 }
        );
        const text = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) return text.trim();
      } catch (err) {
        const status = err.response?.status;
        if (status === 400 || status === 401 || status === 403) break; // bad key → next key
        if (status === 429) { await new Promise(r => setTimeout(r, 1000)); continue; }
        // 404 = model not found, try next model
      }
    }
  }
  throw new Error('Gemini unavailable');
}

// ── Main chat() ────────────────────────────────────────────────────────────────

async function chat(messages) {
  let raw = null;

  // 1. Try Groq (FAST cloud API — PRIMARY)
  try {
    raw = await callGroq(messages);
    console.log('[LLM] Response from Groq');
  } catch (e) {
    console.warn('[LLM] Groq (primary) failed:', e.message);
  }

  // 2. Try Gemini (cloud API — SECONDARY)
  if (!raw) {
    try {
      raw = await callGemini(messages);
      console.log('[LLM] Response from Gemini');
    } catch (e) {
      console.warn('[LLM] Gemini (secondary) failed:', e.message);
    }
  }

  // 3. Try Ollama (LOCAL LLM — FALLBACK when cloud APIs are down)
  if (!raw) {
    try {
      const ollamaOk = await isOllamaRunning();
      if (ollamaOk) {
        raw = await callOllama(messages);
        console.log('[LLM] Response from Ollama (local fallback)');
      } else {
        console.warn('[LLM] Ollama not running — skipping local fallback');
      }
    } catch (e) {
      console.warn('[LLM] Ollama (local fallback) failed:', e.message);
    }
  }

  if (!raw) throw new Error('All LLM providers unavailable (Groq → Gemini → Ollama)');

  return stripMarkdown(raw);
}

// ── Media Understanding ────────────────────────────────────────────────────────
// analyzeMedia(mediaData, mimeType, caption)
//   mediaData  — Buffer or base64 string of the file
//   mimeType   — e.g. 'image/jpeg', 'application/pdf', 'image/png'
//   caption    — optional caption the sender added
// Returns a plain-text description/summary of the media content, or null on failure.

const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp'];
const PDF_MIME_TYPES   = ['application/pdf'];
const DOC_MIME_TYPES   = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/csv',
];

async function analyzeMedia(mediaData, mimeType, caption = '') {
  if (!mediaData || !mimeType) return null;
  const mime = mimeType.toLowerCase();

  // ── IMAGE → Gemini Vision ────────────────────────────────────────────────
  if (IMAGE_MIME_TYPES.some(t => mime.startsWith(t) || mime === t)) {
    return await analyzeImageWithGemini(mediaData, mimeType, caption);
  }

  // ── PDF → pdf-parse ──────────────────────────────────────────────────────
  if (PDF_MIME_TYPES.includes(mime)) {
    return await extractPdfText(mediaData, caption);
  }

  // ── Plain text / CSV ─────────────────────────────────────────────────────
  if (mime === 'text/plain' || mime === 'text/csv') {
    try {
      const buf = Buffer.isBuffer(mediaData) ? mediaData : Buffer.from(mediaData, 'base64');
      const text = buf.toString('utf-8').slice(0, 3000);
      return caption
        ? `Document caption: "${caption}"\nContent:\n${text}`
        : `Document content:\n${text}`;
    } catch { return null; }
  }

  // ── Word docs → extract raw text via buffer string (best-effort) ─────────
  if (DOC_MIME_TYPES.includes(mime)) {
    return caption
      ? `Document received (caption: "${caption}"). Unable to fully read this format, but the caption says: "${caption}".`
      : `A document was received but its format (${mime}) cannot be fully read.`;
  }

  return null; // unknown type — caller will fall back to type label
}

// ── Gemini Vision ──────────────────────────────────────────────────────────────

async function analyzeImageWithGemini(mediaData, mimeType, caption) {
  const base64 = Buffer.isBuffer(mediaData) ? mediaData.toString('base64') : mediaData;

  const promptText = caption
    ? `The user sent this image with the caption: "${caption}". Describe what is in the image concisely (2-4 sentences). Focus on the most important content — text, people, objects, context. Reply in plain text, no markdown.`
    : `Describe what is in this image concisely (2-4 sentences). Focus on the most important content — text, people, objects, context. Reply in plain text, no markdown.`;

  for (let i = 0; i < GEMINI_KEYS.length; i++) {
    const apiKey = nextGeminiKey();
    for (const model of ['gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-flash-8b']) {
      try {
        const body = {
          contents: [{
            parts: [
              { text: promptText },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.3 },
        };
        const resp = await axios.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          body,
          { timeout: 30000 }
        );
        const text = resp.data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`[LLM] Image analyzed via Gemini Vision (${model})`);
          return stripMarkdown(text.trim());
        }
      } catch (err) {
        const status = err.response?.status;
        if (status === 400 || status === 401 || status === 403) break; // bad key → next key
        if (status === 429) { await new Promise(r => setTimeout(r, 1000)); continue; }
        // 404 = model not available, try next
      }
    }
  }

  console.warn('[LLM] Gemini Vision failed for image — falling back to caption only');
  return caption ? `Image received. Caption: "${caption}"` : null;
}

// ── PDF text extraction ────────────────────────────────────────────────────────

async function extractPdfText(mediaData, caption) {
  try {
    const buf = Buffer.isBuffer(mediaData) ? mediaData : Buffer.from(mediaData, 'base64');
    const data = await pdfParse(buf, { max: 3 }); // parse first 3 pages max
    let text = (data.text || '').trim();

    if (!text) {
      return caption
        ? `PDF received (caption: "${caption}"). The PDF appears to be image-based (scanned) with no extractable text.`
        : `A PDF was received but it appears to be image-based with no extractable text.`;
    }

    // Trim to a reasonable size for the prompt
    if (text.length > 3000) text = text.slice(0, 2900) + '...(truncated)';

    console.log(`[LLM] PDF extracted: ${text.length} chars from ${data.numpages} page(s)`);
    return caption
      ? `PDF received (caption: "${caption}").\nExtracted content:\n${text}`
      : `PDF content:\n${text}`;
  } catch (err) {
    console.warn('[LLM] PDF parse failed:', err.message);
    return caption ? `PDF received. Caption: "${caption}"` : null;
  }
}

module.exports = { chat, stripMarkdown, isOllamaRunning, analyzeMedia };
