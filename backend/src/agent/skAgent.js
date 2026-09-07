/**
 * SK Agent - Core Brain
 * - Natural WhatsApp replies (no markdown)
 * - Intent detection: file requests, task scheduling, reminders, notes
 * - Conversation memory per chat
 * - Scheduler integration
 */

const { chat } = require('./llmService');
const memory = require('../memory/conversationMemory');
const scheduler = require('./taskScheduler');

// ── Owner config (set by client on WhatsApp ready) ───────────────────────────────
const ownerConfig = {
  name: process.env.OWNER_NAME || 'Suraj Zalke',
  shortName: process.env.OWNER_SHORT_NAME || 'Suraj',
  chatId: null,
};

function setOwnerConfig(cfg) {
  if (cfg.name) ownerConfig.name = cfg.name;
  if (cfg.shortName) ownerConfig.shortName = cfg.shortName;
  if (cfg.chatId) ownerConfig.chatId = cfg.chatId;
}

function getOwnerConfig() {
  return { ...ownerConfig };
}

// ── System Prompt ──────────────────────────────────────────────────────────────
// Short, clear, NO LEFTOVER EXAMPLES that confuse the LLM

function buildSystemPrompt(senderName, now) {
  const OSN = ownerConfig.shortName;
  return `ROLE: You are ${OSN}'s personal WhatsApp agent/secretary. You work ONLY for ${OSN}.
WHO IS MESSAGING: People who text this number are trying to CONTACT ${OSN}, not you.
YOUR JOB: Reply on ${OSN}'s behalf. When someone gives information or an appointment INTENDED FOR ${OSN}, create a reminder/note TO ${OSN} (not to the sender). Only create reminders FOR THE SENDER when the sender explicitly says "remind me..." / "I need a reminder...".

REPLY RULES:
- Short, natural texting style (1-3 sentences). No markdown, no **, no bullets.
- Match sender's language (English / Hindi / Hinglish).
- GREETINGS (hi, hello, hey, namaste, hii, hlo, good morning, etc.): Reply warmly and briefly. Example: "Hey! How can I help you?" or "Hi there! ${OSN} is not available right now, how can I help?"
- MEDIA messages (images, PDFs, docs): Acknowledge what was sent and confirm you've noted it for ${OSN}. Example: "Got the image, I'll share it with ${OSN}!" or "Thanks for the PDF, I'll pass it along."
- If asked "what's the time / current time / abhi kitne baje", just state "${now}" — no explanation.
- NEVER say "Could you resend the question?" or ask the user to repeat themselves. Always give a helpful response.

TASK FORMAT — append one JSON block AT THE VERY END if a task is needed. Nothing after.
<SK_TASK>
{"type":"reminder|note|follow_up|recurring","description":"what it is","message":"what to say when triggered","timeExpression":"e.g. 6pm today / tomorrow 9am / in 30 min","recipients":"owner|self"}
</SK_TASK>

recipients RULE — CRITICAL:
- "owner" = reminder goes TO ${OSN}. Use this when the message is INFORMATION / MEETING / APPOINTMENT FOR ${OSN}, or the message mentions ${OSN}, "tell suraj", "inform suraj", "suraj ko". This is the DEFAULT.
- "self" = reminder goes to the sender. Use ONLY when sender explicitly says "remind ME" / "mujhe yaad dila".

SIMPLE REPLY EXAMPLES:
- Sender: "Hi" → reply "Hey! ${OSN} is not available right now. How can I help you?"
- Sender: "I need to meet ${OSN} at 6pm" → reply "Got it, I'll let ${OSN} know. 👍" + task recipients:"owner" message:"${senderName} wants to meet you at 6pm"
- Sender: "Tell ${OSN} to call me at 8" → reply "OK, I've noted that for ${OSN}." + task recipients:"owner" message:"Call ${senderName} at 8"
- Sender: "Remind me at 5pm to take medicine" → reply "Done, reminder set." + task recipients:"self"
- Sender sends image → reply "Got the image, I'll pass it to ${OSN}!"
- Sender sends PDF → reply "Thanks for the document, I'll make sure ${OSN} sees it."

IF NO TASK IS NEEDED: Just reply naturally. No block needed.`;
}

// ── Parse SK blocks from LLM reply ────────────────────────────────────────────

function parseBlock(reply, tag) {
  const open = `<${tag}>`, close = `</${tag}>`;
  const selfClose = `<${tag}/>`;
  if (reply.includes(selfClose)) return { found: true, data: null, isSelfClose: true };
  const start = reply.indexOf(open);
  const end = reply.indexOf(close);
  if (start === -1 || end === -1) return { found: false };
  try {
    const json = reply.slice(start + open.length, end).trim();
    return { found: true, data: JSON.parse(json), isSelfClose: false };
  } catch {
    return { found: false };
  }
}

function cleanReply(reply) {
  return reply
    .replace(/<SK_TASK>[\s\S]*?<\/SK_TASK>/g, '')
    .replace(/<SK_FILE>[\s\S]*?<\/SK_FILE>/g, '')
    .replace(/<SK_LIST_TASKS\/>/g, '')
    .replace(/<SK_CANCEL_TASK>[\s\S]*?<\/SK_CANCEL_TASK>/g, '')
    .trim();
}

// ── Intent shortcuts — catch obvious requests before hitting LLM ──────────────

const TASK_KEYWORDS = [
  /remind\s+me/i, /reminder/i, /set\s+alarm/i, /yaad\s+dila/i, /yaad\s+kar/i,
  /schedule/i, /every\s+day/i, /daily\s+at/i, /har\s+roz/i,
  /follow\s+up/i, /note\s*:/i, /note\s+karo/i, /likhlo/i,
  /send\s+.*\s+at\s+\d/i, /kal\s+.*\s+bta/i, /kal\s+.*\s+bhejo/i,
];

const FILE_KEYWORDS = [
  /send\s+(me\s+)?(the\s+)?/i, /share\s+(the\s+)?/i,
  /bhej(o|na)/i, /(pdf|image|photo|pic|document|file|catalogue|menu|invoice|brochure)/i,
];

const LIST_KEYWORDS = [
  /show\s+(my\s+)?(tasks|reminders)/i, /what\s+tasks/i, /list\s+reminders/i,
  /mere\s+tasks/i, /meri\s+reminder/i, /kya\s+tasks/i,
];

const CANCEL_KEYWORDS = [
  /cancel\s+(all\s+)?(reminder|task|alarm)/i,
  /delete\s+(all\s+)?(reminder|task)/i,
  /(reminder|task)\s+cancel/i, /band\s+karo/i,
];

const TIME_KEYWORDS = [
  /(what'?s?|current|abhi)\s+(time|kitne\s+baje|samay)/i,
  /kitne\s+baje/i, /what\s+time\s+(is\s+it|now)/i, /kya\s+samay/i,
];

// If sender wants to TELL/INFORM Suraj of something — force recipients=owner
const INFORM_OWNER_PATTERNS = [
  /(tell|inform|msg|message|batao|bhejo|bta|yaad\s+dila(na|o)?|remind)\s+(\w+\s+)?(suraj|owner|boss|sir|him|unhe|unko)/i,
  /suraj\s+(ko|ko\s+to|se|ke\s+liye)/i,
  /(need|want|going|have|supposed)\s+to\s+(meet|see|call|talk\s+to|contact)\s+suraj/i,
  /meet\s+suraj/i, /suraj\s+(to\s+)?meet/i,
  /meeting\s+(with\s+)?suraj/i,
  /(hai|hain|hey|hi)\s+.*\b(meet|meeting|call|aana|jana|milna|milne|aao)\b/i,
];

// If sender wants a reminder FOR THEMSELVES
const SELF_REMIND_PATTERNS = [
  /remind\s+me/i, /mujhe\s+yaad/i, /mere\s+liye\s+reminder/i, /yaad\s+dila(na)?\s+mujhe/i,
  /(i|main|mera|meri|hum)\s+.*\b(reminder|alarm|yaad)\b/i,
  /set\s+(a\s+)?reminder\s+for\s+me/i,
];

const GREETING_KEYWORDS = [
  /^(hi+|hello|hey|hlo|hii|namaste|namaskar|salaam|good\s+(morning|evening|afternoon|night))[\s!.,]*$/i,
];

function detectIntent(text) {
  if (LIST_KEYWORDS.some(r => r.test(text))) return 'list_tasks';
  if (CANCEL_KEYWORDS.some(r => r.test(text))) return 'cancel_tasks';
  if (TIME_KEYWORDS.some(r => r.test(text))) return 'time';
  if (GREETING_KEYWORDS.some(r => r.test(text.trim()))) return 'greeting';
  if (TASK_KEYWORDS.some(r => r.test(text))) return 'task';
  if (FILE_KEYWORDS.some(r => r.test(text))) return 'file';
  return 'chat';
}

function textMentionsOwner(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  if (INFORM_OWNER_PATTERNS.some(p => p.test(t))) return true;
  if (/suraj|zalke|boss/.test(t)) return true;
  return false;
}

function textSaysSelfRemind(text) {
  if (!text) return false;
  return SELF_REMIND_PATTERNS.some(p => p.test(text));
}

// ── Main process function ──────────────────────────────────────────────────────

async function processMessage(chatId, senderName, message) {
  const now = new Date().toLocaleString('en-IN', {
    dateStyle: 'short', timeStyle: 'short', hour12: true,
  });
  const timeOnly = new Date().toLocaleTimeString('en-IN', { timeStyle: 'short', hour12: true });

  memory.addMessage(chatId, 'user', message);
  const intent = detectIntent(message);
  const mentionsOwner = textMentionsOwner(message);
  const saysSelfRemind = textSaysSelfRemind(message);

  // ── Time shortcut (no LLM) ────────────────────────────────────────────────
  if (intent === 'time') {
    const reply = `Current time is ${timeOnly} (${now}).`;
    memory.addMessage(chatId, 'assistant', reply);
    return { reply, taskAction: null, fileRequest: null };
  }

  // ── Greeting shortcut (no LLM) ────────────────────────────────────────────
  if (intent === 'greeting') {
    const greetings = [
      `Hey! ${ownerConfig.shortName} is not available right now. How can I help you?`,
      `Hi there! I'm ${ownerConfig.shortName}'s assistant. What can I do for you?`,
      `Hello! ${ownerConfig.shortName} is busy right now. Feel free to leave a message!`,
    ];
    const reply = greetings[Math.floor(Math.random() * greetings.length)];
    memory.addMessage(chatId, 'assistant', reply);
    return { reply, taskAction: null, fileRequest: null };
  }

  // ── List tasks without LLM ─────────────────────────────────────────────────
  if (intent === 'list_tasks') {
    const taskList = scheduler.getTasksForChat(chatId);
    const reply = taskList.length === 0
      ? 'You have no active tasks or reminders.'
      : 'Your active tasks:\n' + scheduler.formatTaskList(taskList);
    memory.addMessage(chatId, 'assistant', reply);
    return { reply, taskAction: null, fileRequest: null };
  }

  // ── Cancel tasks without LLM ────────────────────────────────────────────────
  if (intent === 'cancel_tasks') {
    const count = scheduler.cancelAllForChat(chatId);
    const reply = count > 0
      ? `Done! Cancelled ${count} task${count > 1 ? 's' : ''}.`
      : 'No active tasks to cancel.';
    memory.addMessage(chatId, 'assistant', reply);
    return { reply, taskAction: null, fileRequest: null };
  }

  // ── Build messages for LLM ─────────────────────────────────────────────────
  const history = memory.getHistory(chatId);
  const messages = [
    { role: 'system', content: buildSystemPrompt(senderName, now) },
    ...history.map(h => ({ role: h.role, content: h.content })),
  ];

  // ── Call LLM ───────────────────────────────────────────────────────────────
  let rawReply;
  try {
    rawReply = await chat(messages);
  } catch (err) {
    console.error('[SKAgent] LLM error:', err.message);
    // Friendly fallback instead of scary error
    let fb = null;
    if (mentionsOwner) {
      fb = `Got it, I'll let ${ownerConfig.shortName} know about this.`;
    } else if (/\b(hi+|hello|hey|namaste|hlo|hii|kaise\s+ho|kya\s+haal|good\s+(morning|evening|afternoon|night))\b/i.test(message)) {
      fb = `Hey! ${ownerConfig.shortName} is not available right now. How can I help you?`;
    } else if (/\[.*?(image|photo|pdf|video|audio|document|sticker).*?\]/i.test(message)) {
      fb = `Got it! I'll make sure ${ownerConfig.shortName} sees this.`;
    } else {
      fb = `Got your message! ${ownerConfig.shortName} will get back to you shortly.`;
    }
    memory.addMessage(chatId, 'assistant', fb);
    return { reply: fb, taskAction: null, fileRequest: null };
  }

  // ── Parse special blocks ───────────────────────────────────────────────────
  let taskAction = null;
  let fileRequest = null;

  const taskBlock = parseBlock(rawReply, 'SK_TASK');
  if (taskBlock.found && taskBlock.data) {
    taskAction = taskBlock.data;
  }

  const fileBlock = parseBlock(rawReply, 'SK_FILE');
  if (fileBlock.found && fileBlock.data) {
    fileRequest = fileBlock.data;
  }

  const listBlock = parseBlock(rawReply, 'SK_LIST_TASKS');
  if (listBlock.found && listBlock.isSelfClose) {
    const taskList = scheduler.getTasksForChat(chatId);
    const listText = taskList.length === 0
      ? 'No active tasks.'
      : scheduler.formatTaskList(taskList);
    const cleaned = cleanReply(rawReply);
    const reply = cleaned ? `${cleaned}\n\n${listText}` : listText;
    memory.addMessage(chatId, 'assistant', reply);
    return { reply, taskAction: null, fileRequest: null };
  }

  const cancelBlock = parseBlock(rawReply, 'SK_CANCEL_TASK');
  if (cancelBlock.found && cancelBlock.data) {
    const { taskId } = cancelBlock.data;
    if (taskId === 'all') {
      scheduler.cancelAllForChat(chatId);
    } else {
      scheduler.cancelTask(taskId);
    }
  }

  // ── Post-process task: FORCE routing based on keywords ─────────────────────
  if (taskAction) {
    // Sanitize description/message so LLM doesn't leak old sender names like "sangitahmaske"
    if (mentionsOwner && !saysSelfRemind) {
      taskAction.recipients = 'owner';
      if (taskAction.message) {
        const m = taskAction.message.toLowerCase();
        // Only rewrite if the "to suraj" side isn't clear
        if (/(sangita|rahul|priya|old sender|previous sender)/i.test(taskAction.message)) {
          taskAction.message = `${senderName} sent a message: ${message}`;
        }
      }
      taskAction.description = sanitizeDescription(taskAction.description, senderName, ownerConfig.shortName, message);
      if (!taskAction.message) {
        taskAction.message = `From ${senderName}: ${message}`;
      }
    }

    // If user typed reminders for themselves but LLM set owner, flip back
    if (saysSelfRemind && !mentionsOwner) {
      taskAction.recipients = 'self';
    }

    // Default fallback for task+time keywords but no recipients set:
    if (!taskAction.recipients) {
      taskAction.recipients = mentionsOwner ? 'owner' : 'self';
    }
  }

  let reply = cleanReply(rawReply);

  // Guard: LLM returned only a task block with no text — generate a sensible fallback
  if (!reply) {
    if (taskAction) {
      // Task was created for the owner
      if (isOwnerRecipient(taskAction.recipients)) {
        reply = `Got it, I'll let ${ownerConfig.shortName} know. 👍`;
      } else {
        reply = 'Done! Reminder set. ✅';
      }
    } else {
      reply = 'OK, got your message!';
    }
  }

  memory.addMessage(chatId, 'assistant', reply);

  return { reply, taskAction, fileRequest };
}

function sanitizeDescription(desc, senderName, ownerShort, originalMessage) {
  // If LLM hallucinated an old sender name like "sangitahmaske" instead of current sender, fix it
  let d = (desc || '').trim();
  const weirdSender = /(sangitahmaske|unknown|oldcontact|previoussender)/i;
  if (weirdSender.test(d)) {
    d = d.replace(weirdSender, senderName);
  }
  // If description still looks wrong — build a clean one from original message
  if (!d || /^\s*Task\s*$/i.test(d) || weirdSender.test(d)) {
    const short = originalMessage.length > 80 ? originalMessage.slice(0, 77) + '...' : originalMessage;
    d = `${senderName}: ${short}`;
  }
  return d;
}

// ── Schedule a task parsed from LLM output ────────────────────────────────────

function isOwnerRecipient(recipients) {
  if (!recipients) return false;
  const r = String(recipients).toLowerCase().trim();
  return r === 'owner' || r.includes('suraj') || r.includes('boss') || r.includes('zalke');
}

function scheduleTask(chatId, senderName, taskAction) {
  const timeExpr = taskAction.timeExpression || '';
  const parsed = timeExpr ? scheduler.parseTimeExpression(timeExpr) : null;
  const recipients = taskAction.recipients || 'self';

  let targetChatId = chatId;
  let isForOwner = false;

  if (isOwnerRecipient(recipients) && ownerConfig.chatId) {
    targetChatId = ownerConfig.chatId;
    isForOwner = true;
  }

  return scheduler.addTask({
    chatId: targetChatId,
    senderName,
    type: taskAction.type || 'reminder',
    description: taskAction.description || 'Task',
    message: taskAction.message || taskAction.description || 'Reminder!',
    triggerAt: parsed?.triggerAt || null,
    interval: parsed?.interval || null,
    recipients,
    isForOwner,
    originalSenderChatId: chatId,
  });
}

module.exports = { processMessage, scheduleTask, setOwnerConfig, getOwnerConfig, isOwnerRecipient };
