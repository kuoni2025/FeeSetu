# FeeSetu Kiosk v10

Modern student fee payment kiosk for Gov PG College Shivpuri.

## V10 changes
- Stable custom alphanumeric touch keypad with multi-tap letters for Enrollment Number.
- Mobile layout prevents the native keyboard from opening.
- Clear "विद्यार्थी शुल्क भुगतान कियोस्क" identity.
- Light saffron/white visual theme with subtle background artwork.
- Student photo support from Excel: **Photo URL** column or an embedded photo placed on the same Excel row.
- Student photos shown in Admin and Kiosk confirmation.
- Existing Student edit/delete, archive and safe inactive purge retained.
- Fee assignment/save feedback retained.
- Pending payment deletion keeps fee assignment unpaid.
- Payment records and CSV reporting retained.

## Excel photos
Download the template from Admin → Students. Add an optional `Photo URL (optional)` column, or insert a student photo image into the same row in the workbook. The importer stores the photo for that student.

## Deploy
Push the repository to GitHub and let Render redeploy the existing service. Do not create a new database.
