// v10 test: multi-bank accounts, per-doc bank, demo data, localized parsing
const BASE = process.argv[2] || 'http://localhost:3222';
let cookie = '';
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ FAIL: ' + name); } }
async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const findDoc = async (number) => (await api('GET', '/api/invoices')).data.invoices.find((x) => x.number === number);

(async () => {
  await api('POST', '/api/register', { companyName: 'BankCo ' + Date.now() % 99999, email: 'bk' + Date.now() % 999999 + '@t.lv', password: 'Passw0rd!23', name: 'B' });

  // --- multi-bank company profile ---
  let p = await api('GET', '/api/company');
  ok(p.status === 200 && Array.isArray(p.data.banks) && p.data.banks.length === 0, 'GET company: banks starts empty array');
  let r = await api('POST', '/api/company', { banks: [
    { name: 'Swedbank', iban: 'LV12HABA0000123456789', swift: 'HABALV22' },
    { name: 'Luminor', iban: 'LV98RIKO0000987654321', swift: 'RIKOLV2X' },
  ]});
  ok(r.status === 200, 'save two bank accounts');
  p = await api('GET', '/api/company');
  ok(p.data.banks.length === 2 && p.data.banks[0].name === 'Swedbank' && p.data.banks[1].iban === 'LV98RIKO0000987654321', 'both banks round-trip');
  // max 5 accounts
  await api('POST', '/api/company', { banks: [1,2,3,4,5,6,7].map((i) => ({ name: 'B' + i, iban: 'IB' + i, swift: '' })) });
  p = await api('GET', '/api/company');
  ok(p.data.banks.length === 5, 'server caps banks at 5 (got ' + p.data.banks.length + ')');

  // --- invoice with chosen bank ---
  const inv = await api('POST', '/api/invoices', { doc_type: 'invoice', customer: 'SIA Klienti', amount: 100, bank_id: 2 });
  ok(inv.status === 201, 'create invoice with bank_id 2');
  const doc = await findDoc(inv.data.number);
  ok(doc && doc.bank_id === 2, 'bank_id stored & returned on document');
  const inv2 = await api('POST', '/api/invoices', { doc_type: 'invoice', customer: 'SIA Klienti', amount: 100 });
  const doc2 = await findDoc(inv2.data.number);
  ok(doc2 && (doc2.bank_id === null || doc2.bank_id === undefined), 'no bank chosen → bank_id null');

  // --- demo data ---
  const before = (await api('GET', '/api/invoices')).data.invoices.length;
  const demo = await api('POST', '/api/demo', {});
  ok(demo.status === 201 && demo.data.created === 10, 'demo endpoint creates 10 documents');
  const after = (await api('GET', '/api/invoices')).data.invoices;
  ok(after.length === before + 10, 'list grew by 10 (got ' + (after.length - before) + ')');
  const bills = after.filter((d) => d.doc_type === 'bill');
  ok(bills.length === 3 && bills.filter((b) => b.status === 'received' || b.status === 'ordered').length === 3, 'demo: 3 purchase bills in purchase steps');
  ok(after.filter((d) => d.doc_type === 'quote').length === 1 && after.filter((d) => d.doc_type === 'delivery').length === 1, 'demo: 1 quote + 1 delivery note');
  const paidInv = after.find((d) => d.doc_type === 'invoice' && d.status === 'paid');
  ok(!!paidInv && paidInv.paid_cents === paidInv.amount_cents, 'demo: fully paid invoice exists');
  const partial = after.find((d) => d.doc_type === 'invoice' && d.paid_cents > 0 && d.paid_cents < d.amount_cents);
  ok(!!partial, 'demo: partially paid invoice exists');
  ok(after.some((d) => d.items && d.items.length && d.items[0].unit_price_cents > 0), 'demo: documents carry line items');
  // overdue demo bill: due date in the past
  const overdue = bills.find((b) => b.due_date && b.due_date < new Date().toISOString().slice(0, 10));
  ok(!!overdue, 'demo: overdue supplier bill exists (red priority)');

  // --- tenant isolation for demo ---
  const other = await api('POST', '/api/register', { companyName: 'Other ' + Date.now() % 99999, email: 'o' + Date.now() % 999999 + '@t.lv', password: 'Passw0rd!23', name: 'O' });
  ok(other.status === 200, 'second company registered');
  const otherDocs = (await api('GET', '/api/invoices')).data.invoices;
  ok(otherDocs.length === 0, 'demo documents NOT visible to other company');

  console.log(`\nv10 tests: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
