# FeeSetu V16 — Render Deployment

Use the included `render.yaml` for a new FeeSetu deployment, or copy the settings into the existing Render service.

Required environment variables:
- DATABASE_URL (PostgreSQL connection string)
- ADMIN_USER
- ADMIN_PASSWORD

Optional payment settings are entered from Admin > Settings:
- UPI ID for UPI QR
- Razorpay Key ID / Secret / Webhook Secret for online gateway

Health check: `/api/health`

If an existing Render service is still named `simple-fee-kiosk`, its service URL will not change merely because the GitHub repository is renamed. Rename/recreate the Render service as `feesetu` if you want a new `feesetu.onrender.com` address.
