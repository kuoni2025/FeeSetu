require("dotenv").config();
const express=require("express"), path=require("path"), {Pool}=require("pg"), crypto=require("crypto"), QRCode=require("qrcode");
const app=express(); app.use(express.json({limit:"5mb"})); app.use(express.static(path.join(__dirname,"public")));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_URL&&process.env.DATABASE_URL.includes("localhost")?false:{rejectUnauthorized:false}});
const q=(s,p=[])=>pool.query(s,p);
const SCHEMA=`
create table if not exists settings(id int primary key default 1,organization_name text not null default 'Fee Payment Center',welcome_message text default 'विद्यार्थी शुल्क भुगतान',upi_id text default '',receipt_prefix text default 'FEE');
insert into settings(id) values(1) on conflict(id) do nothing;
create table if not exists students(id bigserial primary key,enrollment_number text unique not null,admission_number text,roll_number text,student_name text not null,father_name text,mother_name text,mobile text,email text,course text,class text,semester text,year text,batch text,session text,address text,status text default 'ACTIVE',created_at timestamptz default now());
create table if not exists fee_heads(id bigserial primary key,name text unique not null,active boolean default true);
insert into fee_heads(name) values('Tuition Fee'),('Admission Fee'),('Examination Fee'),('Library Fee'),('Sports Fee'),('Development Fee'),('Identity Card Fee'),('Other Fee') on conflict(name) do nothing;
create table if not exists fee_assignments(id bigserial primary key,student_id bigint references students(id),fee_head_id bigint references fee_heads(id),amount numeric(12,2) check(amount>=0),receipt_visible boolean default true,status text default 'UNPAID',created_at timestamptz default now());
create table if not exists payments(id bigserial primary key,payment_reference text unique not null,student_id bigint references students(id),amount numeric(12,2) check(amount>0),transaction_id text,gateway_payment_id text,status text default 'PENDING',created_at timestamptz default now());
create table if not exists receipts(id bigserial primary key,receipt_number text unique not null,student_id bigint references students(id),payment_id bigint references payments(id),amount numeric(12,2),created_at timestamptz default now());
`;
async function initDatabase(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  await q(SCHEMA);
  console.log("Database schema ready");
}
const ADMIN_USER=process.env.ADMIN_USER||"admin", ADMIN_PASS=process.env.ADMIN_PASSWORD||"change-me";
let sessions=new Set();

app.get("/api/settings",async(req,res)=>{try{res.json((await q("select * from settings where id=1")).rows[0])}catch(e){res.status(500).json({error:"Database not ready"})}});
app.post("/api/admin/login",async(req,res)=>{if(req.body.username===ADMIN_USER&&req.body.password===ADMIN_PASS){let t=crypto.randomBytes(24).toString("hex");sessions.add(t);return res.json({token:t})}res.status(401).json({error:"Invalid login"})});
function admin(req,res,next){let t=(req.headers.authorization||"").replace("Bearer ","");if(!sessions.has(t))return res.status(401).json({error:"Unauthorized"});next()}
app.post("/api/admin/logout",admin,(req,res)=>{sessions.delete((req.headers.authorization||"").replace("Bearer ",""));res.json({ok:true})});

app.get("/api/students/search",async(req,res)=>{try{let r=await q("select * from students where status='ACTIVE' and (lower(enrollment_number)=lower($1) or admission_number=$1 or roll_number=$1) limit 1",[String(req.query.identifier||"").trim()]);if(!r.rows[0])return res.status(404).json({error:"Student not found"});res.json(r.rows[0])}catch(e){res.status(500).json({error:"Database error"})}});
app.get("/api/students/:id/fee",async(req,res)=>{let r=await q("select fa.id,fa.amount,fa.receipt_visible,fh.name fee_head_name from fee_assignments fa join fee_heads fh on fh.id=fa.fee_head_id where fa.student_id=$1 and fa.status='UNPAID' and fa.amount>0 order by fh.id",[req.params.id]);res.json({items:r.rows,total:r.rows.reduce((a,x)=>a+Number(x.amount),0)})});

app.get("/api/fee-heads",admin,async(req,res)=>res.json((await q("select * from fee_heads order by id")).rows));
app.post("/api/fee-heads",admin,async(req,res)=>{let r=await q("insert into fee_heads(name,active) values($1,true) returning *",[req.body.name]);res.json(r.rows[0])});
app.post("/api/fee-heads/:id/toggle",admin,async(req,res)=>res.json((await q("update fee_heads set active=not active where id=$1 returning *",[req.params.id])).rows[0]));

app.get("/api/students",admin,async(req,res)=>res.json((await q("select * from students where status='ACTIVE' order by student_name")).rows));
app.post("/api/students/import",admin,async(req,res)=>{
 let inserted=0,duplicates=0,invalid=0;
 for(const x of req.body.rows||[]){
  const en=String(x["Enrollment Number"]||"").trim(), name=String(x["Student Name"]||"").trim();
  if(!en||!name){invalid++;continue}
  try{
   await q(`insert into students(enrollment_number,admission_number,roll_number,student_name,father_name,mother_name,mobile,email,course,class,semester,year,batch,session,address,status)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'ACTIVE')`,
   [en,x["Admission Number"],x["Roll Number"],name,x["Father Name"],x["Mother Name"],x["Mobile Number"],x["Email"],x["Course"],x["Class"],x["Semester"],x["Year"],x["Batch"],x["Session"],x["Address"]]);
   inserted++;
  }catch(e){e.code==="23505"?duplicates++:invalid++}
 }
 res.json({inserted,duplicates,invalid});
});
app.post("/api/fee-assignments/bulk",admin,async(req,res)=>{
 const ids=req.body.student_ids||[],items=req.body.items||[];
 for(const sid of ids) for(const x of items){
  await q("insert into fee_assignments(student_id,fee_head_id,amount,receipt_visible,status) values($1,$2,$3,$4,'UNPAID')",[sid,x.fee_head_id,Number(x.amount),!!x.receipt_visible]);
 }
 res.json({assigned:ids.length});
});
app.get("/api/payments",admin,async(req,res)=>res.json((await q("select p.*,s.student_name from payments p join students s on s.id=p.student_id order by p.created_at desc")).rows));
app.post("/api/settings",admin,async(req,res)=>{let r=await q("update settings set organization_name=$1,welcome_message=$2,upi_id=$3,receipt_prefix=$4 where id=1 returning *",[req.body.organization_name,req.body.welcome_message,req.body.upi_id,req.body.receipt_prefix]);res.json(r.rows[0])});

app.post("/api/payments/create",async(req,res)=>{
 const f=await q("select sum(amount) total from fee_assignments where student_id=$1 and status='UNPAID'",[req.body.student_id]);
 const amount=Number(f.rows[0].total||0),s=(await q("select * from settings where id=1")).rows[0];
 if(amount<=0)return res.status(400).json({error:"No payable fee"});
 if(!s.upi_id)return res.status(400).json({error:"Admin में UPI ID सेट करें"});
 const ref="PAY-"+crypto.randomBytes(6).toString("hex").toUpperCase();
 await q("insert into payments(payment_reference,student_id,amount,status) values($1,$2,$3,'PENDING')",[ref,req.body.student_id,amount]);
 const upi=`upi://pay?pa=${encodeURIComponent(s.upi_id)}&pn=${encodeURIComponent(s.organization_name)}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(ref)}`;
 res.json({payment_reference:ref,amount,upi_url:upi,qr_url:await QRCode.toDataURL(upi)});
});
app.get("/api/payments/:ref",async(req,res)=>{let r=await q("select * from payments where payment_reference=$1",[req.params.ref]);if(!r.rows[0])return res.status(404).json({error:"Not found"});res.json(r.rows[0])});

app.get("/api/health",async(req,res)=>{try{await q("select 1");res.json({ok:true})}catch(e){res.status(500).json({ok:false})}});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
const port=process.env.PORT||3000;
initDatabase()
  .then(()=>app.listen(port,()=>console.log("Fee Kiosk cloud app on "+port)))
  .catch(err=>{console.error("Database initialization failed:",err);process.exit(1);});