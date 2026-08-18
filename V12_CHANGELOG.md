# FeeSetu V12 — Professional Kiosk

## Major changes
- Rebuilt the kiosk visual layer with a clean professional college-payment design.
- Removed the old search-heading clutter and oversized decorative elements.
- Fixed the three search buttons to use strict, separate API mappings:
  - Enrollment → `type=enrollment`
  - Roll Number → `type=roll`
  - Mobile Number → `type=mobile`
- Enrollment keyboard: alphanumeric multi-tap, with `/` and `-` support for IDs such as `ABC/2026/00125`.
- Roll Number keyboard: alphanumeric multi-tap, with `/` and `-` support.
- Mobile keyboard: digits only, maximum 10 digits.
- Search, clear and backspace controls are fixed and touch friendly.
- Hindi is the default language for a fresh kiosk V12 session; English remains available from the language switch.
- Improved clock/date, college branding, touch targets, spacing, shadows, colors and responsive behavior.
- Existing student confirmation, fee, UPI, payment verification and receipt API flow retained.

## Important
This release changes the kiosk frontend only. The existing backend/database endpoints remain in place so current student and fee data are not intentionally changed.
