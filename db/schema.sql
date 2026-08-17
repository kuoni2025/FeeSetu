create table if not exists settings(
 id int primary key default 1,
 organization_name text not null default 'Fee Payment Center',
 welcome_message text default 'विद्यार्थी शुल्क भुगतान',
 upi_id text default '',
 receipt_prefix text default 'FEE'
);
insert into settings(id) values(1) on conflict(id) do nothing;

create table if not exists students(
 id bigserial primary key,
 enrollment_number text unique not null,
 admission_number text, roll_number text,
 student_name text not null, father_name text, mother_name text,
 mobile text, email text, course text, class text, semester text,
 year text, batch text, session text, address text, photo_url text default '',
 status text default 'ACTIVE', created_at timestamptz default now()
);

create table if not exists fee_heads(
 id bigserial primary key, name text unique not null, active boolean default true
);
insert into fee_heads(name) values
('Tuition Fee'),('Admission Fee'),('Examination Fee'),('Library Fee'),
('Sports Fee'),('Development Fee'),('Identity Card Fee'),('Other Fee')
on conflict(name) do nothing;

create table if not exists fee_assignments(
 id bigserial primary key,
 student_id bigint references students(id),
 fee_head_id bigint references fee_heads(id),
 amount numeric(12,2) check(amount>=0),
 receipt_visible boolean default true,
 status text default 'UNPAID',
 created_at timestamptz default now()
);

create table if not exists payments(
 id bigserial primary key,
 payment_reference text unique not null,
 student_id bigint references students(id),
 amount numeric(12,2) check(amount>0),
 transaction_id text,
 gateway_payment_id text,
 status text default 'PENDING',
 created_at timestamptz default now()
);

create table if not exists receipts(
 id bigserial primary key,
 receipt_number text unique not null,
 student_id bigint references students(id),
 payment_id bigint references payments(id),
 amount numeric(12,2),
 created_at timestamptz default now()
);
