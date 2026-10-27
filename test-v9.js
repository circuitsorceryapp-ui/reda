// v9 test: purchase steps (draft→ordered→received→paid) + status validation
const BASE = process.argv[2] || 'http://localhost:3222';
let cookie = '';
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ FAIL: ' + name); } }
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
(async () => {
  const suffix = Date.now() % 100000;
  const r = await api('POST', '/api/register', { companyName: 'FlowCo ' + suffix, email: 'flow' + suffix + '@t.lv', password: 'Passw0rd!23', name: 'Flow' });
  ok(r.status === 200 && r.data.ok, 'register');
  const b = await api('POST', '/api/invoices', { doc_type: 'bill', customer: 'Wood Ltd', amount: 500, due_date: '2026-11-01' });
  ok(b.status === 201 && b.data.number && b.data.number.startsWith('PUR-'), 'create bill PUR-');
  const lst = await api('GET', '/api/invoices');
  const id = lst.data.invoices.find((x) => x.number === b.data.number).id;

  // invalid status for bill
  const bad1 = await api('PATCH', '/api/invoices/status', { id, status: 'delivered' });
  ok(bad1.status === 400, 'bill rejects invalid status "delivered"');
  // walk the steps
  const s1 = await api('PATCH', '/api/invoices/status', { id, status: 'ordered' });
  ok(s1.status === 200 && s1.data.ok, 'draft → ordered');
  const bad2 = await api('PATCH', '/api/invoices/status', { id, status: 'sent' });
  ok(bad2.status === 200, 'ordered → sent also allowed (statuses list)');
  const s2 = await api('PATCH', '/api/invoices/status', { id, status: 'received' });
  ok(s2.status === 200, '→ received (goods in stock)');
  const p = await api('POST', '/api/invoices/payments', { invoice_id: id, amount: 500 });
  ok(p.status === 201, 'pay bill 500.00 → status flips to paid');
  const list = await api('GET', '/api/invoices');
  const doc = list.data.invoices.find((x) => x.id === id);
  ok(doc && doc.status === 'paid', 'bill now paid');
  ok(doc && doc.paid_cents === 50000, 'paid_cents correct');

  // conversion bill→invoice still works
  const inv = await api('POST', '/api/invoices/convert', { id, to: 'invoice' });
  ok(inv.status === 201 && inv.data.number && inv.data.number.startsWith('INV-'), 'bill → invoice conversion');

  // quote still rejects ordered
  const q = await api('POST', '/api/invoices', { doc_type: 'quote', customer: 'Buyer', amount: 10 });
  const ql = await api('GET', '/api/invoices');
  const qid = ql.data.invoices.find((x) => x.number === q.data.number).id;
  const qbad = await api('PATCH', '/api/invoices/status', { id: qid, status: 'ordered' });
  ok(qbad.status === 400, 'quote rejects "ordered"');

  console.log(`\nv9 flow: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
