# Steel Control WhatsApp Bot

## Deploy to Render (free)

1. כנס ל-render.com
2. New → Web Service
3. Connect GitHub (או upload manually)
4. Settings:
   - Build Command: `npm install`
   - Start Command: `node server.js`
5. לאחר deploy - העתק את ה-URL (נראה כך: https://steel-bot.onrender.com)

## Connect to Twilio

1. כנס ל-console.twilio.com
2. Messaging → Try it out → Send a WhatsApp message
3. Sandbox Settings
4. הדבק את ה-URL של Render + `/webhook`:
   `https://steel-bot.onrender.com/webhook`
5. שמור

## פקודות הבוט

- `תולדות - חסר פלטה 150` → שמירת הערה
- `סיכום תולדות` → סיכום פרויקט
- `מה פתוח?` → כל המשימות הפתוחות
- `סגור פלטה 150` → סימון כטופל
- `עזרה` → רשימת פקודות
