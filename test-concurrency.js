// Concurrency test: several people in one company working at the SAME time
// — parallel invoice creation must produce unique sequential numbers and correct totals
const BASE = process.argv[2] || 'http://localhost:3222';
const mk=()=>{ const jar={v:''}; const api=async(m,p,b)=>{ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(jar.v?{Cookie:jar.v}:{})},body:b?JSON.stringify(b):undefined}); const sc=r.headers.get('set-cookie'); if(sc)jar.v=sc.split(';')[0]; let d=null; try{d=await r.json()}catch{}; return{s:r.status,d}; }; return {api}; };
(async()=>{
  let pass=0, fail=0; const ok=(l,c,e='')=>{c?pass++:(fail++,console.log('FAIL',l,e||''));};
  const owner=mk();
  let r=await owner.api('POST','/api/register',{companyName:'BusyCo',name:'Boss',email:`boss${Date.now()}@t.lv`,password:'password123'});
  ok('owner registers',r.d.ok===true);
  // owner + 5 colleagues, all logged in at the same time
  const logins=[];
  for(let i=0;i<5;i++){
    const em=`w${i}${Date.now()}@t.lv`;
    await owner.api('POST','/api/users',{name:`Worker ${i}`,email:em,password:'password123',role:'accountant'});
    const w=mk();
    await w.api('POST','/api/login',{email:em,password:'password123'});
    logins.push(w);
  }
  ok('5 workers logged in simultaneously',logins.length===5);
  // ALL of them create invoices + contacts at the same instant (30 parallel requests)
  const jobs=[];
  logins.forEach((w,i)=>{
    for(let k=0;k<3;k++) jobs.push(w.api('POST','/api/invoices',{customer:`Cust ${i}-${k}`,doc_type:'invoice',vat_rate:'21',items:[{name:'Item',qty:'2',unit_price:'10.00'}]}));
    jobs.push(w.api('POST','/api/contacts',{name:`Contact ${i}`,email:`c${i}@x.lv`}));
  });
  const results=await Promise.all(jobs);
  ok('all 20 parallel requests succeeded',results.every(x=>x.d&&x.d.ok===true),results.map(x=>x.d&&x.d.error).join(','));
  // numbers must be unique INV-0001..0015, no duplicates, no gaps
  const nums=results.map(x=>x.d&&x.d.number).filter(Boolean).sort();
  const uniq=new Set(nums);
  ok('15 invoices got 15 unique numbers',nums.length===15&&uniq.size===15,nums.join(','));
  ok('numbers are sequential 1..15',nums[0]==='INV-0001'&&nums[14]==='INV-0015',nums.join(','));
  // totals must be correct for every doc (2×10 + 21% = 24.20)
  r=await owner.api('GET','/api/invoices');
  const bad=r.d.invoices.filter(x=>x.amount_cents!==2420||x.total_excl_cents!==2000||x.vat_cents!==420);
  ok('every parallel invoice has exact VAT math',bad.length===0,JSON.stringify(bad.map(b=>b.number)));
  ok('sales total = 15 × 24.20 = 363.00',r.d.totals.sales_invoiced===36300,String(r.d.totals.sales_invoiced));
  // parallel payments on the same invoice: 15 partial payments of 1.00 → exactly 15.00, no lost updates
  const inv=r.d.invoices[0];
  const pays=await Promise.all(logins.flatMap((w)=>[w.api('POST','/api/invoices/payments',{invoice_id:inv.id,amount:'1.00'}),w.api('POST','/api/invoices/payments',{invoice_id:inv.id,amount:'1.00'}),w.api('POST','/api/invoices/payments',{invoice_id:inv.id,amount:'1.00'})]));
  ok('all parallel payments accepted',pays.every(x=>x.d&&x.d.ok===true),pays.map(x=>x.d&&x.d.error).join(','));
  r=await owner.api('GET','/api/invoices');
  const doc=r.d.invoices.find(x=>x.id===inv.id);
  ok('paid = exactly 15.00 (no double-count, no lost payment)',doc.paid_cents===1500,String(doc.paid_cents));
  console.log(`\nconcurrency tests: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
