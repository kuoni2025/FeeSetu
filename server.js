require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const XLSX = require("xlsx");

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use(express.raw({ type: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/octet-stream"], limit: "15mb" }));
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost") ? { rejectUnauthorized: false } : false
});
const q = (sql, params = []) => pool.query(sql, params);

const SCHEMA = `
create table if not exists settings(
 id int primary key default 1,
 organization_name text not null default 'Fee Payment Center',
 welcome_message text default 'अपना रिकॉर्ड खोजें और फीस जमा करें',
 upi_id text default '', receipt_prefix text default 'FEE',
 logo_url text default ''
);
insert into settings(id) values(1) on conflict(id) do nothing;
alter table settings add column if not exists logo_url text default '';

create table if not exists students(
 id bigserial primary key, enrollment_number text unique not null,
 admission_number text, roll_number text, student_name text not null,
 father_name text, mother_name text, mobile text, email text,
 course text, class text, semester text, year text, batch text,
 session text, address text, status text default 'ACTIVE', created_at timestamptz default now()
);

create table if not exists fee_heads(
 id bigserial primary key, name text unique not null, active boolean default true
);
insert into fee_heads(name) values
('Tuition Fee'),('Admission Fee'),('Examination Fee'),('Library Fee'),
('Sports Fee'),('Development Fee'),('Identity Card Fee'),('Other Fee')
on conflict(name) do nothing;

create table if not exists fee_assignments(
 id bigserial primary key, student_id bigint references students(id),
 fee_head_id bigint references fee_heads(id), amount numeric(12,2) check(amount>=0),
 receipt_visible boolean default true, status text default 'UNPAID', created_at timestamptz default now()
);

create table if not exists payments(
 id bigserial primary key, payment_reference text unique not null,
 student_id bigint references students(id), amount numeric(12,2) check(amount>0),
 transaction_id text, gateway_payment_id text,
 status text default 'PENDING', created_at timestamptz default now(),
 verified_at timestamptz, verified_by text
);
alter table payments add column if not exists verified_at timestamptz;
alter table payments add column if not exists verified_by text;

create table if not exists payment_items(
 id bigserial primary key, payment_id bigint references payments(id) on delete cascade,
 fee_assignment_id bigint references fee_assignments(id), fee_head_name text, amount numeric(12,2), receipt_visible boolean default true
);

create table if not exists receipts(
 id bigserial primary key, receipt_number text unique not null,
 student_id bigint references students(id), payment_id bigint references payments(id),
 amount numeric(12,2), created_at timestamptz default now()
);
`;

async function initDatabase(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  await q(SCHEMA);
  console.log("Database schema ready");
}

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASSWORD || "change-me";
const sessions = new Map();

app.get("/api/settings", async (req,res)=>{
  try { res.json((await q("select * from settings where id=1")).rows[0]); }
  catch(e){ res.status(500).json({error:"Database not ready"}); }
});

app.post("/api/admin/login", async (req,res)=>{
  if(req.body.username === ADMIN_USER && req.body.password === ADMIN_PASS){
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + 8*60*60*1000);
    return res.json({token});
  }
  res.status(401).json({error:"Invalid login"});
});
function admin(req,res,next){
  const token = (req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  const expiry = sessions.get(token);
  if(!expiry || expiry < Date.now()){ sessions.delete(token); return res.status(401).json({error:"Unauthorized"}); }
  next();
}
app.post("/api/admin/logout",admin,(req,res)=>{
  sessions.delete((req.headers.authorization||"").replace(/^Bearer\s+/i,""));
  res.json({ok:true});
});

// Search by Enrollment, Admission, Roll or Mobile. Returns a short list so a mobile number can be shared safely.
app.get("/api/students/search",async(req,res)=>{
  try{
    const identifier = String(req.query.identifier||"").trim();
    const type = String(req.query.type||"auto");
    if(!identifier) return res.status(400).json({error:"Search value is required"});
    let where = `lower(enrollment_number)=lower($1) or admission_number=$1 or roll_number=$1 or mobile=$1`;
    if(type === "enrollment") where = `lower(enrollment_number)=lower($1)`;
    if(type === "roll") where = `roll_number=$1`;
    if(type === "mobile") where = `mobile=$1`;
    const r = await q(`select id,enrollment_number,admission_number,roll_number,student_name,father_name,mother_name,mobile,email,course,class,semester,year,batch,session,address from students where status='ACTIVE' and (${where}) order by student_name limit 10`,[identifier]);
    if(!r.rows.length) return res.status(404).json({error:"इस जानकारी से कोई विद्यार्थी नहीं मिला।"});
    res.json({students:r.rows});
  }catch(e){res.status(500).json({error:"Database error"});}
});

app.get("/api/students/:id/fee",async(req,res)=>{
  try{
    const r=await q(`select fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name
      from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id
      where fa.student_id=$1 and fa.status='UNPAID' and fa.amount>0 order by fh.id`,[req.params.id]);
    res.json({items:r.rows,total:r.rows.reduce((a,x)=>a+Number(x.amount),0)});
  }catch(e){res.status(500).json({error:"Database error"});}
});

app.get("/api/fee-heads",admin,async(req,res)=>res.json((await q("select * from fee_heads order by id")).rows));
app.post("/api/fee-heads",admin,async(req,res)=>{
  const name=String(req.body.name||"").trim(); if(!name)return res.status(400).json({error:"Fee head name required"});
  const r=await q("insert into fee_heads(name,active) values($1,true) on conflict(name) do update set active=true returning *",[name]);res.json(r.rows[0]);
});
app.post("/api/fee-heads/:id/toggle",admin,async(req,res)=>res.json((await q("update fee_heads set active=not active where id=$1 returning *",[req.params.id])).rows[0]));

app.get("/api/students",admin,async(req,res)=>res.json((await q("select * from students where status='ACTIVE' order by student_name")).rows));

app.get("/api/students/template.xlsx",admin,(req,res)=>{
  const headers=["Enrollment Number","Admission Number","Roll Number","Student Name","Father Name","Mother Name","Mobile Number","Email","Course","Class","Semester","Year","Batch","Session","Address"];
  const ws=XLSX.utils.aoa_to_sheet([headers]); ws["!cols"]=headers.map((h,i)=>({wch:i===3?24:18}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Students");
  const out=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="student-template.xlsx"'); res.send(out);
});
function normalizeHeader(h){return String(h||"").replace(/^\uFEFF/,"").trim().toLowerCase().replace(/\s+/g," ");}
app.post("/api/students/import-xlsx",admin,async(req,res)=>{
  try{
    const wb=XLSX.read(Buffer.from(req.body),{type:"buffer",cellDates:false,raw:false});
    const sheet=wb.Sheets[wb.SheetNames[0]]; if(!sheet) return res.status(400).json({error:"Excel sheet नहीं मिली"});
    const rows=XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false});
    const aliases={"enrollment number":"Enrollment Number","enrollment no":"Enrollment Number","enrollment":"Enrollment Number","admission number":"Admission Number","admission no":"Admission Number","roll number":"Roll Number","roll no":"Roll Number","roll":"Roll Number","student name":"Student Name","name":"Student Name","father name":"Father Name","father":"Father Name","mother name":"Mother Name","mother":"Mother Name","mobile number":"Mobile Number","mobile no":"Mobile Number","mobile":"Mobile Number","phone":"Mobile Number","email":"Email","email id":"Email","course":"Course","class":"Class","semester":"Semester","sem":"Semester","year":"Year","batch":"Batch","session":"Session","address":"Address"};
    let inserted=0,updated=0,duplicates=0,invalid=0,errors=[];
    for(let idx=0;idx<rows.length;idx++){
      const raw=rows[idx],x={}; for(const [k,v] of Object.entries(raw))x[aliases[normalizeHeader(k)]||k]=String(v??"").trim();
      const en=x["Enrollment Number"],name=x["Student Name"];
      if(!en||!name){invalid++;errors.push({row:idx+2,reason:"Enrollment Number या Student Name खाली"});continue;}
      try{
        const exists=await q("select id from students where enrollment_number=$1",[en]);
        const vals=[en,x["Admission Number"],x["Roll Number"],name,x["Father Name"],x["Mother Name"],x["Mobile Number"],x["Email"],x["Course"],x["Class"],x["Semester"],x["Year"],x["Batch"],x["Session"],x["Address"]];
        if(exists.rows[0]){
          await q(`update students set admission_number=$2,roll_number=$3,student_name=$4,father_name=$5,mother_name=$6,mobile=$7,email=$8,course=$9,class=$10,semester=$11,year=$12,batch=$13,session=$14,address=$15,status='ACTIVE' where enrollment_number=$1`,vals);updated++;
        }else{
          await q(`insert into students(enrollment_number,admission_number,roll_number,student_name,father_name,mother_name,mobile,email,course,class,semester,year,batch,session,address,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE')`,vals);inserted++;
        }
      }catch(e){duplicates++;errors.push({row:idx+2,reason:e.code==="23505"?"Duplicate value":"Database error"});}
    }
    res.json({inserted,updated,duplicates,invalid,total:rows.length,errors});
  }catch(e){res.status(400).json({error:"Excel file पढ़ी नहीं जा सकी। कृपया .xlsx file upload करें।"});}
});

app.post("/api/fee-assignments/bulk",admin,async(req,res)=>{
  const ids=(req.body.student_ids||[]).map(Number).filter(Boolean),items=req.body.items||[];
  if(!ids.length||!items.length)return res.status(400).json({error:"विद्यार्थी और fee amount चुनें।"});
  for(const sid of ids) for(const x of items){
    const amount=Number(x.amount); if(!Number.isFinite(amount)||amount<0)continue;
    const existing=await q("select id from fee_assignments where student_id=$1 and fee_head_id=$2 and status='UNPAID' order by id desc limit 1",[sid,x.fee_head_id]);
    if(existing.rows[0]) await q("update fee_assignments set amount=$1,receipt_visible=$2 where id=$3",[amount,!!x.receipt_visible,existing.rows[0].id]);
    else await q("insert into fee_assignments(student_id,fee_head_id,amount,receipt_visible,status) values($1,$2,$3,$4,'UNPAID')",[sid,x.fee_head_id,amount,!!x.receipt_visible]);
  }
  res.json({assigned:ids.length});
});

app.get("/api/assignments",admin,async(req,res)=>{
  const id=Number(req.query.student_id); if(!id)return res.status(400).json({error:"student_id required"});
  const r=await q(`select fa.id,fa.student_id,fa.amount,fa.receipt_visible,fa.status,fh.name fee_head_name from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id where fa.student_id=$1 order by fa.id`,[id]);res.json(r.rows);
});
app.patch("/api/assignments/:id",admin,async(req,res)=>{
  const amount=Number(req.body.amount); if(!Number.isFinite(amount)||amount<0)return res.status(400).json({error:"Invalid amount"});
  const r=await q("update fee_assignments set amount=$1,receipt_visible=$2 where id=$3 and status='UNPAID' returning *",[amount,!!req.body.receipt_visible,req.params.id]);
  if(!r.rows[0])return res.status(404).json({error:"Unpaid assignment नहीं मिला"});res.json(r.rows[0]);
});

app.get("/api/payments",admin,async(req,res)=>res.json((await q(`select p.*,s.student_name,s.enrollment_number from payments p join students s on s.id=p.student_id order by p.created_at desc`)).rows));
app.post("/api/settings",admin,async(req,res)=>{
  const r=await q("update settings set organization_name=$1,welcome_message=$2,upi_id=$3,receipt_prefix=$4,logo_url=$5 where id=1 returning *",[String(req.body.organization_name||"Fee Payment Center").trim(),String(req.body.welcome_message||"अपना रिकॉर्ड खोजें और फीस जमा करें").trim(),String(req.body.upi_id||"").trim(),String(req.body.receipt_prefix||"FEE").trim(),String(req.body.logo_url||"").trim()]);res.json(r.rows[0]);
});

app.post("/api/payments/create",async(req,res)=>{
  try{
    const sid=Number(req.body.student_id); if(!sid)return res.status(400).json({error:"Student required"});
    const items=(await q(`select fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id where fa.student_id=$1 and fa.status='UNPAID' and fa.amount>0 order by fa.id`,[sid])).rows;
    const amount=items.reduce((a,x)=>a+Number(x.amount),0),s=(await q("select * from settings where id=1")).rows[0];
    if(amount<=0)return res.status(400).json({error:"इस विद्यार्थी के लिए कोई बकाया फीस नहीं है।"});
    if(!s.upi_id)return res.status(400).json({error:"Admin में UPI ID सेट करें।"});
    const ref="PAY-"+crypto.randomBytes(6).toString("hex").toUpperCase();
    const client=await pool.connect();
    try{
      await client.query("begin");
      const pr=(await client.query("insert into payments(payment_reference,student_id,amount,status) values($1,$2,$3,'PENDING') returning id",[ref,sid,amount])).rows[0];
      for(const item of items) await client.query("insert into payment_items(payment_id,fee_assignment_id,fee_head_name,amount,receipt_visible) values($1,$2,$3,$4,$5)",[pr.id,item.id,item.fee_head_name,item.amount,item.receipt_visible]);
      await client.query("commit");
    }catch(e){await client.query("rollback");throw e}finally{client.release()}
    const upi=`upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.organization_name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(ref)}`;
    res.json({payment_reference:ref,amount,upi_url:upi,upi_id:s.upi_id,qr_url:await QRCode.toDataURL(upi)});
  }catch(e){res.status(500).json({error:"Payment request नहीं बन सकी"});}
});
app.post("/api/payments/submit-utr",async(req,res)=>{
  const ref=String(req.body.payment_reference||"").trim(),utr=String(req.body.transaction_id||"").trim();
  if(!ref||!utr)return res.status(400).json({error:"Payment reference और UTR/Transaction ID जरूरी है।"});
  const r=await q("update payments set transaction_id=$1,status='PENDING_VERIFICATION' where payment_reference=$2 and status in ('PENDING','PENDING_VERIFICATION') returning *",[utr,ref]);
  if(!r.rows[0])return res.status(404).json({error:"Payment request नहीं मिली या पहले ही process हो चुकी है।"});res.json({ok:true,status:r.rows[0].status});
});
app.get("/api/payments/:ref",async(req,res)=>{const r=await q("select p.*,s.student_name,s.enrollment_number from payments p join students s on s.id=p.student_id where p.payment_reference=$1",[req.params.ref]);if(!r.rows[0])return res.status(404).json({error:"Payment not found"});res.json(r.rows[0]);});

app.post("/api/payments/:id/verify",admin,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const p=(await client.query("select * from payments where id=$1 for update",[req.params.id])).rows[0];
    if(!p)throw new Error("Payment not found");
    if(p.status==="SUCCESS") { await client.query("commit"); return res.json({ok:true,status:"SUCCESS"}); }
    const s=(await client.query("select * from settings where id=1")).rows[0];
    const receiptNumber=`${s.receipt_prefix||"FEE"}-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${p.id}`;
    await client.query("update payments set status='SUCCESS',verified_at=now(),verified_by=$1 where id=$2",[ADMIN_USER,p.id]);
    await client.query("update fee_assignments set status='PAID' where id in (select fee_assignment_id from payment_items where payment_id=$1)",[p.id]);
    await client.query("insert into receipts(receipt_number,student_id,payment_id,amount) values($1,$2,$3,$4) on conflict(receipt_number) do nothing",[receiptNumber,p.student_id,p.id,p.amount]);
    await client.query("commit");res.json({ok:true,status:"SUCCESS",receipt_number:receiptNumber});
  }catch(e){await client.query("rollback");res.status(400).json({error:e.message||"Verification failed"});}finally{client.release();}
});
app.post("/api/payments/:id/reject",admin,async(req,res)=>{const r=await q("update payments set status='REJECTED' where id=$1 and status in ('PENDING','PENDING_VERIFICATION') returning *",[req.params.id]);if(!r.rows[0])return res.status(404).json({error:"Payment नहीं मिली"});res.json(r.rows[0]);});
app.get("/api/payments/:ref/receipt",async(req,res)=>{
  const r=await q(`select r.receipt_number,r.amount,r.created_at,p.payment_reference,p.transaction_id,s.*,(select string_agg(pi.fee_head_name||' - ₹'||pi.amount::text, E'\\n' order by pi.id) from payment_items pi where pi.payment_id=p.id and pi.receipt_visible=true) fee_lines from receipts r join payments p on p.id=r.payment_id join students s on s.id=r.student_id where p.payment_reference=$1`,[req.params.ref]);
  if(!r.rows[0])return res.status(404).json({error:"Receipt अभी उपलब्ध नहीं है। Payment verification के बाद receipt बनेगी।"});res.json(r.rows[0]);
});

app.get("/api/health",async(req,res)=>{try{await q("select 1");res.json({ok:true})}catch(e){res.status(500).json({ok:false})}});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=process.env.PORT||3000;
initDatabase().then(()=>app.listen(port,()=>console.log("Fee Kiosk cloud app on "+port))).catch(err=>{console.error("Database initialization failed:",err);process.exit(1);});
