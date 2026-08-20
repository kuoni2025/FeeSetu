
require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");
const QRCode = require("qrcode");
const ExcelJS = require("exceljs");

const app = express();
app.use(express.json({limit:"15mb"}));
app.use(express.raw({
  type:["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/octet-stream"],
  limit:"15mb"
}));
app.use(express.static(path.join(__dirname,"public")));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes("localhost")
    ? {rejectUnauthorized:false} : false
});
const q = (sql,params=[]) => pool.query(sql,params);

const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-me";

const SCHEMA = `
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
`;

function clean(v){ return String(v ?? "").trim(); }
function money(v){ return Number(v || 0).toFixed(2); }
function ref(){
  return "FS-" + Date.now().toString(36).toUpperCase() + "-" +
         crypto.randomBytes(2).toString("hex").toUpperCase();
}
function authToken(){
  const body = `${ADMIN_USER}.${Date.now()}`;
  const sig = crypto.createHmac("sha256",ADMIN_PASSWORD).update(body).digest("hex");
  return Buffer.from(`${body}.${sig}`).toString("base64url");
}
function validToken(token){
  try{
    const raw=Buffer.from(String(token||""),"base64url").toString();
    const p=raw.split(".");
    if(p.length!==3 || p[0]!==ADMIN_USER) return false;
    const ts=Number(p[1]);
    if(!Number.isFinite(ts) || Date.now()-ts>24*60*60*1000) return false;
    const expected=crypto.createHmac("sha256",ADMIN_PASSWORD).update(`${p[0]}.${p[1]}`).digest("hex");
    return crypto.timingSafeEqual(Buffer.from(p[2]),Buffer.from(expected));
  }catch{return false;}
}
function admin(req,res,next){
  const h=req.headers.authorization||"";
  if(h.startsWith("Bearer ") && validToken(h.slice(7))) return next();
  res.status(401).json({error:"Unauthorized"});
}
function normHeader(v){ return clean(v).toLowerCase().replace(/\s+/g," "); }

async function boot(){
  await q(SCHEMA);
  console.log("FeeSetu database ready");
}

app.get("/api/health",async(req,res)=>{
  try{await q("select 1");res.json({ok:true,service:"FeeSetu"})}
  catch(e){res.status(500).json({ok:false})}
});

app.get("/api/settings",async(req,res)=>{
  const r=await q("select organization_name,welcome_message,upi_id,receipt_prefix,logo_url from settings where id=1");
  res.json(r.rows[0]||{organization_name:"FeeSetu"});
});

app.post("/api/admin/login",async(req,res)=>{
  const {username,password}=req.body||{};
  if(username===ADMIN_USER && password===ADMIN_PASSWORD) return res.json({ok:true,token:authToken()});
  res.status(401).json({error:"Username या Password गलत है।"});
});

app.get("/api/admin/settings",admin,async(req,res)=>{
  res.json((await q("select * from settings where id=1")).rows[0]||{});
});

app.post("/api/settings",admin,async(req,res)=>{
  const b=req.body||{};
  const r=await q(`UPDATE settings SET organization_name=$1,welcome_message=$2,upi_id=$3,receipt_prefix=$4,logo_url=$5 WHERE id=1 RETURNING *`,
    [clean(b.organization_name)||"FeeSetu",clean(b.welcome_message)||"विद्यार्थी शुल्क भुगतान",
     clean(b.upi_id),clean(b.receipt_prefix)||"FS",clean(b.logo_url)]);
  res.json(r.rows[0]);
});

/* Fixed search mapping: each mode has its own server-side field. */
app.get("/api/students/search",async(req,res)=>{
  const type=String(req.query.type||"");
  const value=clean(req.query.identifier);
  if(!value) return res.status(400).json({error:"कृपया जानकारी दर्ज करें।"});
  let sql, params=[value];

  if(type==="enrollment"){
    sql=`SELECT * FROM students
         WHERE status='ACTIVE' AND lower(trim(enrollment_number))=lower(trim($1))
         LIMIT 10`;
  }else if(type==="roll"){
    sql=`SELECT * FROM students
         WHERE status='ACTIVE' AND lower(trim(roll_number))=lower(trim($1))
         LIMIT 10`;
  }else if(type==="mobile"){
    params=[value.replace(/\D/g,"")];
    sql=`SELECT * FROM students
         WHERE status='ACTIVE'
         AND regexp_replace(mobile,'\\D','','g')=regexp_replace($1,'\\D','','g')
         LIMIT 10`;
  }else{
    return res.status(400).json({error:"Invalid search mode"});
  }
  const r=await q(sql,params);
  res.json({students:r.rows});
});

app.get("/api/students/:id/history",async(req,res)=>{
  const r=await q(`SELECT amount,status,created_at,transaction_id,payment_reference
                   FROM payments WHERE student_id=$1
                   ORDER BY created_at DESC LIMIT 8`,[req.params.id]);
  res.json({payments:r.rows});
});

app.get("/api/students/:id/fee",async(req,res)=>{
  const r=await q(`SELECT fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name
                   FROM fee_assignments fa
                   JOIN fee_heads fh ON fh.id=fa.fee_head_id
                   WHERE fa.student_id=$1 AND fa.status='UNPAID' AND fa.amount>0
                   ORDER BY fa.id`,[req.params.id]);
  res.json({items:r.rows});
});

/* Admin students */
app.get("/api/students",admin,async(req,res)=>{
  res.json((await q("SELECT * FROM students WHERE status='ACTIVE' ORDER BY id DESC")).rows);
});
app.put("/api/students/:id",admin,async(req,res)=>{
  const b=req.body||{};
  try{
    const r=await q(`UPDATE students SET
      enrollment_number=$1,admission_number=$2,roll_number=$3,student_name=$4,
      father_name=$5,mother_name=$6,mobile=$7,email=$8,course=$9,class=$10,
      semester=$11,year=$12,batch=$13,session=$14,address=$15,photo_url=$16,updated_at=now()
      WHERE id=$17 RETURNING *`,
      [clean(b.enrollment_number),clean(b.admission_number),clean(b.roll_number),clean(b.student_name),
       clean(b.father_name),clean(b.mother_name),clean(b.mobile),clean(b.email),clean(b.course),
       clean(b.class),clean(b.semester),clean(b.year),clean(b.batch),clean(b.session),clean(b.address),
       clean(b.photo_url),req.params.id]);
    if(!r.rows[0])return res.status(404).json({error:"विद्यार्थी नहीं मिला।"});
    res.json(r.rows[0]);
  }catch(e){
    res.status(409).json({error:e.code==="23505"?"Enrollment Number पहले से मौजूद है।":"Student update failed"});
  }
});
app.delete("/api/students/:id",admin,async(req,res)=>{
  const r=await q("UPDATE students SET status='INACTIVE',updated_at=now() WHERE id=$1 RETURNING id",[req.params.id]);
  if(!r.rows[0])return res.status(404).json({error:"विद्यार्थी नहीं मिला।"});
  res.json({ok:true});
});
app.post("/api/students/archive-all",admin,async(req,res)=>{
  const r=await q("UPDATE students SET status='INACTIVE',updated_at=now() WHERE status='ACTIVE'");
  res.json({count:r.rowCount});
});
app.delete("/api/students/inactive/purge",admin,async(req,res)=>{
  const r=await q(`SELECT count(*)::int c FROM payments p
                   JOIN students s ON s.id=p.student_id
                   WHERE s.status='INACTIVE' AND p.status='SUCCESS'`);
  if(Number(r.rows[0].c)>0) return res.status(400).json({
    error:"Inactive विद्यार्थियों में successful payment history मौजूद है। सुरक्षा के लिए purge रोक दिया गया है।"
  });
  const d=await q("DELETE FROM students WHERE status='INACTIVE'");
  res.json({count:d.rowCount});
});

/* Excel template/import */
app.get("/api/students/template.xlsx",admin,async(req,res)=>{
  const wb=new ExcelJS.Workbook();
  const ws=wb.addWorksheet("Students");
  const headers=["Enrollment Number","Admission Number","Roll Number","Student Name","Father Name","Mother Name",
                 "Mobile","Email","Course","Class","Semester","Year","Batch","Session","Address","Photo URL"];
  ws.addRow(headers);
  ws.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};
  ws.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FFD97706"}};
  headers.forEach((h,i)=>ws.getColumn(i+1).width=Math.max(16,Math.min(30,h.length+4)));
  res.setHeader("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition",'attachment; filename="FeeSetu-Student-Template.xlsx"');
  await wb.xlsx.write(res);res.end();
});

const ALIAS={
 "enrollment number":"enrollment_number","enrollment no":"enrollment_number","enrollment":"enrollment_number",
 "admission number":"admission_number","admission no":"admission_number",
 "roll number":"roll_number","roll no":"roll_number","roll":"roll_number",
 "student name":"student_name","name":"student_name","father name":"father_name","father":"father_name",
 "mother name":"mother_name","mother":"mother_name","mobile":"mobile","mobile number":"mobile","mobile no":"mobile",
 "email":"email","email id":"email","course":"course","class":"class","semester":"semester","sem":"semester",
 "year":"year","batch":"batch","session":"session","address":"address","photo url":"photo_url"
};

app.post("/api/students/import-xlsx",admin,async(req,res)=>{
  try{
    const wb=new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(req.body));
    const ws=wb.worksheets[0];
    const map={};
    ws.getRow(1).eachCell((c,i)=>map[normHeader(c.value)]=i);
    const get=(row,key)=>map[key]?clean(row.getCell(map[key]).value):"";

    let imported=0,updated=0,invalid=0,errors=[];
    for(let i=2;i<=ws.rowCount;i++){
      const row=ws.getRow(i);
      const d={};
      for(const [label,key] of Object.entries(ALIAS)) d[key]=get(row,label);
      if(!d.enrollment_number || !d.student_name){
        invalid++;errors.push({row:i,reason:"Enrollment Number और Student Name जरूरी हैं"});continue;
      }
      const old=await q("SELECT id FROM students WHERE lower(enrollment_number)=lower($1)",[d.enrollment_number]);
      if(old.rows[0]){
        await q(`UPDATE students SET admission_number=$1,roll_number=$2,student_name=$3,father_name=$4,
          mother_name=$5,mobile=$6,email=$7,course=$8,class=$9,semester=$10,year=$11,batch=$12,
          session=$13,address=$14,photo_url=$15,status='ACTIVE',updated_at=now() WHERE id=$16`,
          [d.admission_number,d.roll_number,d.student_name,d.father_name,d.mother_name,d.mobile,d.email,
           d.course,d.class,d.semester,d.year,d.batch,d.session,d.address,d.photo_url,old.rows[0].id]);
        updated++;
      }else{
        await q(`INSERT INTO students(enrollment_number,admission_number,roll_number,student_name,father_name,
          mother_name,mobile,email,course,class,semester,year,batch,session,address,photo_url)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
          [d.enrollment_number,d.admission_number,d.roll_number,d.student_name,d.father_name,d.mother_name,
           d.mobile,d.email,d.course,d.class,d.semester,d.year,d.batch,d.session,d.address,d.photo_url]);
        imported++;
      }
    }
    res.json({total:ws.rowCount-1,imported,updated,invalid,errors});
  }catch(e){res.status(400).json({error:"Excel file पढ़ी नहीं जा सकी।"})}
});

/* Fee heads and assignment */
app.get("/api/fee-heads",admin,async(req,res)=>res.json((await q("SELECT * FROM fee_heads ORDER BY id")).rows));
app.post("/api/fee-heads",admin,async(req,res)=>{
  try{res.json((await q("INSERT INTO fee_heads(name) VALUES($1) RETURNING *",[clean(req.body.name)])).rows[0])}
  catch(e){res.status(409).json({error:"Fee Head पहले से मौजूद है।"})}
});
app.post("/api/fee-heads/:id/toggle",admin,async(req,res)=>{
  res.json((await q("UPDATE fee_heads SET active=NOT active WHERE id=$1 RETURNING *",[req.params.id])).rows[0]);
});
app.post("/api/fee-assignments/bulk",admin,async(req,res)=>{
  const ids=(req.body.student_ids||[]).map(Number).filter(Boolean), items=req.body.items||[];
  let created=0,updated=0;
  for(const sid of ids){
    for(const x of items){
      const amount=Number(x.amount);
      if(!(amount>0))continue;
      const existing=await q(`SELECT id FROM fee_assignments
        WHERE student_id=$1 AND fee_head_id=$2 AND status='UNPAID' ORDER BY id DESC LIMIT 1`,
        [sid,x.fee_head_id]);
      if(existing.rows[0]){
        await q("UPDATE fee_assignments SET amount=$1,receipt_visible=$2,updated_at=now() WHERE id=$3",
          [amount,!!x.receipt_visible,existing.rows[0].id]);updated++;
      }else{
        await q(`INSERT INTO fee_assignments(student_id,fee_head_id,amount,receipt_visible,status)
          VALUES($1,$2,$3,$4,'UNPAID')`,[sid,x.fee_head_id,amount,!!x.receipt_visible]);created++;
      }
    }
  }
  res.json({ok:true,students:ids.length,created,updated,total:created+updated});
});
app.get("/api/assignments",admin,async(req,res)=>{
  res.json((await q(`SELECT fa.*,fh.name fee_head_name FROM fee_assignments fa
                     JOIN fee_heads fh ON fh.id=fa.fee_head_id WHERE fa.student_id=$1 ORDER BY fa.id`,
                     [req.query.student_id])).rows);
});
app.patch("/api/assignments/:id",admin,async(req,res)=>{
  const amount=Number(req.body.amount);
  if(!(amount>=0))return res.status(400).json({error:"Invalid amount"});
  if(amount===0){
    await q("DELETE FROM fee_assignments WHERE id=$1 AND status='UNPAID'",[req.params.id]);
    return res.json({deleted:true});
  }
  res.json((await q(`UPDATE fee_assignments SET amount=$1,receipt_visible=$2,updated_at=now()
                    WHERE id=$3 AND status='UNPAID' RETURNING *`,
                    [amount,!!req.body.receipt_visible,req.params.id])).rows[0]||{});
});
app.delete("/api/assignments/:id",admin,async(req,res)=>{
  const r=await q("DELETE FROM fee_assignments WHERE id=$1 AND status='UNPAID' RETURNING id",[req.params.id]);
  res.json({ok:!!r.rows[0]});
});

/* Payment + receipt */
app.post("/api/payments/create",async(req,res)=>{
  const sid=Number(req.body.student_id);
  const ids=(req.body.fee_assignment_ids||[]).map(Number).filter(Boolean);
  if(!sid || !ids.length)return res.status(400).json({error:"विद्यार्थी और फीस चुनें।"});
  const items=(await q(`SELECT fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name
    FROM fee_assignments fa JOIN fee_heads fh ON fh.id=fa.fee_head_id
    WHERE fa.student_id=$1 AND fa.status='UNPAID' AND fa.id=ANY($2::bigint[])`,
    [sid,ids])).rows;
  if(items.length!==ids.length)return res.status(400).json({error:"कुछ फीस अब उपलब्ध नहीं है।"});
  const amount=items.reduce((s,x)=>s+Number(x.amount),0), paymentRef=ref();
  const p=(await q("INSERT INTO payments(payment_reference,student_id,amount,status) VALUES($1,$2,$3,'PENDING') RETURNING *",
    [paymentRef,sid,amount])).rows[0];
  for(const x of items)await q(`INSERT INTO payment_items(payment_id,fee_assignment_id,fee_head_name,amount,receipt_visible)
    VALUES($1,$2,$3,$4,$5)`,[p.id,x.id,x.fee_head_name,x.amount,x.receipt_visible]);

  const settings=(await q("SELECT organization_name,upi_id FROM settings WHERE id=1")).rows[0]||{};
  let upiUrl="",qr="";
  if(settings.upi_id){
    upiUrl=`upi://pay?pa=${encodeURIComponent(settings.upi_id)}&pn=${encodeURIComponent(settings.organization_name||"FeeSetu")}&am=${encodeURIComponent(money(amount))}&cu=INR&tr=${encodeURIComponent(paymentRef)}`;
    qr=await QRCode.toDataURL(upiUrl,{width:640,margin:5,errorCorrectionLevel:"H"});
  }
  res.json({payment_reference:paymentRef,amount,upi_id:settings.upi_id||"",upi_url:upiUrl,qr_url:qr});
});

app.post("/api/payments/submit-utr",async(req,res)=>{
  const r=await q(`UPDATE payments SET transaction_id=$1,status='PENDING_VERIFICATION'
                   WHERE payment_reference=$2 RETURNING *`,
                   [clean(req.body.transaction_id),clean(req.body.payment_reference)]);
  if(!r.rows[0])return res.status(404).json({error:"Payment reference नहीं मिला"});
  res.json({ok:true});
});
app.get("/api/payments/:ref",async(req,res)=>res.json((await q("SELECT * FROM payments WHERE payment_reference=$1",[req.params.ref])).rows[0]||{}));

async function verifyPayment(id,who){
  const p=(await q("SELECT * FROM payments WHERE id=$1",[id])).rows[0];
  if(!p)throw new Error("Payment नहीं मिली");
  if(p.status==="SUCCESS")return p;
  await q("UPDATE payments SET status='SUCCESS',verified_at=now(),verified_by=$1 WHERE id=$2",[who,id]);
  await q(`UPDATE fee_assignments SET status='PAID',updated_at=now()
           WHERE id IN (SELECT fee_assignment_id FROM payment_items WHERE payment_id=$1)`,[id]);
  const existing=await q("SELECT id FROM receipts WHERE payment_id=$1",[id]);
  if(!existing.rows[0]){
    const settings=(await q("SELECT receipt_prefix FROM settings WHERE id=1")).rows[0]||{};
    const receipt=`${settings.receipt_prefix||"FS"}-${new Date().getFullYear()}-${String(Date.now()).slice(-7)}`;
    await q("INSERT INTO receipts(receipt_number,student_id,payment_id,amount) VALUES($1,$2,$3,$4)",
      [receipt,p.student_id,id,p.amount]);
  }
  return (await q("SELECT * FROM payments WHERE id=$1",[id])).rows[0];
}
app.post("/api/payments/:id/verify",admin,async(req,res)=>{
  try{res.json({ok:true,payment:await verifyPayment(req.params.id,ADMIN_USER)})}
  catch(e){res.status(400).json({error:e.message})}
});
app.post("/api/payments/:id/reject",admin,async(req,res)=>{
  const r=await q("UPDATE payments SET status='REJECTED' WHERE id=$1 RETURNING id",[req.params.id]);
  res.json({ok:!!r.rows[0]});
});
app.delete("/api/payments/:id",admin,async(req,res)=>{
  const p=(await q("SELECT status FROM payments WHERE id=$1",[req.params.id])).rows[0];
  if(!p)return res.status(404).json({error:"Payment नहीं मिली"});
  if(p.status==="SUCCESS")return res.status(400).json({error:"Successful payment delete नहीं की जा सकती।"});
  await q("DELETE FROM payments WHERE id=$1",[req.params.id]);res.json({ok:true});
});
app.get("/api/payments",admin,async(req,res)=>{
  res.json((await q(`SELECT p.*,s.student_name,s.enrollment_number,r.receipt_number
                     FROM payments p JOIN students s ON s.id=p.student_id
                     LEFT JOIN receipts r ON r.payment_id=p.id
                     ORDER BY p.created_at DESC LIMIT 500`)).rows);
});
app.get("/api/reports/payments",admin,async(req,res)=>{
  res.json((await q(`SELECT p.*,s.student_name,s.enrollment_number,r.receipt_number
                     FROM payments p JOIN students s ON s.id=p.student_id
                     LEFT JOIN receipts r ON r.payment_id=p.id
                     ORDER BY p.created_at DESC`)).rows);
});

app.get("/api/payments/:ref/receipt",async(req,res)=>{
  const r=await q(`SELECT p.*,r.receipt_number,
    s.student_name,s.enrollment_number,s.roll_number,s.father_name,s.course,s.class,s.semester,s.session,s.mobile,
    json_agg(json_build_object('fee_head_name',pi.fee_head_name,'amount',pi.amount) ORDER BY pi.id) items
    FROM payments p JOIN receipts r ON r.payment_id=p.id
    JOIN students s ON s.id=p.student_id
    JOIN payment_items pi ON pi.payment_id=p.id AND pi.receipt_visible=true
    WHERE p.payment_reference=$1
    GROUP BY p.id,r.receipt_number,s.student_name,s.enrollment_number,s.roll_number,s.father_name,s.course,s.class,s.semester,s.session,s.mobile`,
    [req.params.ref]);
  if(!r.rows[0])return res.status(404).json({error:"Receipt उपलब्ध नहीं है।"});
  res.json(r.rows[0]);
});

app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));

boot().then(()=>{
  const port=process.env.PORT||3000;
  app.listen(port,()=>console.log(`FeeSetu running on ${port}`));
}).catch(err=>{console.error(err);process.exit(1)});
