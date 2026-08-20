
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  organization_name TEXT NOT NULL DEFAULT 'FeeSetu',
  welcome_message TEXT DEFAULT 'विद्यार्थी शुल्क भुगतान',
  upi_id TEXT DEFAULT '',
  receipt_prefix TEXT DEFAULT 'FS',
  logo_url TEXT DEFAULT ''
);
INSERT INTO settings(id) VALUES (1) ON CONFLICT(id) DO NOTHING;

CREATE TABLE IF NOT EXISTS students (
  id BIGSERIAL PRIMARY KEY,
  enrollment_number TEXT UNIQUE NOT NULL,
  admission_number TEXT,
  roll_number TEXT,
  student_name TEXT NOT NULL,
  father_name TEXT,
  mother_name TEXT,
  mobile TEXT,
  email TEXT,
  course TEXT,
  class TEXT,
  semester TEXT,
  year TEXT,
  batch TEXT,
  session TEXT,
  address TEXT,
  photo_url TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE students ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE TABLE IF NOT EXISTS fee_heads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO fee_heads(name) VALUES
('Tuition Fee'),('Admission Fee'),('Examination Fee'),('Library Fee'),
('Sports Fee'),('Development Fee'),('Identity Card Fee'),('Other Fee')
ON CONFLICT(name) DO NOTHING;

CREATE TABLE IF NOT EXISTS fee_assignments (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  fee_head_id BIGINT NOT NULL REFERENCES fee_heads(id),
  amount NUMERIC(12,2) NOT NULL CHECK(amount >= 0),
  receipt_visible BOOLEAN NOT NULL DEFAULT TRUE,
  status TEXT NOT NULL DEFAULT 'UNPAID',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payments (
  id BIGSERIAL PRIMARY KEY,
  payment_reference TEXT UNIQUE NOT NULL,
  student_id BIGINT NOT NULL REFERENCES students(id),
  amount NUMERIC(12,2) NOT NULL CHECK(amount > 0),
  transaction_id TEXT,
  payment_method TEXT NOT NULL DEFAULT 'UPI_QR',
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  verified_at TIMESTAMPTZ,
  verified_by TEXT
);

CREATE TABLE IF NOT EXISTS payment_items (
  id BIGSERIAL PRIMARY KEY,
  payment_id BIGINT NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  fee_assignment_id BIGINT NOT NULL REFERENCES fee_assignments(id),
  fee_head_name TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  receipt_visible BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS receipts (
  id BIGSERIAL PRIMARY KEY,
  receipt_number TEXT UNIQUE NOT NULL,
  student_id BIGINT NOT NULL REFERENCES students(id),
  payment_id BIGINT NOT NULL REFERENCES payments(id),
  amount NUMERIC(12,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
