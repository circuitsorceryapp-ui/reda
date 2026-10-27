// EU VAT & tax-code tests — run against a live server: node test-vat.js http://localhost:PORT
const BASE = process.argv[2] || 'http://localhost:3222';
let pass=0, fail=0; const ok=(l,c,e='')=>{c?pass++:(fail++,console.log('FAIL',l,e||''));};
const mk=()=>{ const jar={v:''}; const api=async(m,p,b)=>{ const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(jar.v?{Cookie:jar.v}:{})},body:b?JSON.stringify(b):undefined}); const sc=r.headers.get('set-cookie'); if(sc)jar.v=sc.split(';')[0]; let d=null; try{d=await r.json()}catch{}; return{s:r.status,d}; }; return {api}; };
(async()=>{
  const T=mk();
  let r=await T.api('POST','/api/register',{companyName:'VatCo',name:'V',email:`v${Date.now()}@t.lv`,password:'password123'});
  ok('register',r.d.ok===true);
  const mkInv=(vat)=>T.api('POST','/api/invoices',{customer:'X',doc_type:'invoice',vat_rate:vat,items:[{name:'Wood',qty:'1',unit_price:'10.00',tax_code:'4407'}]});
  r=await mkInv('25.5');
  ok('decimal rate accepted',r.d.ok===true,JSON.stringify(r.d));
  r=await mkInv('25,5');
  ok('comma decimal accepted',r.d.ok===true,JSON.stringify(r.d));
  r=await mkInv('abc');
  ok('garbage rate falls back to 21',r.d.ok===true,JSON.stringify(r.d));
  r=await mkInv('150');
  ok('rate 150 clamped to 100',r.d.ok===true,JSON.stringify(r.d));
  const list=await T.api('GET','/api/invoices');
  const rates=list.d.invoices.map(x=>x.vat_rate);
  ok('25.5 stored (x2)',rates.filter(x=>x===25.5).length===2,JSON.stringify(rates));
  ok('21 fallback stored',rates.includes(21));
  ok('100 clamp stored',rates.includes(100));
  const fi=list.d.invoices.find(x=>x.vat_rate===25.5);
  ok('25.5% math: excl 1000, vat 255, total 1255',fi.total_excl_cents===1000&&fi.vat_cents===255&&fi.amount_cents===1255,JSON.stringify(fi));
  ok('tax code stored',fi.items[0].tax_code==='4407',JSON.stringify(fi.items[0]));
  // quote with tax code -> convert -> invoice keeps it
  r=await T.api('POST','/api/invoices',{customer:'Y',doc_type:'quote',vat_rate:'5',items:[{name:'Plank',qty:'1',unit_price:'2.00',tax_code:'4407'}]});
  const qn=r.d.number;
  let l2=await T.api('GET','/api/invoices');
  const q=l2.d.invoices.find(x=>x.number===qn);
  r=await T.api('POST','/api/invoices/convert',{id:q.id,to:'invoice'});
  const l3=await T.api('GET','/api/invoices');
  const sold=l3.d.invoices.find(x=>x.number===r.d.number);
  ok('converted keeps tax code + vat 5',sold.items[0].tax_code==='4407'&&sold.vat_rate===5&&sold.amount_cents===210,JSON.stringify(sold));
  // old simple-mode docs still fine (no items, no breakdown)
  r=await T.api('POST','/api/invoices',{customer:'Z',doc_type:'invoice',amount:'10.00'});
  ok('simple mode still works',r.d.ok===true);
  console.log(`\nVAT/tax-code tests: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
