# FeeSetu V14 — Master Prompt / Final Build Specification

Build FeeSetu as a professional, touch-first student fee-payment kiosk for Gov PG College Shivpuri. Use the supplied project as the codebase and preserve its working backend/database/payment functions unless a listed requirement requires a change. The result must look like a professionally designed institutional kiosk, not a generic beginner HTML page.

## Kiosk flow
- Page 1: only the title “विद्यार्थी शुल्क भुगतान कियोस्क” and three large login/search choices.
- 🪪 नामांकन क्रमांक → only `students.enrollment_number` and API type `enrollment`. It must accept A-Z and 0-9.
- 🎓 रोल नंबर → only `students.roll_number` and API type `roll`. It must accept A-Z and 0-9.
- 📱 मोबाइल नंबर → only `students.mobile` and API type `mobile`. It must accept digits only.
- Enrollment, Roll and Mobile mapping must never fall back into one another.
- Page 2: the selected identifier gets its own touch keyboard page. Enrollment/Roll use a real alphanumeric QWERTY keyboard; Mobile uses a numeric keypad. Every key inserts exactly its displayed character. No multi-tap mapping.
- CLEAR, backspace and SEARCH must work. The input must be read-only so the physical keyboard cannot unexpectedly appear on kiosk devices.
- Keep the clock/date visible in the header and keep touch targets large and well spaced.

## Visual design
- Completely replace the old generic kiosk appearance. Use the supplied reference style: clean white/off-white surfaces, very light saffron background accents, restrained navy typography, saffron primary actions, soft shadows, rounded cards and precise spacing.
- Keep the purpose obvious: “विद्यार्थी शुल्क भुगतान कियोस्क”. Do not place a rupee symbol beside that title.
- Avoid unnecessarily bold/oversized labels.
- Use supplied assets in `public/assets` where appropriate. Functional text stays HTML; decorative images may be CSS backgrounds.
- Responsive for kiosk displays, desktop, Android and Apple devices. No horizontal overflow.

## Student
- Show student photo when available and a polished fallback avatar otherwise.
- Confirmation page should clearly show Student Name, Enrollment Number, Roll Number, Course/Class, Semester, Session, Mobile and other available identity details.

## Fees and payment
- Show pending fee heads, amounts, selection controls and total. Preserve partial-payment capability where supported.
- Keep UPI QR and optional Razorpay gateway.
- After successful/verified payment, generate a professional receipt containing institution, receipt number, date/time, student details, fee lines, amount, transaction/UTR and total.
- Print must print only the receipt area with a clean paper-friendly layout.

## Admin
- Professional branded Admin Login.
- Dashboard: student count, successful collection and pending verification count.
- Students: XLSX upload/update. Required mapping includes Enrollment Number, Admission Number, Roll Number, Student Name, Father Name, Mother Name, Mobile Number, Email, Course, Class, Semester, Year, Batch, Session, Address and Photo.
- Student photo may come from Photo URL or an embedded image in the same Excel row.
- Provide safe old-data handling: archive active students to inactive/old data and allow deliberate permanent purge only for inactive records without payment history. Never silently delete payment history.
- Fee Heads, Fee Assignment and Payment Records remain available. Payment records must support filters/export and admin verification/rejection of UTR payments.

## Data safety
- Enrollment Number remains unique.
- Search endpoints must be strict by selected type; never use an automatic OR search for kiosk actions.
- Mobile search may normalize separators but must still search only the mobile field.

## Language
- Hindi is default; English toggle remains. Translate all kiosk labels, messages, errors and receipt labels.

## Technical
- Node.js + Express + PostgreSQL-compatible database. Keep Render deployment files.
- No unnecessary external CDN dependencies for core UI.
- Test all three mappings, both keyboard types, clear/backspace/search, student photo import, archive/purge, payment verification and receipt printing.

## Acceptance checklist
- [ ] Separate login and keyboard pages
- [ ] Enrollment-only mapping + A-Z/0-9 keyboard
- [ ] Roll-only mapping + A-Z/0-9 keyboard
- [ ] Mobile-only mapping + numeric keyboard
- [ ] No multi-tap and no cross-mapping
- [ ] Keyboard remains aligned/fixed on mobile and kiosk screens
- [ ] Clock/date visible
- [ ] Student photo works from Excel URL or embedded row image
- [ ] Old-data archive/purge is available and safe
- [ ] Payment records/admin verification work
- [ ] Receipt generates and prints cleanly
- [ ] Hindi/English works
- [ ] Overall UI is professional, clean and touch-friendly

## V15 ASSET PACK IMPLEMENTATION REQUIREMENT

The supplied `public/assets/` FeeSetu UI Asset Pack is not merely reference material. The implementation must actively use the assets in the UI:
- `01_main_background.png`, `02_light_background.png`, `03_login_background.png` for theme/background layers.
- `04_logo_branding.png` and its derived crops for FeeSetu/college branding.
- `05_icons.png` and derived icon crops for enrollment, roll, mobile and document actions.
- `10_receipt_header.png` for the receipt header.
- `11_footer_strip.png` for the kiosk/footer visual strip.
- `13_table_header.png` for administrative table-header styling.
- `14_decorative_elements.png` for restrained decorative accents.

Do not replace the supplied visual language with generic gradients, random stock graphics, or unrelated colors. Functional keyboard keys must remain real HTML touch buttons; the supplied keyboard image is a visual design reference, not a clickable image.

### Kiosk search mapping is fixed
1. Enrollment button => only `enrollment_number` search; Alphanumeric QWERTY keyboard.
2. Roll button => only `roll_number` search; Alphanumeric QWERTY keyboard.
3. Mobile button => only `mobile` search; Numeric keyboard.

The three modes must never share or mutate one another's identifier mapping.
