# Existing Render update

यह build existing `simple-fee-kiosk` Render service को update करने के लिए है। नया Blueprint बनाने की जरूरत नहीं है।

## GitHub
Repository में project files replace करें:
- server.js
- public/index.html
- public/admin.html
- package.json
- db/schema.sql (reference)
- README.md
- DEPLOY_TO_RENDER.md
- DEPLOY_CHECKLIST.txt
- render.yaml

## Render
Existing Web Service में auto deploy enabled है तो GitHub commit के बाद deployment शुरू हो जाएगा। यदि auto deploy नहीं होता तो Render में Manual Deploy → Deploy latest commit करें।

Database data अलग PostgreSQL service में है; code update से database delete नहीं होना चाहिए। Server startup पर required tables/columns `CREATE TABLE IF NOT EXISTS` और `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` से तैयार होते हैं।

## Environment
`ADMIN_USER` और `ADMIN_PASSWORD` वही रखें जो existing Render service में configured हैं। `DATABASE_URL` को बदलें नहीं।

## Payment testing
Settings में अपना वास्तविक UPI ID डालकर पहले छोटी test fee से test करें। Payment verification अभी manual UTR based है। किसी payment को Verify तभी करें जब UTR/transaction वास्तव में UPI/bank statement में मिल जाए।
