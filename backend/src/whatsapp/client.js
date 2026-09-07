/**
 * SK Agent - WhatsApp Client
 * Handles login, incoming messages, auto-replies, file + task scheduling
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const qrcodeTerminal = require('qrcode-terminal');
const path = require('path');

const skAgent = require('../agent/skAgent');
const fileManager = require('../files/fileManager');
const memory = require('../memory/conversationMemory');
const scheduler = require('../agent/taskScheduler');
const { analyzeMedia } = require('../agent/llmService');

const OWNER_NAME = process.env.OWNER_NAME || 'Suraj Zalke';
const OWNER_SHORT_NAME = process.env.OWNER_SHORT_NAME || 'Suraj';
// Local Windows  → Chrome from Program Files
// Render/Linux   → system Chromium installed by Dockerfile (PUPPETEER_EXECUTABLE_PATH)
// Auto-detect order: env var → Linux system paths → Windows default
function getChromePath() {
  // 1. Explicit env override (Dockerfile sets PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }
  // 2. Linux system Chromium paths (Render / Ubuntu / Debian)
  const fs = require('fs');
  const linuxPaths = [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ];
  for (const p of linuxPaths) {
    if (fs.existsSync(p)) return p;
  }
  // 3. Windows fallback (local dev)
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

const CHROME_PATH = getChromePath();
console.log(`[WhatsApp] Chrome path: ${CHROME_PATH}`);

let io = null;
let client = null;
let clientState = 'disconnected';
let currentQR = null;
let messageLog = [];
let ownerChatId = null;
let initializeInProgress = false;
let reconnectTimer = null;

// Dedup — both 'message' and 'message_create' can fire for same msg
const processedIds = new Set();

// ── State ──────────────────────────────────────────────────────────────────────

function getState() {
  return {
    state: clientState,
    qr: currentQR,
    owner: ownerChatId ? {
      name: OWNER_NAME,
      shortName: OWNER_SHORT_NAME,
      chatId: ownerChatId,
    } : null,
  };
}
function getMessageLog() { return messageLog.slice(-100); }

function logMessage(entry) {
  messageLog.push({ ...entry, id: `${Date.now()}_${Math.random()}` });
  if (messageLog.length > 300) messageLog.shift();
  if (io) io.emit('message_log', entry);
}

// ── Settings ───────────────────────────────────────────────────────────────────

const settings = {
  autoReply: true,
  replyToGroups: true,          // reply to groups by default
  blacklistedChats: new Set(),
  whitelistedOnly: false,
  whitelistedChats: new Set(),
  typingDelay: true,
  minDelay: 800,
  maxDelay: 2500,
};

function getSettings() {
  return {
    ...settings,
    blacklistedChats: Array.from(settings.blacklistedChats),
    whitelistedChats: Array.from(settings.whitelistedChats),
  };
}

function updateSettings(s) {
  if (typeof s.autoReply === 'boolean') settings.autoReply = s.autoReply;
  if (typeof s.replyToGroups === 'boolean') settings.replyToGroups = s.replyToGroups;
  if (typeof s.typingDelay === 'boolean') settings.typingDelay = s.typingDelay;
  if (typeof s.whitelistedOnly === 'boolean') settings.whitelistedOnly = s.whitelistedOnly;
  if (Array.isArray(s.blacklistedChats)) settings.blacklistedChats = new Set(s.blacklistedChats);
  if (Array.isArray(s.whitelistedChats)) settings.whitelistedChats = new Set(s.whitelistedChats);
  if (io) io.emit('settings_updated', getSettings());
}

function delay(min, max) {
  return new Promise(r => setTimeout(r, Math.floor(Math.random() * (max - min + 1)) + min));
}

// ── Init WhatsApp Client ───────────────────────────────────────────────────────

async function init(socketIO) {
  io = socketIO;

  client = new Client({
    authStrategy: new LocalAuth({
      dataPath: path.join(__dirname, '../../.wwebjs_auth'),
      clientId: 'sk-agent',
    }),
    puppeteer: {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--disable-ipc-flooding-protection',
        '--disable-software-rasterizer',
        '--disable-default-apps',
        '--disable-sync',
        '--hide-scrollbars',
        '--mute-audio',
        '--ignore-certificate-errors',
        '--ignore-ssl-errors',
        '--disable-crash-reporter',
        '--no-crash-upload',
        '--disable-logging',
        // Required for restricted container environments (Render, Docker, k8s)
        '--disable-seccomp-filter-sandbox',
        '--disable-namespace-sandbox',
      ],
      timeout: 120000,  // give Chrome 120s to launch (Render cold start is slow)
    },
    // Increase timeouts so slow Render network doesn't cause scan failures
    authTimeoutMs: 300000,   // wait up to 5 min for QR scan confirmation
    qrMaxRetries: 30,        // keep generating replacement QR codes for longer
    webVersionCache: { type: 'local' },
  });

  // ── QR ────────────────────────────────────────────────────────────────────
  client.on('qr', async (qr) => {
    clientState = 'qr';
    currentQR = qr;
    console.log('\n[WhatsApp] Scan QR code to login:');
    qrcodeTerminal.generate(qr, { small: true });
    try {
      const qrBase64 = await qrcode.toDataURL(qr);
      if (io) io.emit('qr', { qr, qrBase64 });
    } catch {
      if (io) io.emit('qr', { qr, qrBase64: null });
    }
  });

  client.on('loading_screen', (percent, message) => {
    clientState = 'connecting';
    if (io) io.emit('status', { state: 'connecting', percent, message });
    if (percent % 25 === 0) console.log(`[WhatsApp] Loading: ${percent}% - ${message}`);
  });

  client.on('authenticated', () => {
    console.log('[WhatsApp] Authenticated ✓');
    clientState = 'connecting';
    currentQR = null;
    if (io) io.emit('status', { state: 'connecting', message: 'Authenticated...' });
  });

  client.on('ready', () => {
    clientState = 'ready';
    currentQR = null;
    const info = client.info;
    ownerChatId = `${info.wid.user}@c.us`;
    console.log(`[WhatsApp] ✅ Ready — ${info.pushname} (+${info.wid.user})`);
    console.log(`[WhatsApp] Owner chatId: ${ownerChatId}`);
    console.log('[WhatsApp] Listening for messages...');
    if (io) io.emit('status', {
      state: 'ready',
      name: info.pushname,
      phone: info.wid.user,
      message: 'SK Agent is online',
    });

    skAgent.setOwnerConfig({
      name: OWNER_NAME,
      shortName: OWNER_SHORT_NAME,
      chatId: ownerChatId,
    });
    console.log(`[SKAgent] Owner configured: ${OWNER_NAME} → ${ownerChatId}`);

    // Wire scheduler: send message when a task fires
    scheduler.on('task_due', async (task) => {
      await handleTaskDue(task);
    });
  });

  client.on('auth_failure', (msg) => {
    clientState = 'disconnected';
    console.error('[WhatsApp] Auth failed:', msg);
    if (io) io.emit('status', { state: 'error', message: `Auth failed: ${msg}` });
  });

  client.on('disconnected', (reason) => {
    clientState = 'disconnected';
    currentQR = null;
    console.warn('[WhatsApp] Disconnected:', reason);
    if (io) io.emit('status', { state: 'disconnected', message: `Disconnected: ${reason}` });
    // Keep one reconnect attempt pending so duplicate disconnect events do not
    // start multiple Chromium instances.
    if (reconnectTimer || initializeInProgress) return;
    console.log('[WhatsApp] Will attempt reconnect in 10s...');
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      console.log('[WhatsApp] Restarting client...');
      tryInit();
    }, 10000);
  });

  // ── Message events ─────────────────────────────────────────────────────────
  client.on('message', async (msg) => {
    await handleIncomingMessage(msg);
  });

  client.on('message_create', async (msg) => {
    if (!msg.fromMe) await handleIncomingMessage(msg);
  });

  console.log('[WhatsApp] Initializing client...');
  console.log(`[WhatsApp] Chrome path: ${CHROME_PATH}`);

  // Retry loop — Render cold starts can be slow; Chrome may fail first attempt
  let attempts = 0;
  async function tryInit() {
    if (initializeInProgress || clientState === 'ready') return;
    initializeInProgress = true;
    attempts++;
    console.log(`[WhatsApp] Init attempt ${attempts}...`);
    try {
      await client.initialize();
    } catch (err) {
      console.error(`[WhatsApp] Init attempt ${attempts} failed: ${err.message}`);
      console.error('[WhatsApp] Stack:', err.stack?.split('\n').slice(0, 5).join('\n'));
      clientState = 'disconnected';
      if (io) io.emit('status', { state: 'error', message: err.message });
      if (attempts < 5) {
        const wait = attempts * 8000; // 8s, 16s, 24s, 32s
        console.log(`[WhatsApp] Retrying in ${wait / 1000}s...`);
        if (!reconnectTimer) reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          tryInit();
        }, wait);
      } else {
        console.error('[WhatsApp] All init attempts failed. Check Chrome installation.');
      }
    } finally {
      initializeInProgress = false;
    }
  }
  tryInit();
}

// ── Handle incoming message ────────────────────────────────────────────────────

async function handleIncomingMessage(msg) {
  try {
    if (!msg || msg.isStatus) return;
    if (msg.fromMe) return;

    // Dedup
    const msgId = msg.id?.id || `${msg.from}_${msg.timestamp}`;
    if (processedIds.has(msgId)) return;
    processedIds.add(msgId);
    if (processedIds.size > 1000) {
      const first = processedIds.values().next().value;
      processedIds.delete(first);
    }

    const body = (msg.body || '').trim();
    const from = msg.from || '';
    const isGroup = from.endsWith('@g.us');
    const chatId = from;

    // Sender name
    let senderName = from.split('@')[0];
    try {
      const contact = await msg.getContact();
      senderName = contact.pushname || contact.name || contact.number || senderName;
    } catch {}

    // Group name
    let chatObj = null;
    let groupName = null;
    if (isGroup) {
      try { chatObj = await msg.getChat(); groupName = chatObj?.name; } catch {}
    }

    console.log(`[MSG IN] ${senderName}${groupName ? ` (${groupName})` : ''} [type:${msg.type||'chat'}]: "${body.substring(0, 80)}${body.length > 80 ? '...' : ''}"`);

    logMessage({
      type: 'incoming', chatId, senderName, isGroup, groupName,
      message: body || '[Media]', hasMedia: msg.hasMedia, timestamp: Date.now(),
    });

    // Settings guards — log the reason so we can debug
    if (!settings.autoReply) {
      console.log(`[MSG SKIP] autoReply off — ${senderName}`);
      return;
    }
    if (isGroup && !settings.replyToGroups) {
      console.log(`[MSG SKIP] replyToGroups off — ${groupName || chatId}`);
      return;
    }
    if (settings.blacklistedChats.has(chatId)) {
      console.log(`[MSG SKIP] blacklisted — ${chatId}`);
      return;
    }
    if (settings.whitelistedOnly && !settings.whitelistedChats.has(chatId)) {
      console.log(`[MSG SKIP] not whitelisted — ${chatId}`);
      return;
    }

    // Skip truly empty system-like messages (no body, no media, plain 'chat' type with nothing)
    // Any non-chat type (image, sticker, video, audio, ptt, location, vcard, document) is valid
    const msgType = msg.type || 'unknown';

    // ── Skip automated/system message types ──────────────────────────────────
    // template / hsm = WhatsApp Business promo blasts (Nagpur Metro, OTP msgs, etc.)
    // interactive   = button/list messages sent by businesses
    // notification_template = system notification
    // e2e_notification, call_log, protocol = internal WhatsApp system events
    const SKIP_TYPES = new Set([
      'template', 'hsm', 'interactive', 'notification_template',
      'e2e_notification', 'call_log', 'protocol', 'gp2', 'broadcast_notification',
    ]);
    if (SKIP_TYPES.has(msgType)) {
      console.log(`[MSG SKIP] automated/system type "${msgType}" from ${senderName} — not replying`);
      return;
    }

    // Also skip if the body looks like a business template (contains a URL and a CTA phrase)
    // e.g. "Welcome to Nagpur Metro\nHi Mr Suraj...\nClick below to book your eTicket"
    const isBusinessTemplate = body.length > 100 && (
      /click\s+below/i.test(body) ||
      /book\s+now/i.test(body) ||
      /tap\s+to\s+(pay|book|confirm|verify)/i.test(body) ||
      /your\s+(otp|one.time.password)\s+is/i.test(body) ||
      /do\s+not\s+share\s+(this|your)\s+otp/i.test(body)
    );
    if (isBusinessTemplate) {
      console.log(`[MSG SKIP] business template body detected from ${senderName} — not replying`);
      return;
    }

    const hasContent = body || msg.hasMedia || !['chat', 'unknown'].includes(msgType);
    if (!hasContent) {
      console.log(`[MSG SKIP] no content — type:${msgType} body:"${body}" hasMedia:${msg.hasMedia}`);
      return;
    }

    // Typing indicator
    if (settings.typingDelay) {
      try {
        if (!chatObj) chatObj = await msg.getChat();
        await chatObj.sendStateTyping();
      } catch {}
    }

    // ── Media extraction ───────────────────────────────────────────────────
    // Build the text we'll send to the agent.
    // For media messages: download, analyse (Gemini Vision / pdf-parse), inject summary.
    let agentMessage = body; // start with text body

    if (msg.hasMedia) {
      try {
        const downloaded = await msg.downloadMedia();
        if (downloaded && downloaded.data) {
          const buf = Buffer.from(downloaded.data, 'base64');
          const mime = downloaded.mimetype || 'application/octet-stream';

          console.log(`[MEDIA] Analyzing ${mime} (${Math.round(buf.length / 1024)} KB) from ${senderName}`);

          const summary = await analyzeMedia(buf, mime, body || '');
          if (summary) {
            // Prepend summary so agent understands the media, then keep caption as context
            agentMessage = body
              ? `[Media content: ${summary}]\nSender caption: "${body}"`
              : `[Media content: ${summary}]`;
            console.log(`[MEDIA] Summary (${mime}): ${summary.substring(0, 120)}`);
          } else {
            // analyzeMedia returned null (unsupported type) — use type label
            const typeLabel = msgType.charAt(0).toUpperCase() + msgType.slice(1);
            agentMessage = body
              ? `[${typeLabel} received] ${body}`
              : `[${typeLabel} received]`;
          }
        } else {
          // downloadMedia returned nothing — use type label
          const typeLabel = msgType.charAt(0).toUpperCase() + msgType.slice(1);
          agentMessage = body ? `[${typeLabel} received] ${body}` : `[${typeLabel} received]`;
        }
      } catch (dlErr) {
        console.warn(`[MEDIA] Download/analysis failed for ${msgType}: ${dlErr.message}`);
        const typeLabel = msgType.charAt(0).toUpperCase() + msgType.slice(1);
        agentMessage = body ? `[${typeLabel} received] ${body}` : `[${typeLabel} received]`;
      }
    } else if (!body) {
      // Non-media, non-text (sticker, location, etc.)
      agentMessage = `[${msgType.charAt(0).toUpperCase() + msgType.slice(1)} message received]`;
    }

    // Process with SK Agent
    const { reply, taskAction, fileRequest } = await skAgent.processMessage(
      chatId, senderName, agentMessage
    );

    // Delay (human-like)
    if (settings.typingDelay) await delay(settings.minDelay, settings.maxDelay);

    // Send text reply
    if (reply) {
      try {
        await client.sendMessage(chatId, reply);
        console.log(`[MSG OUT] → ${senderName}: ${reply.substring(0, 100)}`);
        logMessage({
          type: 'outgoing', chatId, senderName: 'SK Agent',
          isGroup, groupName, message: reply, timestamp: Date.now(),
        });
      } catch (e) {
        console.error('[WhatsApp] Send failed:', e.message);
      }
    }

    // Schedule task if SK agent detected one
    if (taskAction) {
      const task = skAgent.scheduleTask(chatId, senderName, taskAction);
      const confirmMsg = buildTaskConfirmation(task);
      try {
        await client.sendMessage(chatId, confirmMsg);
        logMessage({
          type: 'outgoing', chatId, senderName: 'SK Agent',
          isGroup, groupName, message: confirmMsg, timestamp: Date.now(),
        });
      } catch {}
    }

    // Send file if requested
    if (fileRequest) {
      await handleFileRequest(chatId, fileRequest, senderName);
    }

    // Clear typing
    if (chatObj) { try { await chatObj.clearState(); } catch {} }

  } catch (err) {
    console.error('[WhatsApp] handleIncomingMessage error:', err?.stack || err?.message || String(err));
  }
}

// ── Task due — send reminder/message ─────────────────────────────────────────

async function handleTaskDue(task) {
  try {
    if (!client || clientState !== 'ready') return;
    const msg = task.message || task.description || 'Reminder!';
    const text = `⏰ Reminder: ${msg}`;
    await client.sendMessage(task.chatId, text);
    console.log(`[TASK DUE] Sent to ${task.chatId}: ${text.substring(0, 60)}`);
    logMessage({
      type: 'task_fired', chatId: task.chatId, senderName: 'SK Agent',
      message: text, taskId: task.id, timestamp: Date.now(),
    });
    if (io) io.emit('task_fired', task);
  } catch (err) {
    console.error('[WhatsApp] handleTaskDue error:', err?.message);
  }
}

function buildTaskConfirmation(task) {
  const icon = { reminder: '⏰', scheduled_message: '📨', note: '📝', follow_up: '🔁', recurring: '🔄' }[task.type] || '✅';
  const when = task.triggerAt
    ? new Date(task.triggerAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short', hour12: true })
    : 'noted';
  const recur = task.interval ? ` (repeats every ${msToHuman(task.interval)})` : '';

  const isForOwner = task.isForOwner || (ownerChatId && task.chatId === ownerChatId);

  if (isForOwner) {
    if (task.type === 'note') {
      return `${icon} Got it! I've noted this for ${OWNER_SHORT_NAME} — "${task.description}".`;
    }
    return `${icon} Got it! I'll tell ${OWNER_SHORT_NAME} — "${task.description}" — set for ${when}${recur}.`;
  }

  return `${icon} Got it! "${task.description}" set for ${when}${recur}.`;
}

function msToHuman(ms) {
  if (ms >= 86400000) return `${ms / 86400000} day${ms / 86400000 > 1 ? 's' : ''}`;
  if (ms >= 3600000) return `${ms / 3600000} hour${ms / 3600000 > 1 ? 's' : ''}`;
  if (ms >= 60000) return `${ms / 60000} minute${ms / 60000 > 1 ? 's' : ''}`;
  return `${ms / 1000} seconds`;
}

// ── File request handling ─────────────────────────────────────────────────────

async function handleFileRequest(chatId, fileRequest, senderName) {
  try {
    const matched = await fileManager.findMatchingFile(fileRequest);
    if (!matched) {
      await client.sendMessage(chatId, "I'd love to send that file but I don't have it uploaded yet. Ask the admin to add it!");
      return;
    }
    const media = await fileManager.fileToMessageMedia(matched.path);
    await client.sendMessage(chatId, media, { caption: `Here you go! 📎 ${matched.name}` });
    console.log(`[FILE OUT] → ${senderName}: ${matched.name}`);
    logMessage({
      type: 'outgoing_file', chatId, senderName: 'SK Agent',
      message: `[File: ${matched.name}]`, fileName: matched.name, timestamp: Date.now(),
    });
  } catch (err) {
    console.error('[WhatsApp] handleFileRequest error:', err?.message);
  }
}

// ── Manual send APIs ──────────────────────────────────────────────────────────

async function sendMessage(chatId, text) {
  if (!client || clientState !== 'ready') throw new Error('WhatsApp not connected');
  await client.sendMessage(chatId, text);
}

async function sendFile(chatId, filePath, caption = '') {
  if (!client || clientState !== 'ready') throw new Error('WhatsApp not connected');
  const media = await fileManager.fileToMessageMedia(filePath);
  await client.sendMessage(chatId, media, { caption });
}

async function getChats() {
  if (!client || clientState !== 'ready') return [];
  try {
    const chats = await client.getChats();
    return chats.slice(0, 50).map(c => ({
      id: c.id._serialized,
      name: c.name || c.id.user || c.id._serialized,
      isGroup: c.isGroup,
      unreadCount: c.unreadCount || 0,
      lastMessage: c.lastMessage?.body?.substring(0, 60) || '',
    }));
  } catch (err) {
    console.error('[WhatsApp] getChats error:', err?.message);
    return [];
  }
}

async function logout() {
  try {
    if (client) { await client.logout(); clientState = 'disconnected'; }
  } catch (err) {
    console.error('[WhatsApp] logout error:', err?.message);
  }
}

function getOwnerInfo() {
  return {
    ownerName: OWNER_NAME,
    ownerShortName: OWNER_SHORT_NAME,
    ownerChatId,
  };
}

module.exports = {
  init, getState, getSettings, updateSettings,
  getMessageLog, sendMessage, sendFile, getChats, logout,
  getOwnerInfo,
};
