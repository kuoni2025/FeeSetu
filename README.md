# Simple Fee Kiosk — Final Test Build

यह build **वास्तविक testing के लिए** बनाया गया है। इसमें sample student records नहीं हैं। संस्था अपना data Admin से Excel `.xlsx` द्वारा upload करेगी।

## मुख्य सुविधाएँ
- Kiosk की साफ, compact और touch-friendly search screen
- Search: **Enrollment Number / Roll Number / Mobile Number**
- Enrollment में mobile-phone style multi-tap: `2 → A → B → C → 2`
- Roll/Mobile में numeric keypad
- Mobile number से एक से अधिक record मिलने पर विद्यार्थी selection
- Student confirmation screen
- Assigned fee heads और कुल देय राशि
- Admin में सभी विद्यार्थियों को एक साथ fee assign/update
- Receipt में किसी fee head को दिखाना/छिपाना
- पहले से assigned unpaid fee की राशि कम/बदलने की सुविधा
- Excel `.xlsx` import; existing Enrollment Number मिलने पर student record update
- UPI ID से UPI QR और UPI App deep-link payment request
- Payment reference और UTR/Transaction ID capture
- Admin द्वारा UTR/UPI transaction देखकर Verify/Reject
- Verify होने पर fee assignments PAID और receipt generate
- Receipt print
- संस्था का नाम, message, UPI ID, receipt prefix और optional logo URL settings
- PostgreSQL persistent database
- Render Blueprint deployment

## महत्वपूर्ण payment note
सिर्फ UPI ID से software बैंक में payment की स्वतः पुष्टि नहीं कर सकता। इस build में UPI QR/Intent वास्तविक payment शुरू करता है, विद्यार्थी UTR देता है और Admin transaction सत्यापित करके **Verify** करता है। Automatic bank-side verification के लिए बाद में किसी payment gateway की API/webhook integration जोड़नी होगी।

## Render deployment
पहले से बने Render service/Database को दोबारा बनाने की जरूरत नहीं है। GitHub में इस build की files update करने के बाद existing Render service नया commit deploy कर सकती है।

Required environment variables:
- `DATABASE_URL` — Render Blueprint से
- `ADMIN_USER`
- `ADMIN_PASSWORD`

## Test sequence
1. Admin login
2. Settings में संस्था का नाम और अपना UPI ID डालें
3. Students में Excel upload करें
4. Fee Heads को संस्था के अनुसार रखें/बदलें
5. Fee Assignment में विद्यार्थियों को fees assign करें
6. Kiosk खोलें और Enrollment/Roll/Mobile से search करें
7. Fee screen पर amount देखें
8. UPI QR/App से payment करें
9. UTR दर्ज करें
10. Admin → Payments → Verify
11. Kiosk पर status check करके receipt देखें और print करें
