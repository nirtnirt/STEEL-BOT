const express = require('express');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

const SB_URL = 'https://wgnxokqtysahkceyysjm.supabase.co';
const SB_KEY = 'sb_publishable_JDxbNlh9GS5vot_kiWT4BA_Hr0KgLyB';

// ── CONVERSATION STATE (in-memory) ────────────────────────────────────────
// שומר את מצב השיחה לכל משתמש
const conversations = {};

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

// ── UPLOAD FILE TO SUPABASE STORAGE ──────────────────────────────────────
async function uploadFileFromUrl(mediaUrl, mediaType, fileName) {
  try {
    const TWILIO_SID = process.env.TWILIO_SID;
    const TWILIO_TOKEN = process.env.TWILIO_TOKEN;
    
    console.log('Uploading file:', mediaUrl, 'type:', mediaType);
    console.log('Twilio SID exists:', !!TWILIO_SID);
    console.log('Twilio TOKEN exists:', !!TWILIO_TOKEN);
    
    const fileRes = await fetch(mediaUrl, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64') }
    });
    
    console.log('File download status:', fileRes.status);
    
    if (!fileRes.ok) {
      console.error('Failed to download file:', fileRes.status, fileRes.statusText);
      return null;
    }
    
    const buffer = await fileRes.arrayBuffer();
    console.log('File size:', buffer.byteLength);
    
    const ext = mediaType.split('/')[1] || 'bin';
    const safeName = Date.now().toString();
    const path = `whatsapp/${safeName}.${ext}`;
    
    const uploadRes = await fetch(`${SB_URL}/storage/v1/object/project-files/${path}`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': mediaType,
      },
      body: buffer
    });
    
    console.log('Upload status:', uploadRes.status);
    const uploadBody = await uploadRes.text();
    console.log('Upload response:', uploadBody);
    
    if (!uploadRes.ok) return null;
    return `${SB_URL}/storage/v1/object/public/project-files/${path}`;
  } catch(e) {
    console.error('Upload error:', e.message);
    return null;
  }
}

// ── TWIML RESPONSE ────────────────────────────────────────────────────────
function twimlReply(res, message) {
  res.set('Content-Type', 'text/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`);
}

function now() {
  return new Date().toLocaleDateString('he-IL');
}

// ── WEBHOOK ───────────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  const from = req.body.From?.replace('whatsapp:', '') || '';
  const body = (req.body.Body || '').trim();
  const lower = body.toLowerCase();
  const numMedia = parseInt(req.body.NumMedia || '0');
  const mediaUrl = req.body.MediaUrl0;
  const mediaType = req.body.MediaContentType0 || 'application/octet-stream';

  try {
    // ── אם יש קובץ מצורף ──
    if (numMedia > 0 && mediaUrl) {
      const conv = conversations[from];
      
      if (conv && conv.waitingForFile) {
        // יש שיחה פתוחה שמחכה לקובץ
        const fileUrl = await uploadFileFromUrl(mediaUrl, mediaType, conv.project);
        
        if (fileUrl) {
          // עדכן את הרשומה עם קישור לקובץ
          if (conv.recordId) {
            await sbPatch(conv.table, conv.recordId, { files: [fileUrl] });
          }
          delete conversations[from];
          return twimlReply(res, `✅ הקובץ הועלה ושויך!\n📁 ${conv.project}\n🔗 הקובץ זמין באפליקציה`);
        } else {
          delete conversations[from];
          return twimlReply(res, `⚠️ לא הצלחתי להעלות את הקובץ. נסה שוב.`);
        }
      } else {
        // קובץ ללא שיחה פתוחה
        return twimlReply(res, `📎 קיבלתי קובץ!\nלאיזה פרויקט לשייך אותו?\nשלח: שם הפרויקט`);
      }
    }

    // ── אם יש שיחה פתוחה שמחכה לשם פרויקט לקובץ ──
    if (conversations[from]?.waitingForProjectName) {
      const project = body.trim();
      conversations[from].project = project;
      conversations[from].waitingForProjectName = false;
      conversations[from].waitingForFile = true;
      return twimlReply(res, `📁 פרויקט: ${project}\nעכשיו שלח את הקובץ 📎`);
    }

    // ── עזרה ──
    if (lower === 'עזרה' || lower === 'help' || lower === '?') {
      return twimlReply(res,
        `🤖 Steel Control Bot\n━━━━━━━━━━━━━━━\n\n` +
        `📝 הערה חדשה:\n[פרויקט] - [הערה]\nדוגמה: תולדות - חסר פלטה 150\n\n` +
        `💰 תמחור חדש:\nתמחורים - [שם פרויקט]\n\n` +
        `📋 סיכום פרויקט:\nסיכום [שם]\n\n` +
        `📂 כל הפתוח:\nמה פתוח?\n\n` +
        `✅ סגור:\nסגור [תיאור]`
      );
    }

    // ── סיכום פרויקט ──
    if (lower.startsWith('סיכום ')) {
      const projectName = body.substring(6).trim();
      const tasks = await sbGet('tasks', `project=ilike.*${encodeURIComponent(projectName)}*`);
      if (!tasks.length) return twimlReply(res, `❌ לא נמצאו הערות לפרויקט: ${projectName}`);

      const open = tasks.filter(t => !t.done);
      const closed = tasks.filter(t => t.done);
      let msg = `📋 סיכום: ${projectName}\n━━━━━━━━━━━━━━━\n`;
      if (open.length) { msg += `\n🔴 פתוח (${open.length}):\n`; open.forEach(t => { msg += `• ${t.description}\n`; }); }
      if (closed.length) { msg += `\n✅ טופל (${closed.length}):\n`; closed.forEach(t => { msg += `• ${t.description}\n`; }); }
      return twimlReply(res, msg);
    }

    // ── מה פתוח ──
    if (lower === 'מה פתוח?' || lower === 'מה פתוח' || lower === 'כל הפתוח') {
      const tasks = await sbGet('tasks', 'done=eq.false');
      if (!tasks.length) return twimlReply(res, '✅ אין משימות פתוחות!');
      const byProject = {};
      tasks.forEach(t => { const p = t.project || 'כללי'; if (!byProject[p]) byProject[p] = []; byProject[p].push(t); });
      let msg = `📋 כל הפתוח:\n━━━━━━━━━━━━━━━\n`;
      Object.entries(byProject).forEach(([proj, items]) => { msg += `\n📁 ${proj} (${items.length})\n`; items.forEach(t => { msg += `• ${t.description}\n`; }); });
      return twimlReply(res, msg);
    }

    // ── סגור משימה ──
    if (lower.startsWith('סגור ')) {
      const desc = body.substring(5).trim();
      const tasks = await sbGet('tasks', `description=ilike.*${encodeURIComponent(desc)}*&done=eq.false`);
      if (!tasks.length) return twimlReply(res, `❌ לא נמצאה משימה: "${desc}"`);
      await sbPatch('tasks', tasks[0].id, { done: true });
      return twimlReply(res, `✅ סומן כטופל:\n"${tasks[0].description}"\nפרויקט: ${tasks[0].project}`);
    }

    // ── הוספת הערה: "פרויקט - תיאור" ──
    const sep = body.includes(' - ') ? ' - ' : body.includes(': ') ? ': ' : null;
    if (sep) {
      const [projectRaw, ...descParts] = body.split(sep);
      const project = projectRaw.trim();
      const description = descParts.join(sep).trim();

      let table = 'tasks';
      let row = {};
      let savedId = null;

      if (project === 'תמחורים') {
        // שמור בתמחורים עם מספר השולח כסוכן
        table = 'pricing';
        const agentName = `וואטסאפ (${from.slice(-4)})`; // 4 ספרות אחרונות
        row = {
          agent: agentName, project: description, description: '',
          category: '', status: 'ממתין', weight: '–', date: now(),
          urgent: false, files: [], submitted_price: '', closed_price: '',
          submitted: false, archived: false
        };
        const result = await sbPost(table, row);
        savedId = Array.isArray(result) ? result[0]?.id : result?.id;
        
        // שמור מצב שיחה
        conversations[from] = { waitingForFile: true, project: description, table, recordId: savedId };
        
        return twimlReply(res, `✅ נשמר בתמחורים!\n📋 ${description}\n\nהאם יש קובץ לשייך? 📎\nשלח קובץ עכשיו או כתוב "לא" לדלג`);
      } else {
        // שמור במשימות
        row = {
          client: '', project, type: 'הערה מוואטסאפ', description,
          due_date: '', urgent: false, reminder_date: '', reminder_time: '',
          files: [], done: false
        };
        const result = await sbPost(table, row);
        savedId = Array.isArray(result) ? result[0]?.id : result?.id;
        
        // שמור מצב שיחה
        conversations[from] = { waitingForFile: true, project, table, recordId: savedId };
        
        return twimlReply(res, `✅ נשמר!\n📁 ${project}\n📝 ${description}\n\nהאם יש קובץ לשייך? 📎\nשלח קובץ עכשיו או כתוב "לא" לדלג`);
      }
    }

    // ── "לא" – לדלג על קובץ ──
    if (lower === 'לא' || lower === 'no' || lower === 'skip') {
      if (conversations[from]) {
        const proj = conversations[from].project;
        delete conversations[from];
        return twimlReply(res, `👍 בסדר, נשמר ללא קובץ\nפרויקט: ${proj}`);
      }
    }

    // ── לא הובן ──
    twimlReply(res, `לא הבנתי 🤔\nשלח "עזרה" לרשימת הפקודות`);

  } catch(err) {
    console.error(err);
    twimlReply(res, '❌ שגיאה, נסה שוב');
  }
});

app.get('/', (req, res) => res.send('Steel Control Bot 🤖 is running!'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot running on port ${PORT}`));
