const BASE='http://localhost:3222';
let pass=0,fail=0;const ok=(l,c,e='')=>{c?pass++:(fail++,console.log('FAIL',l,e||''));};
const mk=async()=>{ // tiny cookie jar helper
  const jar={v:""};
  const api=async(m,p,b)=>{const r=await fetch(BASE+p,{method:m,headers:{'Content-Type':'application/json',...(jar.v?{Cookie:jar.v}:{})},body:b?JSON.stringify(b):undefined});const sc=r.headers.get('set-cookie');if(sc)jar.v=sc.split(';')[0];let d=null;try{d=await r.json()}catch{};return{s:r.status,d};};
  return {api,jar};
};
(async()=>{
  // owner registers a company
  const O=await mk(); const em=`own${Date.now()}@t.lv`;
  let r=await O.api('POST','/api/register',{companyName:'TeamCo',name:'Owner',email:em,password:'password123'});
  ok('owner registered',r.d.ok===true);
  r=await O.api('GET','/api/users');
  ok('starts with 1 user',r.d.users.length===1&&r.d.max===10);
  ok('owner sees self',r.d.users[0].role==='owner');

  // add 9 more users (total 10)
  for(let i=2;i<=10;i++){
    r=await O.api('POST','/api/users',{name:`Person ${i}`,email:`p${i}${Date.now()}@t.lv`,password:'password123',role:i%2?'accountant':'sales'});
    ok(`add user ${i}`,r.d.ok===true,JSON.stringify(r.d));
  }
  // 11th must be rejected
  r=await O.api('POST','/api/users',{name:'Eleven',email:`e${Date.now()}@t.lv`,password:'password123',role:'sales'});
  ok('11th user rejected',r.s===409&&/Limit reached/.test(r.d.error),JSON.stringify(r.d));

  // added user can log in and sees the same company
  const P=await mk();
  const p10=(await O.api('GET','/api/users')).d.users[9];
  r=await P.api('POST','/api/login',{email:p10.email,password:'password123'});
  ok('added user logs in',r.d.ok===true,JSON.stringify(r.d));
  r=await P.api('GET','/api/me');
  ok('same company',r.d.company==='TeamCo');
  r=await P.api('GET','/api/users');
  ok('sees all 10 colleagues',r.d.users.length===10);
  // non-owner cannot add/remove
  r=await P.api('POST','/api/users',{name:'X',email:`x${Date.now()}@t.lv`,password:'password123'});
  ok('non-owner cannot add',r.s===403);
  r=await P.api('DELETE','/api/users?id=1');
  ok('non-owner cannot remove',r.s===403);
  // non-owner still works with documents normally
  r=await P.api('POST','/api/invoices',{customer:'SIA Test',doc_type:'invoice',items:[{name:'N',qty:'1',unit_price:'5'}]});
  ok('non-owner creates documents',r.d.ok===true);

  // isolation: another company sees only its own users
  const E=await mk();
  await E.api('POST','/api/register',{companyName:'Solo',name:'S',email:`s${Date.now()}@t.lv`,password:'password123'});
  r=await E.api('GET','/api/users');
  ok('other company sees 1 user only',r.d.users.length===1&&r.d.users[0].email!==p10.email);

  // remove a user -> their session dies
  const P2=await mk(); // fresh login as victim
  r=await P2.api('POST','/api/login',{email:p10.email,password:'password123'});
  r=await P2.api('GET','/api/invoices');
  ok('victim session works before removal',r.s===200);
  r=await O.api('DELETE','/api/users?id='+p10.id);
  ok('owner removes user',r.d.ok===true);
  r=await P2.api('GET','/api/invoices');
  ok('removed user is logged out',r.s===401,JSON.stringify(r.d));
  r=await O.api('DELETE','/api/users?id='+p10.id);
  ok('double remove 404',r.s===404);
  // owner cannot remove self
  const ownId=(await O.api('GET','/api/users')).d.users.find(u=>u.email===em).id;
  r=await O.api('DELETE','/api/users?id='+ownId);
  ok('cannot remove self',!!r.d.error);
  // spot back under limit: can add again
  r=await O.api('POST','/api/users',{name:'Back',email:`b${Date.now()}@t.lv`,password:'password123'});
  ok('can add after removal',r.d.ok===true);
  console.log(`\nusers tests: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
})().catch(e=>{console.error('CRASH',e);process.exit(2)});
