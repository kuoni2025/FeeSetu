# FeeSetu V13 — Govt. PG College Shivpuri

Professional self-service **Student Fee Payment Kiosk** for  
शासकीय स्नातकोत्तर महाविद्यालय, शिवपुरी (म.प्र.).

## Design (V13)
- New kiosk UI aligned with FeeSetu visual asset pack
- Separate home (search type) → keyboard pages
- Fixed search mapping: Enrollment / Roll / Mobile only
- Large touch keyboard (alphanumeric + numeric)
- Student confirm with photo support
- Partial fee selection + UPI QR payment
- Bilingual Hindi | English
- Printable receipt
- Admin dashboard (existing)

## Assets
`public/assets/` — backgrounds, logo reference, UI style references from FeeSetu V10 pack.

## Run
```bash
npm install
# DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD
npm start
```

Kiosk: `/`  
Admin: `/admin.html`

## Deploy
Compatible with Render (`render.yaml`) and GitHub `kuoni2025/FeeSetu`.
