const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const SB_URL = 'https://wgnxokqtysahkceyysjm.supabase.co';
const SB_KEY = 'sb_publishable_JDxbNlh9GS5vot_kiWT4BA_Hr0KgLyB';

// ── SUPABASE ──────────────────────────────────────────────────────────────
async function sbGet(table, filter = '') {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}&order=created_at.desc`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    return await res.json();
  } catch(e) { return []; }
}

async function sbPost(table, row) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(row)
    });
    return await res.json();
  } catch(e) { return null; }
}

async function sbPatch(table, id, updates) {
  try {
    await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
  } catch(e) {}
}

// ── TWIML RESPONSE (no Twilio client needed) ──────────────────────────────
function twimlReply(res, message) {
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`);
}

function now() {
  return new Date().toLocaleDateString('he-IL');
}

// ── WEBHOOK ───────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const body = (req.body.Body || '').trim();
  const lower = body.toLowerCase();

  try {
    // עזרה
    if (lower === 'עזרה' || lower === 'help' || lower === '?') {
      return twimlReply(res,
        `🤖 Steel Control Bot\n` +
        `━━━━━━━━━━━━━━━\n\n` +
        `📝 הערה חדשה:\n[פרויקט] - [הערה]\nדוגמה: תולדות - חסר פלטה 150\n\n` +
        `📋 סיכום פרויקט:\nסיכום [שם]\n\n` +
        `📂 כל הפתוח:\nמה פתוח?\n\n` +
        `✅ סגור:\nסגור [תיאור]`
      );
    }

    // סיכום פרויקט
    if (lower.startsWith('סיכום ')) {
      const projectName = body.substring(6).trim();
      const tasks = await sbGet('tasks', `project=ilike.*${encodeURIComponent(projectName)}*`);

      if (!tasks.length) {
        return twimlReply(res, `❌ לא נמצאו הערות לפרויקט: ${projectName}`);
      }

      const open = tasks.filter(t => !t.done);
      const closed = tasks.filter(t => t.done);

      let msg = `📋 סיכום: ${projectName}\n━━━━━━━━━━━━━━━\n`;
      if (open.length) {
        msg += `\n🔴 פתוח (${open.length}):\n`;
        open.forEach(t => { msg += `• ${t.description}\n`; });
      }
      if (closed.length) {
        msg += `\n✅ טופל (${closed.length}):\n`;
        closed.forEach(t => { msg += `• ${t.description}\n`; });
      }
      return twimlReply(res, msg);
    }

    // מה פתוח
    if (lower === 'מה פתוח?' || lower === 'מה פתוח' || lower === 'כל הפתוח') {
      const tasks = await sbGet('tasks', 'done=eq.false');
      if (!tasks.length) return twimlReply(res, '✅ אין משימות פתוחות!');

      const byProject = {};
      tasks.forEach(t => {
        const p = t.project || 'כללי';
        if (!byProject[p]) byProject[p] = [];
        byProject[p].push(t);
      });

      let msg = `📋 כל הפתוח:\n━━━━━━━━━━━━━━━\n`;
      Object.entries(byProject).forEach(([proj, items]) => {
        msg += `\n📁 ${proj} (${items.length})\n`;
        items.forEach(t => { msg += `• ${t.description}\n`; });
      });
      return twimlReply(res, msg);
    }

    // סגור משימה
    if (lower.startsWith('סגור ')) {
      const desc = body.substring(5).trim();
      const tasks = await sbGet('tasks', `description=ilike.*${encodeURIComponent(desc)}*&done=eq.false`);
      if (!tasks.length) return twimlReply(res, `❌ לא נמצאה משימה: "${desc}"`);

      await sbPatch('tasks', tasks[0].id, { done: true });
      return twimlReply(res, `✅ סומן כטופל:\n"${tasks[0].description}"\nפרויקט: ${tasks[0].project}`);
    }

    // הוספת הערה: "פרויקט - תיאור"
    const sep = body.includes(' - ') ? ' - ' : body.includes(': ') ? ': ' : null;
    if (sep) {
      const [projectRaw, ...descParts] = body.split(sep);
      const project = projectRaw.trim();
      const description = descParts.join(sep).trim();

      await sbPost('tasks', {
        client: '',
        project,
        type: 'הערה מוואטסאפ',
        description,
        due_date: '',
        urgent: false,
        reminder_date: '',
        reminder_time: '',
        files: [],
        done: false
      });

      return twimlReply(res, `✅ נשמר!\n📁 ${project}\n📝 ${description}\n\nלסיכום שלח:\nסיכום ${project}`);
    }

    // לא הובן
    twimlReply(res, `לא הבנתי 🤔\nשלח "עזרה" לרשימת הפקודות`);

  } catch(err) {
    console.error(err);
    twimlReply(res, '❌ שגיאה, נסה שוב');
  }
});

app.get('/', (req, res) => res.send('Steel Control Bot 🤖 is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));


// ── SUPABASE HELPERS ──────────────────────────────────────────────────────
async function sbGet(table, filter = '') {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?${filter}&order=created_at.desc`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  return res.json();
}

async function sbPost(table, row) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row)
  });
  return res.json();
}

// ── SEND WHATSAPP ─────────────────────────────────────────────────────────
async function sendMsg(to, body) {
  await twilio.messages.create({ from: TWILIO_WA, to: `whatsapp:${to}`, body });
}

// ── NOW ───────────────────────────────────────────────────────────────────
function now() {
  return new Date().toLocaleDateString('he-IL', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

// ── BOT LOGIC ─────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  const from = req.body.From?.replace('whatsapp:', '');
  const body = (req.body.Body || '').trim();
  const lower = body.toLowerCase();

  if (!from || !body) return;

  try {
    // ── סיכום פרויקט ──
    if (lower.startsWith('סיכום ')) {
      const projectName = body.substring(6).trim();
      const tasks = await sbGet('tasks', `project=ilike.*${encodeURIComponent(projectName)}*`);
      
      if (!tasks.length) {
        return sendMsg(from, `❌ לא נמצאו משימות/הערות לפרויקט: ${projectName}`);
      }

      const open   = tasks.filter(t => !t.done);
      const closed = tasks.filter(t => t.done);

      let msg = `📋 *סיכום: ${projectName}*\n`;
      msg += `━━━━━━━━━━━━━━━\n`;

      if (open.length) {
        msg += `\n🔴 *פתוח (${open.length}):*\n`;
        open.forEach(t => { msg += `• ${t.description}${t.due_date ? ` (${t.due_date})` : ''}\n`; });
      }

      if (closed.length) {
        msg += `\n✅ *טופל (${closed.length}):*\n`;
        closed.forEach(t => { msg += `• ${t.description}\n`; });
      }

      return sendMsg(from, msg);
    }

    // ── סיכום כל הפרויקטים ──
    if (lower === 'מה פתוח?' || lower === 'מה פתוח' || lower === 'כל הפתוח') {
      const tasks = await sbGet('tasks', 'done=eq.false');

      if (!tasks.length) return sendMsg(from, '✅ אין משימות פתוחות!');

      // Group by project
      const byProject = {};
      tasks.forEach(t => {
        const p = t.project || 'כללי';
        if (!byProject[p]) byProject[p] = [];
        byProject[p].push(t);
      });

      let msg = `📋 *כל המשימות הפתוחות:*\n━━━━━━━━━━━━━━━\n`;
      Object.entries(byProject).forEach(([proj, items]) => {
        msg += `\n📁 *${proj}* (${items.length})\n`;
        items.forEach(t => { msg += `• ${t.description}\n`; });
      });

      return sendMsg(from, msg);
    }

    // ── סגור משימה ──
    if (lower.startsWith('סגור ')) {
      const desc = body.substring(5).trim();
      const tasks = await sbGet('tasks', `description=ilike.*${encodeURIComponent(desc)}*&done=eq.false`);
      
      if (!tasks.length) return sendMsg(from, `❌ לא נמצאה משימה פתוחה: "${desc}"`);

      const task = tasks[0];
      await fetch(`${SB_URL}/rest/v1/tasks?id=eq.${task.id}`, {
        method: 'PATCH',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ done: true })
      });

      return sendMsg(from, `✅ סומן כטופל: "${task.description}" (${task.project})`);
    }

    // ── עזרה ──
    if (lower === 'עזרה' || lower === 'help' || lower === '?') {
      return sendMsg(from, 
        `🤖 *Steel Control Bot*\n━━━━━━━━━━━━━━━\n\n` +
        `📝 *הוספת הערה:*\n[פרויקט] - [הערה]\nדוגמה: תולדות - חסר פלטה 150\n\n` +
        `📋 *סיכום פרויקט:*\nסיכום [שם פרויקט]\n\n` +
        `📂 *כל הפתוח:*\nמה פתוח?\n\n` +
        `✅ *סגור משימה:*\nסגור [תיאור]`
      );
    }

    // ── הוספת הערה/משימה (ברירת מחדל) ──
    // פורמט: "שם פרויקט - תיאור" או "שם פרויקט: תיאור"
    const separator = body.includes(' - ') ? ' - ' : body.includes(': ') ? ': ' : null;

    if (separator) {
      const [projectRaw, ...descParts] = body.split(separator);
      const project = projectRaw.trim();
      const description = descParts.join(separator).trim();

      await sbPost('tasks', {
        client: '',
        project,
        type: 'הערה מוואטסאפ',
        description,
        due_date: '',
        urgent: false,
        reminder_date: '',
        reminder_time: '',
        files: [],
        done: false
      });

      return sendMsg(from, `✅ נשמר!\n📁 *${project}*\n📝 ${description}\n\nלסיכום: "סיכום ${project}"`);
    }

    // ── לא הובן ──
    sendMsg(from, `לא הבנתי 🤔\nשלח "עזרה" לרשימת הפקודות`);

  } catch (err) {
    console.error(err);
    sendMsg(from, '❌ שגיאה בשרת, נסה שוב');
  }
});

app.get('/', (req, res) => res.send('Steel Control Bot 🤖 is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
