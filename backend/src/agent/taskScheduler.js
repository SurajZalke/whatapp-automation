/**
 * SK Agent - Task Scheduler
 * Handles: reminders, scheduled messages, notes, follow-ups, recurring tasks
 * Persists all tasks to disk. Runs a tick every 30 seconds.
 */

const fs = require('fs-extra');
const path = require('path');
const { EventEmitter } = require('events');

const DATA_FILE = path.join(__dirname, '../../data/tasks.json');
const emitter = new EventEmitter();

// ── Task schema ────────────────────────────────────────────────────────────────
// {
//   id: string,
//   chatId: string,          // who to send to
//   senderName: string,      // who created it
//   type: 'reminder' | 'scheduled_message' | 'note' | 'follow_up' | 'recurring',
//   description: string,     // human readable
//   message: string,         // message to send when triggered
//   triggerAt: number,       // epoch ms (null for notes)
//   interval: number|null,   // ms for recurring (null otherwise)
//   createdAt: number,
//   status: 'pending' | 'done' | 'cancelled',
//   lastRun: number|null,
// }

let tasks = [];
let tickInterval = null;

// ── Persistence ────────────────────────────────────────────────────────────────

async function load() {
  await fs.ensureDir(path.dirname(DATA_FILE));
  try {
    tasks = await fs.readJson(DATA_FILE);
    console.log(`[Scheduler] Loaded ${tasks.length} tasks`);
  } catch {
    tasks = [];
  }
}

async function save() {
  await fs.writeJson(DATA_FILE, tasks, { spaces: 2 });
}

// ── CRUD ───────────────────────────────────────────────────────────────────────

function addTask(task) {
  const t = {
    id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
    status: 'pending',
    lastRun: null,
    ...task,
  };
  tasks.push(t);
  save();
  console.log(`[Scheduler] Task added: [${t.type}] "${t.description}" → trigger at ${t.triggerAt ? new Date(t.triggerAt).toLocaleString() : 'N/A'}`);
  return t;
}

function getTasksForChat(chatId) {
  return tasks.filter(t => t.chatId === chatId && t.status !== 'cancelled');
}

function getAllPending() {
  return tasks.filter(t => t.status === 'pending');
}

function cancelTask(taskId) {
  const t = tasks.find(t => t.id === taskId);
  if (t) { t.status = 'cancelled'; save(); return true; }
  return false;
}

function cancelAllForChat(chatId) {
  let count = 0;
  tasks.forEach(t => {
    if (t.chatId === chatId && t.status === 'pending') {
      t.status = 'cancelled';
      count++;
    }
  });
  if (count > 0) save();
  return count;
}

function getNotes(chatId) {
  return tasks.filter(t => t.chatId === chatId && t.type === 'note' && t.status === 'pending');
}

// ── Tick: fire due tasks ───────────────────────────────────────────────────────

function tick() {
  const now = Date.now();
  let changed = false;

  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    if (!task.triggerAt) continue;
    if (task.triggerAt > now) continue;

    // Fire!
    console.log(`[Scheduler] Firing task: ${task.id} — ${task.description}`);
    emitter.emit('task_due', task);

    if (task.type === 'recurring' && task.interval) {
      // Reschedule
      task.triggerAt = now + task.interval;
      task.lastRun = now;
    } else {
      task.status = 'done';
      task.lastRun = now;
    }
    changed = true;
  }

  if (changed) save();
}

function start() {
  if (tickInterval) return;
  tickInterval = setInterval(tick, 30000); // check every 30s
  tick(); // immediate first check
  console.log('[Scheduler] Started — checking tasks every 30s');
}

function stop() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

// ── Natural language time parser ───────────────────────────────────────────────
// Parses things like: "in 5 minutes", "at 3pm", "tomorrow 9am", "every day at 8am"

function parseTimeExpression(text, refTime = Date.now()) {
  const lower = text.toLowerCase().trim();
  const now = new Date(refTime);

  // "in X minutes/hours/days"
  const inMatch = lower.match(/in\s+(\d+)\s*(min|minute|hour|hr|day|week|second|sec)/);
  if (inMatch) {
    const n = parseInt(inMatch[1]);
    const unit = inMatch[2];
    const ms = {
      sec: 1000, second: 1000,
      min: 60000, minute: 60000,
      hr: 3600000, hour: 3600000,
      day: 86400000,
      week: 604800000,
    }[unit] || 60000;
    return { triggerAt: refTime + n * ms, interval: null, isRecurring: false };
  }

  // "every X minutes/hours/days"
  const everyMatch = lower.match(/every\s+(\d+)?\s*(min|minute|hour|hr|day|week)/);
  if (everyMatch) {
    const n = parseInt(everyMatch[1] || '1');
    const unit = everyMatch[2];
    const ms = {
      min: 60000, minute: 60000,
      hr: 3600000, hour: 3600000,
      day: 86400000,
      week: 604800000,
    }[unit] || 3600000;

    // Check for "at X time" in the same expression
    const atTime = parseClockTime(lower, now);
    const firstTrigger = atTime || (refTime + ms);
    return { triggerAt: firstTrigger, interval: n * ms, isRecurring: true };
  }

  // "every day at Xam/pm" / "daily at X"
  if (lower.match(/every\s+day|daily/)) {
    const atTime = parseClockTime(lower, now);
    const trigger = atTime || (refTime + 86400000);
    return { triggerAt: trigger, interval: 86400000, isRecurring: true };
  }

  // "tomorrow at X" / "tomorrow X"
  if (lower.includes('tomorrow')) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const atTime = parseClockTime(lower, tomorrow);
    if (atTime) return { triggerAt: atTime, interval: null, isRecurring: false };
    tomorrow.setHours(9, 0, 0, 0);
    return { triggerAt: tomorrow.getTime(), interval: null, isRecurring: false };
  }

  // "at 3pm", "at 15:30", "at 9am"
  const atTime = parseClockTime(lower, now);
  if (atTime) {
    // If the time has already passed today, schedule for tomorrow
    const trigger = atTime > refTime ? atTime : atTime + 86400000;
    return { triggerAt: trigger, interval: null, isRecurring: false };
  }

  // "tonight", "this evening" → 8pm today
  if (lower.match(/tonight|this evening/)) {
    const t = new Date(now); t.setHours(20, 0, 0, 0);
    return { triggerAt: t > now ? t.getTime() : t.getTime() + 86400000, interval: null, isRecurring: false };
  }

  // "morning" → 9am
  if (lower.match(/this morning|morning/)) {
    const t = new Date(now); t.setHours(9, 0, 0, 0);
    return { triggerAt: t > now ? t.getTime() : t.getTime() + 86400000, interval: null, isRecurring: false };
  }

  return null;
}

function parseClockTime(text, refDate) {
  // 12h: "3pm", "3:30pm", "3:30 pm"
  const match12 = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = parseInt(match12[2] || '0');
    const ampm = match12[3];
    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    const d = new Date(refDate);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  // 24h: "15:30", "09:00"
  const match24 = text.match(/\b(\d{1,2}):(\d{2})\b/);
  if (match24) {
    const d = new Date(refDate);
    d.setHours(parseInt(match24[1]), parseInt(match24[2]), 0, 0);
    return d.getTime();
  }
  return null;
}

// ── Format task list for WhatsApp ─────────────────────────────────────────────

function formatTaskList(taskList) {
  if (taskList.length === 0) return 'No active tasks.';
  return taskList.map((t, i) => {
    const when = t.triggerAt
      ? new Date(t.triggerAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
      : 'no time set';
    const icon = { reminder: '⏰', scheduled_message: '📨', note: '📝', follow_up: '🔁', recurring: '🔄' }[t.type] || '•';
    return `${icon} ${t.description} — ${when}`;
  }).join('\n');
}

module.exports = {
  load, start, stop, save,
  addTask, getTasksForChat, getAllPending,
  cancelTask, cancelAllForChat, getNotes,
  parseTimeExpression, formatTaskList,
  on: (event, cb) => emitter.on(event, cb),
};
