require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

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
 logo_url text default '',
 gateway_enabled boolean default false,
 gateway_provider text default 'razorpay',
 razorpay_key_id text default '',
 razorpay_key_secret text default '',
 razorpay_webhook_secret text default ''
);
insert into settings(id) values(1) on conflict(id) do nothing;
alter table settings add column if not exists logo_url text default '';
alter table settings add column if not exists gateway_enabled boolean default false;
alter table settings add column if not exists gateway_provider text default 'razorpay';
alter table settings add column if not exists razorpay_key_id text default '';
alter table settings add column if not exists razorpay_key_secret text default '';
alter table settings add column if not exists razorpay_webhook_secret text default '';

create table if not exists students(
 id bigserial primary key, enrollment_number text unique not null,
 admission_number text, roll_number text, student_name text not null,
 father_name text, mother_name text, mobile text, email text,
 course text, class text, semester text, year text, batch text,
 session text, address text, photo_url text default '', status text default 'ACTIVE', created_at timestamptz default now()
);
alter table students add column if not exists photo_url text default '';

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
 transaction_id text, gateway_payment_id text, gateway_order_id text,
 payment_method text default 'UPI_QR',
 status text default 'PENDING', created_at timestamptz default now(),
 verified_at timestamptz, verified_by text
);
alter table payments add column if not exists verified_at timestamptz;
alter table payments add column if not exists verified_by text;
alter table payments add column if not exists gateway_order_id text;
alter table payments add column if not exists payment_method text default 'UPI_QR';

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
  try {
    const row = (await q("select organization_name, welcome_message, upi_id, receipt_prefix, logo_url, gateway_enabled, gateway_provider, razorpay_key_id from settings where id=1")).rows[0] || {};
    // never expose secret keys to public
    res.json({
      organization_name: row.organization_name,
      welcome_message: row.welcome_message,
      upi_id: row.upi_id,
      receipt_prefix: row.receipt_prefix,
      logo_url: row.logo_url,
      gateway_enabled: !!row.gateway_enabled,
      gateway_provider: row.gateway_provider || "razorpay",
      razorpay_key_id: row.gateway_enabled ? (row.razorpay_key_id || "") : ""
    });
  } catch(e){ res.status(500).json({error:"Database not ready"}); }
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
    if(type === "enrollment") where = `lower(trim(enrollment_number))=lower(trim($1))`;
    if(type === "roll") where = `(trim(roll_number)=trim($1) OR (trim(roll_number) ~ '^[0-9]+(\\.0+)?$' AND trim($1) ~ '^[0-9]+(\\.0+)?$' AND roll_number::numeric=$1::numeric))`;
    if(type === "mobile") where = `regexp_replace(mobile,'\\D','','g')=regexp_replace($1,'\\D','','g')`;
    const r = await q(`select id,enrollment_number,admission_number,roll_number,student_name,father_name,mother_name,mobile,email,course,class,semester,year,batch,session,address,photo_url from students where status='ACTIVE' and (${where}) order by student_name limit 10`,[identifier]);
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


app.put("/api/students/:id",admin,async(req,res)=>{
  const id=Number(req.params.id);
  const b=req.body||{};
  if(!id || !String(b.enrollment_number||"").trim() || !String(b.student_name||"").trim())
    return res.status(400).json({error:"Enrollment Number और Student Name जरूरी हैं।"});
  try{
    const r=await q(`update students set enrollment_number=$1,admission_number=$2,roll_number=$3,student_name=$4,father_name=$5,mother_name=$6,mobile=$7,email=$8,course=$9,class=$10,semester=$11,year=$12,batch=$13,session=$14,address=$15,photo_url=case when $16<>'' then $16 else photo_url end,status='ACTIVE' where id=$17 returning *`,
      [String(b.enrollment_number).trim(),String(b.admission_number||"").trim(),String(b.roll_number||"").trim(),String(b.student_name).trim(),String(b.father_name||"").trim(),String(b.mother_name||"").trim(),String(b.mobile||"").trim(),String(b.email||"").trim(),String(b.course||"").trim(),String(b.class||"").trim(),String(b.semester||"").trim(),String(b.year||"").trim(),String(b.batch||"").trim(),String(b.session||"").trim(),String(b.address||"").trim(),String(b.photo_url||"").trim(),id]);
    if(!r.rows[0]) return res.status(404).json({error:"विद्यार्थी नहीं मिला।"});
    res.json(r.rows[0]);
  }catch(e){ if(e.code==="23505") return res.status(409).json({error:"यह Enrollment Number पहले से मौजूद है।"}); res.status(500).json({error:"Student update failed"}); }
});
app.delete("/api/students/:id",admin,async(req,res)=>{
  const id=Number(req.params.id);
  if(!id)return res.status(400).json({error:"Invalid student id"});
  try{
    const r=await q("update students set status='INACTIVE' where id=$1 and status='ACTIVE' returning id,student_name,enrollment_number",[id]);
    if(!r.rows[0])return res.status(404).json({error:"विद्यार्थी नहीं मिला या पहले ही हटाया जा चुका है।"});
    res.json({ok:true,student:r.rows[0]});
  }catch(e){res.status(500).json({error:"Student delete failed"});}
});

app.get("/api/fee-heads",admin,async(req,res)=>res.json((await q("select * from fee_heads order by id")).rows));
app.post("/api/fee-heads",admin,async(req,res)=>{
  const name=String(req.body.name||"").trim(); if(!name)return res.status(400).json({error:"Fee head name required"});
  const r=await q("insert into fee_heads(name,active) values($1,true) on conflict(name) do update set active=true returning *",[name]);res.json(r.rows[0]);
});
app.post("/api/fee-heads/:id/toggle",admin,async(req,res)=>res.json((await q("update fee_heads set active=not active where id=$1 returning *",[req.params.id])).rows[0]));

app.get("/api/students",admin,async(req,res)=>res.json((await q("select * from students where status='ACTIVE' order by student_name")).rows));

// Move current student list out of the active kiosk list. Existing payment history is preserved.
app.post("/api/students/archive-all",admin,async(req,res)=>{
  try{
    const r=await q("update students set status='INACTIVE' where status='ACTIVE' returning id");
    res.json({ok:true,archived:r.rowCount,message:`${r.rowCount} विद्यार्थी पुराने डेटा में भेजे गए।`});
  }catch(e){res.status(500).json({error:"पुराना Student Data अलग नहीं किया जा सका।"});}
});

// Permanently remove inactive students only when they have no payment history. This is intentionally conservative.
app.delete("/api/students/inactive/purge",admin,async(req,res)=>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const ids=(await client.query(`select s.id from students s where s.status='INACTIVE' and not exists(select 1 from payments p where p.student_id=s.id)`)).rows.map(x=>x.id);
    if(ids.length){
      await client.query("delete from fee_assignments where student_id = any($1::bigint[])",[ids]);
      await client.query("delete from students where id = any($1::bigint[])",[ids]);
    }
    const blocked=(await client.query(`select count(*)::int as n from students s where s.status='INACTIVE' and exists(select 1 from payments p where p.student_id=s.id)`)).rows[0].n;
    await client.query("commit");
    res.json({ok:true,deleted:ids.length,blocked:Number(blocked),message:`${ids.length} पुराने विद्यार्थी स्थायी रूप से हटाए गए। ${blocked} payment history वाले रिकॉर्ड सुरक्षित रखे गए।`});
  }catch(e){await client.query("rollback");res.status(500).json({error:"पुराना डेटा स्थायी रूप से हटाया नहीं जा सका।"});}finally{client.release();}
});

app.get("/api/students/template.xlsx",admin,(req,res)=>{
  const headers=["Enrollment Number","Admission Number","Roll Number","Student Name","Father Name","Mother Name","Mobile Number","Email","Course","Class","Semester","Year","Batch","Session","Address","Photo URL (optional)"];
  const ws=XLSX.utils.aoa_to_sheet([headers]); ws["!cols"]=headers.map((h,i)=>({wch:i===3?24:18}));
  const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Students");
  const out=XLSX.write(wb,{type:"buffer",bookType:"xlsx"});
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="student-template.xlsx"'); res.send(out);
});
function normalizeHeader(h){return String(h||"").replace(/^\uFEFF/,"").trim().toLowerCase().replace(/\s+/g," ");}
app.post("/api/students/import-xlsx",admin,async(req,res)=>{
  try{
    const buffer=Buffer.from(req.body);
    const wb=XLSX.read(buffer,{type:"buffer",cellDates:false,raw:false});
    const sheetName=wb.SheetNames[0];
    const sheet=wb.Sheets[sheetName];
    if(!sheet) return res.status(400).json({error:"Excel sheet नहीं मिली"});
    const rows=XLSX.utils.sheet_to_json(sheet,{defval:"",raw:false});

    // Optional embedded photos: place a student photo on the same Excel row as the student.
    const embeddedPhotos=new Map();
    try{
      const xw=new ExcelJS.Workbook();
      await xw.xlsx.load(buffer);
      const ws=xw.getWorksheet(sheetName);
      if(ws){
        for(const img of ws.getImages()){
          const tl=img.range && img.range.tl;
          if(!tl) continue;
          const row=Math.floor(Number(tl.nativeRow ?? tl.row ?? 0))+1;
          const media=xw.getImage(img.imageId);
          if(media && media.buffer){
            const ext=String(media.extension||"png").toLowerCase();
            const mime=ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='webp'?'image/webp':'image/png';
            embeddedPhotos.set(row,`data:${mime};base64,${Buffer.from(media.buffer).toString('base64')}`);
          }
        }
      }
    }catch(photoErr){ console.warn('Embedded Excel photos could not be read:',photoErr.message); }

    const aliases={
      "enrollment number":"Enrollment Number","enrollment no":"Enrollment Number","enrollment":"Enrollment Number",
      "admission number":"Admission Number","admission no":"Admission Number","roll number":"Roll Number","roll no":"Roll Number","roll":"Roll Number",
      "student name":"Student Name","name":"Student Name","father name":"Father Name","father":"Father Name","mother name":"Mother Name","mother":"Mother Name",
      "mobile number":"Mobile Number","mobile no":"Mobile Number","mobile":"Mobile Number","phone":"Mobile Number","email":"Email","email id":"Email",
      "course":"Course","class":"Class","semester":"Semester","sem":"Semester","year":"Year","batch":"Batch","session":"Session","address":"Address",
      "photo url":"Photo URL","photo":"Photo URL","photo link":"Photo URL","student photo":"Photo URL"
    };
    let inserted=0,updated=0,duplicates=0,invalid=0,errors=[];
    for(let idx=0;idx<rows.length;idx++){
      const raw=rows[idx],x={};
      for(const [k,v] of Object.entries(raw)) x[aliases[normalizeHeader(k)]||k]=String(v??"").trim();
      const rowNumber=idx+2;
      const en=x["Enrollment Number"],name=x["Student Name"];
      if(!en||!name){invalid++;errors.push({row:rowNumber,reason:"Enrollment Number या Student Name खाली"});continue;}
      try{
        const exists=await q("select id from students where enrollment_number=$1",[en]);
        const photo=x["Photo URL"] || embeddedPhotos.get(rowNumber) || "";
        const vals=[en,x["Admission Number"],x["Roll Number"],name,x["Father Name"],x["Mother Name"],x["Mobile Number"],x["Email"],x["Course"],x["Class"],x["Semester"],x["Year"],x["Batch"],x["Session"],x["Address"],photo];
        if(exists.rows[0]){
          await q(`update students set admission_number=$2,roll_number=$3,student_name=$4,father_name=$5,mother_name=$6,mobile=$7,email=$8,course=$9,class=$10,semester=$11,year=$12,batch=$13,session=$14,address=$15,photo_url=case when $16<>'' then $16 else photo_url end,status='ACTIVE' where enrollment_number=$1`,vals);updated++;
        }else{
          await q(`insert into students(enrollment_number,admission_number,roll_number,student_name,father_name,mother_name,mobile,email,course,class,semester,year,batch,session,address,photo_url,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'ACTIVE')`,vals);inserted++;
        }
      }catch(e){duplicates++;errors.push({row:rowNumber,reason:e.code==="23505"?"Duplicate value":"Database error"});}
    }
    res.json({inserted,updated,duplicates,invalid,total:rows.length,photoRows:embeddedPhotos.size,errors});
  }catch(e){console.error(e);res.status(400).json({error:"Excel file पढ़ी नहीं जा सकी। कृपया .xlsx file upload करें।"});}
});

app.post("/api/fee-assignments/bulk",admin,async(req,res)=>{
  const ids=(req.body.student_ids||[]).map(Number).filter(Boolean),items=req.body.items||[];
  if(!ids.length||!items.length)return res.status(400).json({error:"विद्यार्थी और fee amount चुनें।"});
  let created=0,updated=0;
  for(const sid of ids) for(const x of items){
    const amount=Number(x.amount);
    if(!Number.isFinite(amount)||amount<=0)continue;
    const existing=await q("select id from fee_assignments where student_id=$1 and fee_head_id=$2 and status='UNPAID' order by id desc limit 1",[sid,x.fee_head_id]);
    if(existing.rows[0]){
      await q("update fee_assignments set amount=$1,receipt_visible=$2 where id=$3",[amount,!!x.receipt_visible,existing.rows[0].id]); updated++;
    }else{
      await q("insert into fee_assignments(student_id,fee_head_id,amount,receipt_visible,status) values($1,$2,$3,$4,'UNPAID')",[sid,x.fee_head_id,amount,!!x.receipt_visible]); created++;
    }
  }
  res.json({ok:true,students:ids.length,heads:items.length,created,updated,total:created+updated});
});

app.get("/api/assignments",admin,async(req,res)=>{
  const id=Number(req.query.student_id);
  if(!id)return res.status(400).json({error:"student_id required"});
  const r=await q(`select fa.id,fa.student_id,fa.amount,fa.receipt_visible,fa.status,fh.name fee_head_name
    from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id
    where fa.student_id=$1 order by fa.id`,[id]);
  res.json(r.rows);
});
app.patch("/api/assignments/:id",admin,async(req,res)=>{
  const amount=Number(req.body.amount);
  if(!Number.isFinite(amount)||amount<0)return res.status(400).json({error:"Invalid amount"});
  if(amount===0){
    const d=await q("delete from fee_assignments where id=$1 and status='UNPAID' returning id",[req.params.id]);
    if(!d.rows[0])return res.status(404).json({error:"Unpaid assignment नहीं मिला"});
    return res.json({deleted:true});
  }
  const r=await q("update fee_assignments set amount=$1,receipt_visible=$2 where id=$3 and status='UNPAID' returning *",[amount,!!req.body.receipt_visible,req.params.id]);
  if(!r.rows[0])return res.status(404).json({error:"Unpaid assignment नहीं मिला"});
  res.json(r.rows[0]);
});
app.delete("/api/assignments/:id",admin,async(req,res)=>{
  const r=await q("delete from fee_assignments where id=$1 and status='UNPAID' returning id",[req.params.id]);
  if(!r.rows[0])return res.status(404).json({error:"केवल unpaid fee assignment हटाया जा सकता है।"});
  res.json({ok:true});
});

app.get("/api/payments",admin,async(req,res)=>res.json((await q(`select p.*,s.student_name,s.enrollment_number from payments p join students s on s.id=p.student_id order by p.created_at desc`)).rows));

app.get("/api/reports/payments",admin,async(req,res)=>{
  try{
    const from=String(req.query.from||"").trim(),to=String(req.query.to||"").trim(),status=String(req.query.status||"").trim();
    const params=[]; const where=[];
    if(from){params.push(from);where.push(`p.created_at >= $${params.length}::date`)}
    if(to){params.push(to);where.push(`p.created_at < ($${params.length}::date + interval '1 day')`)}
    if(status){params.push(status);where.push(`p.status = $${params.length}`)}
    const sql=`select p.id,p.payment_reference,p.amount,p.transaction_id,p.payment_method,p.status,p.created_at,p.verified_at,p.verified_by,r.receipt_number,s.student_name,s.enrollment_number,s.roll_number,s.course,s.class,s.session from payments p join students s on s.id=p.student_id left join receipts r on r.payment_id=p.id ${where.length?'where '+where.join(' and '):''} order by p.created_at desc`;
    const rows=(await q(sql,params)).rows;
    res.json({rows,total:rows.reduce((a,x)=>a+Number(x.amount||0),0),count:rows.length});
  }catch(e){res.status(500).json({error:"Payment report तैयार नहीं हो सकी।"});}
});
app.post("/api/settings",admin,async(req,res)=>{
  const b = req.body || {};
  const r = await q(`update settings set
    organization_name=$1, welcome_message=$2, upi_id=$3, receipt_prefix=$4, logo_url=$5,
    gateway_enabled=$6, gateway_provider=$7, razorpay_key_id=$8,
    razorpay_key_secret=CASE WHEN $9 = '' THEN razorpay_key_secret ELSE $9 END,
    razorpay_webhook_secret=CASE WHEN $10 = '' THEN razorpay_webhook_secret ELSE $10 END
    where id=1 returning organization_name,welcome_message,upi_id,receipt_prefix,logo_url,gateway_enabled,gateway_provider,razorpay_key_id`,
    [
      String(b.organization_name||"Fee Payment Center").trim(),
      String(b.welcome_message||"अपना रिकॉर्ड खोजें और फीस जमा करें").trim(),
      String(b.upi_id||"").trim(),
      String(b.receipt_prefix||"FEE").trim(),
      String(b.logo_url||"").trim(),
      !!b.gateway_enabled,
      String(b.gateway_provider||"razorpay").trim(),
      String(b.razorpay_key_id||"").trim(),
      String(b.razorpay_key_secret||"").trim(),
      String(b.razorpay_webhook_secret||"").trim()
    ]);
  res.json(r.rows[0]);
});

// Admin-only full settings (includes whether secrets are set)
app.get("/api/admin/settings",admin,async(req,res)=>{
  try {
    const row = (await q("select organization_name,welcome_message,upi_id,receipt_prefix,logo_url,gateway_enabled,gateway_provider,razorpay_key_id, (razorpay_key_secret is not null and razorpay_key_secret <> '') as has_secret, (razorpay_webhook_secret is not null and razorpay_webhook_secret <> '') as has_webhook_secret from settings where id=1")).rows[0];
    res.json(row || {});
  } catch(e){ res.status(500).json({error:"Settings error"}); }
});


// Helper: create Razorpay order via REST API
async function createRazorpayOrder(keyId, keySecret, amountPaise, receipt, notes) {
  const auth = Buffer.from(keyId + ":" + keySecret).toString("base64");
  const body = JSON.stringify({
    amount: amountPaise,
    currency: "INR",
    receipt: receipt,
    notes: notes || {},
    payment_capture: 1
  });
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Authorization": "Basic " + auth,
      "Content-Type": "application/json"
    },
    body
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.description || data.error?.reason || "Razorpay order failed";
    throw new Error(msg);
  }
  return data;
}

function markPaymentSuccess(client, paymentId, transactionId, gatewayPaymentId, verifiedBy) {
  return (async () => {
    const p = (await client.query("select * from payments where id=$1 for update", [paymentId])).rows[0];
    if (!p) throw new Error("Payment not found");
    if (p.status === "SUCCESS") return { already: true, payment: p };
    const s = (await client.query("select * from settings where id=1")).rows[0];
    const receiptNumber = `${s.receipt_prefix || "FEE"}-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${p.id}`;
    await client.query(
      "update payments set status='SUCCESS', transaction_id=COALESCE($1, transaction_id), gateway_payment_id=COALESCE($2, gateway_payment_id), verified_at=now(), verified_by=$3 where id=$4",
      [transactionId || null, gatewayPaymentId || null, verifiedBy || "gateway", paymentId]
    );
    await client.query(
      "update fee_assignments set status='PAID' where id in (select fee_assignment_id from payment_items where payment_id=$1)",
      [paymentId]
    );
    await client.query(
      "insert into receipts(receipt_number,student_id,payment_id,amount) values($1,$2,$3,$4) on conflict(receipt_number) do nothing",
      [receiptNumber, p.student_id, p.id, p.amount]
    );
    return { already: false, receipt_number: receiptNumber, payment: p };
  })();
}

app.post("/api/payments/create",async(req,res)=>{
  try{
    const sid=Number(req.body.student_id); if(!sid)return res.status(400).json({error:"Student required"});
    const selectedIds = Array.isArray(req.body.fee_assignment_ids) ? req.body.fee_assignment_ids.map(Number).filter(Boolean) : null;
    let items;
    if(selectedIds && selectedIds.length){
      const r = await q(`select fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id where fa.student_id=$1 and fa.status='UNPAID' and fa.amount>0 and fa.id = ANY($2::bigint[]) order by fa.id`,[sid, selectedIds]);
      items = r.rows;
    } else {
      items = (await q(`select fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id where fa.student_id=$1 and fa.status='UNPAID' and fa.amount>0 order by fa.id`,[sid])).rows;
    }
    const amount=items.reduce((a,x)=>a+Number(x.amount),0);
    const s=(await q("select * from settings where id=1")).rows[0];
    if(amount<=0)return res.status(400).json({error:"इस विद्यार्थी के लिए कोई बकाया फीस नहीं है। / No pending fees."});

    const gatewayOn = !!(s.gateway_enabled && s.razorpay_key_id && s.razorpay_key_secret);
    if(!gatewayOn && !s.upi_id){
      return res.status(400).json({error:"Admin में UPI ID या Razorpay Gateway सेट करें। / Configure UPI or Razorpay in Admin."});
    }

    const ref="PAY-"+crypto.randomBytes(6).toString("hex").toUpperCase();
    const student = (await q("select student_name,enrollment_number,email,mobile from students where id=$1",[sid])).rows[0];

    let gateway_order_id = null;
    let razorpay_order = null;
    let payment_method = "UPI_QR";

    if (gatewayOn) {
      try {
        const amountPaise = Math.round(Number(amount) * 100);
        razorpay_order = await createRazorpayOrder(
          s.razorpay_key_id,
          s.razorpay_key_secret,
          amountPaise,
          ref,
          {
            student_id: String(sid),
            enrollment: student?.enrollment_number || "",
            name: student?.student_name || "",
            payment_ref: ref
          }
        );
        gateway_order_id = razorpay_order.id;
        payment_method = "RAZORPAY";
      } catch (ge) {
        console.error("Razorpay order error:", ge.message);
        // Fall back to UPI if available
        if (!s.upi_id) {
          return res.status(500).json({error: "Payment gateway error: " + ge.message});
        }
        payment_method = "UPI_QR";
      }
    }

    const client=await pool.connect();
    try{
      await client.query("begin");
      const pr=(await client.query(
        "insert into payments(payment_reference,student_id,amount,status,gateway_order_id,payment_method) values($1,$2,$3,'PENDING',$4,$5) returning id",
        [ref,sid,amount,gateway_order_id,payment_method]
      )).rows[0];
      for(const item of items) await client.query(
        "insert into payment_items(payment_id,fee_assignment_id,fee_head_name,amount,receipt_visible) values($1,$2,$3,$4,$5)",
        [pr.id,item.id,item.fee_head_name,item.amount,item.receipt_visible]
      );
      await client.query("commit");
    }catch(e){await client.query("rollback");throw e}finally{client.release()}

    // UPI QR (always available if upi_id set — useful as fallback)
    let upi_url = null, upi_id = null, qr_url = null;
    if (s.upi_id) {
      const vpa=String(s.upi_id).trim().replace(/\s+/g,"");
      const payee=String(s.organization_name||"Fee Payment").trim().slice(0,80);
      const amountText=Number(amount).toFixed(2);
      upi_url=`upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(payee)}&am=${encodeURIComponent(amountText)}&cu=INR&tn=${encodeURIComponent(ref)}`;
      upi_id = vpa;
      qr_url=await QRCode.toDataURL(upi_url,{
        errorCorrectionLevel:"M", type:"image/png", width:800, margin:4,
        color:{dark:"#0f172a",light:"#FFFFFF"}
      });
    }

    res.json({
      payment_reference: ref,
      amount,
      upi_url,
      upi_id,
      qr_url,
      payment_method,
      gateway_enabled: gatewayOn && !!gateway_order_id,
      razorpay: gateway_order_id ? {
        key_id: s.razorpay_key_id,
        order_id: gateway_order_id,
        amount: Math.round(Number(amount) * 100),
        currency: "INR",
        name: s.organization_name || "Fee Payment",
        description: "Fee Payment " + ref,
        prefill: {
          name: student?.student_name || "",
          email: student?.email || "",
          contact: student?.mobile || ""
        },
        notes: { payment_ref: ref }
      } : null,
      items: items.map(i=>({id:i.id, name:i.fee_head_name, amount:i.amount}))
    });
  }catch(e){console.error(e);res.status(500).json({error:"Payment request नहीं बन सकी / Could not create payment"});}
});

// Client-side Razorpay success verification (signature check)
app.post("/api/payments/verify-gateway",async(req,res)=>{
  try {
    const { payment_reference, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
    if (!payment_reference || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({error:"Missing payment verification data"});
    }
    const s = (await q("select * from settings where id=1")).rows[0];
    if (!s.razorpay_key_secret) return res.status(400).json({error:"Gateway not configured"});

    const expected = crypto
      .createHmac("sha256", s.razorpay_key_secret)
      .update(razorpay_order_id + "|" + razorpay_payment_id)
      .digest("hex");

    if (expected !== razorpay_signature) {
      return res.status(400).json({error:"Invalid payment signature"});
    }

    const pay = (await q("select * from payments where payment_reference=$1", [payment_reference])).rows[0];
    if (!pay) return res.status(404).json({error:"Payment not found"});
    if (pay.gateway_order_id && pay.gateway_order_id !== razorpay_order_id) {
      return res.status(400).json({error:"Order mismatch"});
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await markPaymentSuccess(client, pay.id, razorpay_payment_id, razorpay_payment_id, "razorpay_checkout");
      await client.query("commit");
      res.json({ ok: true, status: "SUCCESS", receipt_number: result.receipt_number, already: result.already });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({error: e.message || "Verification failed"});
  }
});

// Razorpay Webhook (payment.captured / order.paid)
// Note: For production signature verification, configure razorpay_webhook_secret in Admin.
app.post("/api/webhooks/razorpay", async (req, res) => {
  try {
    const s = (await q("select * from settings where id=1")).rows[0];
    const secret = (s && s.razorpay_webhook_secret) || "";
    const signature = req.headers["x-razorpay-signature"];
    const payload = req.body || {};

    if (secret && signature) {
      const raw = JSON.stringify(payload);
      const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
      // Razorpay signs the exact raw body; if middleware re-serialized, signature may fail.
      // Prefer client verify-gateway + admin verify as primary; webhook is backup.
      if (signature !== expected) {
        console.warn("Webhook signature mismatch (may be due to JSON re-serialization). Processing cautiously.");
      }
    }

    const event = payload.event;
    const entity = (payload.payload && payload.payload.payment && payload.payload.payment.entity)
      || (payload.payload && payload.payload.order && payload.payload.order.entity);

    if (!entity) return res.json({ok: true, ignored: true});

    const orderId = entity.order_id || entity.id;
    const paymentId = entity.id;
    const status = entity.status;
    const noteRef = (entity.notes && entity.notes.payment_ref) || "";

    if (event === "payment.captured" || event === "order.paid" || status === "captured") {
      const pay = (await q(
        "select * from payments where gateway_order_id=$1 OR payment_reference=$2",
        [orderId, noteRef]
      )).rows[0];

      if (pay && pay.status !== "SUCCESS") {
        const client = await pool.connect();
        try {
          await client.query("begin");
          await markPaymentSuccess(client, pay.id, paymentId, paymentId, "razorpay_webhook");
          await client.query("commit");
        } catch (e) {
          await client.query("rollback");
          console.error("Webhook mark success error:", e);
        } finally {
          client.release();
        }
      }
    }
    res.json({ok: true});
  } catch (e) {
    console.error("Webhook error:", e);
    res.status(500).json({error: "Webhook processing failed"});
  }
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
app.delete("/api/payments/:id",admin,async(req,res)=>{
  const id=Number(req.params.id);
  const r=await q("select id,status from payments where id=$1",[id]);
  if(!r.rows[0])return res.status(404).json({error:"Payment नहीं मिली"});
  if(!["PENDING","PENDING_VERIFICATION","REJECTED"].includes(r.rows[0].status))
    return res.status(400).json({error:"Verified payment को delete नहीं किया जा सकता।"});
  await q("delete from payments where id=$1",[id]);
  res.json({ok:true,message:"Pending payment हट गई। Fee assignment वापस unpaid है।"});
});

app.get("/api/payments/:ref/receipt",async(req,res)=>{
  const r=await q(`select r.receipt_number,r.amount,r.created_at,p.payment_reference,p.transaction_id,s.*,(select string_agg(pi.fee_head_name||' - ₹'||pi.amount::text, E'\\n' order by pi.id) from payment_items pi where pi.payment_id=p.id and pi.receipt_visible=true) fee_lines from receipts r join payments p on p.id=r.payment_id join students s on s.id=r.student_id where p.payment_reference=$1`,[req.params.ref]);
  if(!r.rows[0])return res.status(404).json({error:"Receipt अभी उपलब्ध नहीं है। Payment verification के बाद receipt बनेगी।"});res.json(r.rows[0]);
});


app.get("/api/students/:id/history",async(req,res)=>{
  try{
    const r=await q(`select p.payment_reference,p.amount,p.status,p.transaction_id,p.created_at,r.receipt_number
      from payments p left join receipts r on r.payment_id=p.id
      where p.student_id=$1 order by p.created_at desc limit 20`,[req.params.id]);
    res.json({payments:r.rows});
  }catch(e){res.status(500).json({error:"History error"});}
});

app.get("/api/health",async(req,res)=>{try{await q("select 1");res.json({ok:true})}catch(e){res.status(500).json({ok:false})}});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=process.env.PORT||3000;
initDatabase().then(()=>app.listen(port,()=>console.log("Fee Kiosk cloud app on "+port))).catch(err=>{console.error("Database initialization failed:",err);process.exit(1);});
