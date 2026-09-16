/* ══════════════════════════════════════════════════════════════
   Steel Control — בוט וואטסאפ (Twilio → Supabase)
   גרסה 3: מתחבר כמשתמש אמיתי, עובר דרך RLS, מאמת שהבקשה
   באמת הגיעה מטוויליו, ומגביל למספרים מורשים בלבד.

   מה חדש ב-3: הבוט אינו מנחש לבד לאן הודעה שייכת. הוא מעביר
   אותה ל-Edge Function «bot-route», שקוראת את חוקי השיוך שניר
   הגדיר במסך «חוקי הבוט», שולחת אותם לקלוד יחד עם הכרטיסים
   הפתוחים, ומקבלת החלטה. כך שינוי בחוקים נכנס לתוקף מיד, בלי
   לפרוס את הבוט מחדש, והמפתח של קלוד לא יושב כאן בכלל.
   ══════════════════════════════════════════════════════════════ */

const express = require('express')
const crypto = require('crypto')
const twilioLib = require('twilio')
const { createClient } = require('@supabase/supabase-js')

// ── קונפיגורציה: הכול ממשתני סביבה, שום סוד לא יושב בקוד ─────
const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_WHATSAPP_FROM = 'whatsapp:+14155238886',
  SUPABASE_URL = 'https://wgnxokqtysahkceyysjm.supabase.co',
  SUPABASE_ANON_KEY,
  BOT_USERNAME = 'בוט-וואטסאפ',
  BOT_PASSWORD,
  ALLOWED_NUMBERS = '',          // "+972501234567,+972521111111" — ריק = כולם (לא מומלץ)
  PUBLIC_URL = '',               // כתובת השירות ב-Render, לאימות חתימת טוויליו
  PORT = 3000,
} = process.env

const required = { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, SUPABASE_ANON_KEY, BOT_PASSWORD }
for (const [k, v] of Object.entries(required)) {
  if (!v) { console.error(`✖ חסר משתנה סביבה: ${k}`); process.exit(1) }
}

const twilio = twilioLib(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: true },
})

const allowList = ALLOWED_NUMBERS.split(',').map(s => s.trim()).filter(Boolean)
const isAllowed = num => allowList.length === 0 || allowList.includes(num)

// ── התחברות לסופאבייס כמשתמש הבוט ────────────────────────────
const usernameToEmail = u =>
  'u' + crypto.createHash('sha256').update(String(u).trim().toLowerCase(), 'utf8').digest('hex')
  + '@steel-control.app'

let botProfile = null
let signInPromise = null

async function ensureSignedIn() {
  const { data: { session } } = await supabase.auth.getSession()
  if (session && botProfile) return
  if (!signInPromise) {
    signInPromise = (async () => {
      const email = usernameToEmail(BOT_USERNAME)
      const { error } = await supabase.auth.signInWithPassword({ email, password: BOT_PASSWORD })
      if (error) throw new Error(`התחברות הבוט ל-Supabase נכשלה: ${error.message}`)
      const { data: me } = await supabase.from('profiles').select('*').limit(1)
        .eq('username', BOT_USERNAME).maybeSingle()
      botProfile = me
      if (!me?.approved) throw new Error('חשבון הבוט קיים אך אינו מאושר — אשר אותו במסך «משתמשים»')
      console.log(`✔ הבוט מחובר כ-${me.display_name}`)
    })().finally(() => { signInPromise = null })
  }
  return signInPromise
}

// ── שליחת הודעה חזרה לוואטסאפ ────────────────────────────────
async function reply(to, body) {
  try {
    await twilio.messages.create({ from: TWILIO_WHATSAPP_FROM, to: `whatsapp:${to}`, body })
  } catch (e) {
    console.error('שליחת הודעה נכשלה:', e.message)
  }
}

// ── העלאת מדיה מוואטסאפ לאחסון של סופאבייס ───────────────────
async function saveMedia(req, taskKey) {
  const count = parseInt(req.body.NumMedia || '0', 10)
  if (!count) return []
  const files = []
  for (let i = 0; i < count; i++) {
    const url = req.body[`MediaUrl${i}`]
    const type = req.body[`MediaContentType${i}`] || 'application/octet-stream'
    if (!url) continue
    try {
      const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64')
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } })
      if (!res.ok) { console.error('הורדת מדיה נכשלה:', res.status); continue }
      const buf = Buffer.from(await res.arrayBuffer())
      const ext = (type.split('/')[1] || 'bin').split(';')[0]
      const name = `whatsapp_${Date.now()}_${i}.${ext}`
      const path = `tasks/whatsapp/${taskKey}/${name}`
      const { error } = await supabase.storage.from('project-files').upload(path, buf, { contentType: type })
      if (error) { console.error('העלאה לאחסון נכשלה:', error.message); continue }
      files.push({ name, path, size: buf.length, type })
    } catch (e) {
      console.error('טיפול במדיה נכשל:', e.message)
    }
  }
  return files
}

// ── פקודות ───────────────────────────────────────────────────
const HELP =
  `🤖 *Steel Control*\n━━━━━━━━━━━━━━━\n\n` +
  `📝 *פשוט כתוב מה קרה.*\nאני מבין לבד לאיזה מסך ולאיזה\n` +
  `פרויקט זה שייך ומכניס לשם.\n` +
  `לדוגמה: "הגיעו הפרופילים לדוניץ"\n` +
  `אפשר לצרף תמונה.\n` +
  `אם לא אהיה בטוח — זה יחכה לשיוך במשימות.\n\n` +
  `📋 *סיכום פרויקט:*\nסיכום [שם פרויקט]\n\n` +
  `📂 *כל הפתוח:*\nמה פתוח?\n\n` +
  `✅ *סגירת משימה:*\nסגור [תיאור]\n\n` +
  `❓ עזרה`

/* שם לשולח — המספר הוא מה שיש, והוא מופיע בהערה שנכתבת
   באפליקציה כדי שיהיה ברור מי כתב. */
const senderName = from => String(from || '').replace(/^whatsapp:/, '')

const fmtDate = d => (d ? new Date(d).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) : '')

async function handle(req, from, body) {
  const lower = body.toLowerCase()

  // ── עזרה ──
  if (['עזרה', 'help', '?'].includes(lower)) return HELP

  // ── סיכום פרויקט ──
  if (lower.startsWith('סיכום ')) {
    const project = body.slice(6).trim()
    const { data, error } = await supabase.from('tasks').select('*')
      .ilike('project', `%${project}%`).order('created_at', { ascending: false }).limit(80)
    if (error) throw error
    if (!data.length) return `❌ לא נמצאו משימות לפרויקט: ${project}`

    const open = data.filter(t => !t.done)
    const closed = data.filter(t => t.done)
    let msg = `📋 *סיכום: ${project}*\n━━━━━━━━━━━━━━━\n`
    if (open.length) {
      msg += `\n🔴 *פתוח (${open.length}):*\n`
      open.forEach(t => { msg += `• ${t.description || t.project}${t.due_date ? ` (${fmtDate(t.due_date)})` : ''}\n` })
    }
    if (closed.length) {
      msg += `\n✅ *טופל (${closed.length}):*\n`
      closed.slice(0, 15).forEach(t => { msg += `• ${t.description || t.project}\n` })
    }
    return msg
  }

  // ── כל הפתוח ──
  if (['מה פתוח?', 'מה פתוח', 'כל הפתוח'].includes(lower)) {
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('done', false).order('created_at', { ascending: false }).limit(120)
    if (error) throw error
    if (!data.length) return '✅ אין משימות פתוחות!'

    const byProject = {}
    data.forEach(t => { const p = t.project || 'כללי'; (byProject[p] ||= []).push(t) })
    let msg = `📋 *כל המשימות הפתוחות:*\n━━━━━━━━━━━━━━━\n`
    Object.entries(byProject).forEach(([p, items]) => {
      msg += `\n📁 *${p}* (${items.length})\n`
      items.forEach(t => { msg += `• ${t.description || '—'}\n` })
    })
    return msg
  }

  // ── סגירת משימה ──
  if (lower.startsWith('סגור ')) {
    const q = body.slice(5).trim()
    const { data, error } = await supabase.from('tasks').select('*')
      .eq('done', false).ilike('description', `%${q}%`)
      .order('created_at', { ascending: false }).limit(5)
    if (error) throw error
    if (!data.length) return `❌ לא נמצאה משימה פתוחה: "${q}"`
    if (data.length > 1) {
      let msg = `נמצאו ${data.length} משימות פתוחות שמתאימות ל-"${q}":\n`
      data.forEach(t => { msg += `• ${t.description} (${t.project})\n` })
      return msg + `\nהיה יותר ספציפי כדי שאדע איזו לסגור.`
    }
    const t = data[0]
    const { error: upErr } = await supabase.from('tasks')
      .update({ done: true, status: 'done' }).eq('id', t.id)
    if (upErr) throw upErr
    return `✅ סומן כטופל: "${t.description}" (${t.project})`
  }

  /* ── כל השאר: קלוד מחליט לאן זה שייך ──────────────────────
     אין יותר פורמט חובה. «פרויקט - הערה» עדיין עובד, כי הוא
     פשוט טקסט שקל להבין ממנו — אבל הוא כבר לא תנאי. */
  const files = await saveMedia(req, `${Date.now()}`)

  const { data, error } = await supabase.functions.invoke('bot-route', {
    body: { body, sender: senderName(from), from_number: from, files },
  })
  if (error) {
    console.error('bot-route נכשל:', error.message)
    /* כשל בשיוך אסור שיבליע הודעה. היא נכנסת כמשימה שממתינה
       לשיוך, בדיוק כמו הודעה שלא הובנה. */
    await supabase.rpc('bot_ingest', { p: {
      from_number: from, sender: senderName(from), body, note: body, files,
      reason: 'השיוך האוטומטי נכשל: ' + error.message,
    } })
    return `📥 נקלט, אבל השיוך האוטומטי לא עבד כרגע.\nזה ממתין לשיוך במסך «משימות».`
  }
  if (data?.error === 'disabled') return '🤖 הבוט כבוי כרגע בהגדרות האפליקציה.'
  return data?.reply || '✅ נקלט'

}

// ── שרת ──────────────────────────────────────────────────────
const app = express()
app.set('trust proxy', true)
app.use(express.urlencoded({ extended: false }))

/** מאמת שהבקשה באמת נשלחה מטוויליו ולא מכל אחד שיודע את הכתובת */
function verifyTwilio(req, res, next) {
  const signature = req.header('X-Twilio-Signature')
  const url = (PUBLIC_URL ? PUBLIC_URL.replace(/\/$/, '') : `https://${req.get('host')}`) + req.originalUrl
  if (!signature || !twilioLib.validateRequest(TWILIO_AUTH_TOKEN, signature, url, req.body)) {
    console.warn('בקשה נדחתה — חתימת טוויליו לא תקינה', url)
    return res.sendStatus(403)
  }
  next()
}

app.post('/webhook', verifyTwilio, async (req, res) => {
  res.sendStatus(200)   // עונים מיד כדי לא להחזיק את טוויליו

  const from = (req.body.From || '').replace('whatsapp:', '')
  const body = (req.body.Body || '').trim()
  if (!from) return

  if (!isAllowed(from)) {
    console.warn('מספר לא מורשה:', from)
    return reply(from, '🚫 המספר הזה אינו מורשה לשימוש במערכת. פנה למנהל.')
  }
  if (!body && !parseInt(req.body.NumMedia || '0', 10)) return

  try {
    await ensureSignedIn()
    const answer = await handle(req, from, body)
    if (answer) await reply(from, answer)
  } catch (err) {
    console.error('שגיאה בטיפול בהודעה:', err)
    await reply(from, `❌ שגיאה: ${err.message || 'נסה שוב בעוד רגע'}`)
  }
})

app.get('/', (_req, res) => res.send('Steel Control Bot 🤖 is running'))
app.get('/health', async (_req, res) => {
  try { await ensureSignedIn(); res.json({ ok: true, bot: botProfile?.display_name }) }
  catch (e) { res.status(500).json({ ok: false, error: e.message }) }
})

app.listen(PORT, () => {
  console.log(`Steel Control bot listening on ${PORT}`)
  ensureSignedIn().catch(e => console.error(e.message))
})
