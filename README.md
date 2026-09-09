# FeeSetu V16

Professional student fee-payment kiosk for Govt. PG College Shivpuri.

## Included
- Welcome screen
- Separate student search and touch-keyboard screen
- Fixed Enrollment / Roll / Mobile mappings
- Student confirmation
- Fee details
- UPI QR + optional Razorpay checkout
- UTR submission and admin verification
- Receipt preview, print and PDF via browser print
- Admin portal with Excel import, student photo support, fee assignment and payment records
- Archive/purge controls for old student data

## Deploy
1. Create a PostgreSQL database.
2. Set `DATABASE_URL`, `ADMIN_USER`, and `ADMIN_PASSWORD` in the service environment.
3. Set the college UPI ID in Admin > Settings for QR payments.
4. For gateway payments, configure Razorpay keys in Admin > Settings.
5. Start with `npm install` then `npm start`.
