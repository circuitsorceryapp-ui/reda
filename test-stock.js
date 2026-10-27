// v9.1 test: stock computation from API data (mirrors frontend logic)
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
const findId = async (number) => (await api('GET', '/api/invoices')).data.invoices.find((x) => x.number === number).id;

(async () => {
  await api('POST', '/api/register', { companyName: 'StockCo ' + Date.now() % 99999, email: 's' + Date.now() % 999999 + '@t.lv', password: 'Passw0rd!23', name: 'S' });
  // buy 10 planks @ 12.00
  const b = await api('POST', '/api/invoices', { doc_type: 'bill', customer: 'Sawmill', amount: null, items: [{ code: '4407', name: 'Oak plank', qty: 10, unit_price: 12 }] });
  ok(b.status === 201 && b.data.number.startsWith('PUR-'), 'create bill with 10 Oak planks');
  await api('PATCH', '/api/invoices/status', { id: await findId(b.data.number), status: 'received' });
  // sell 4 via invoice
  const inv = await api('POST', '/api/invoices', { doc_type: 'invoice', customer: 'Buyer', items: [{ code: '4407', name: 'Oak plank', qty: 4, unit_price: 20 }] });
  ok(inv.status === 201, 'create invoice selling 4');
  await api('PATCH', '/api/invoices/status', { id: await findId(inv.data.number), status: 'sent' });

  const list = await api('GET', '/api/invoices');
  ok(Array.isArray(list.data.invoices), 'invoice list');
  const itemsOk = list.data.invoices.every((d) => d.items == null || Array.isArray(d.items));
  ok(itemsOk, 'items is always an array on rows');

  // replicate frontend stock logic
  const stock = {};
  const moved = (d, dir) => (d.items || []).forEach((it) => {
    const key = (it.code ? it.code + ' · ' : '') + (it.name || '').trim();
    stock[key] = stock[key] || { qty: 0, cost: 0, costN: 0 };
    stock[key].qty += dir * (Number(it.qty) || 0);
    if (dir > 0 && it.unit_price_cents >= 0) { stock[key].cost += Number(it.unit_price_cents) || 0; stock[key].costN++; }
  });
  list.data.invoices.forEach((d) => {
    if (d.doc_type === 'bill' && (d.status === 'received' || d.status === 'paid')) moved(d, 1);
    if (d.doc_type === 'delivery' && d.status === 'delivered') moved(d, -1);
    if (d.doc_type === 'invoice' && (d.status === 'sent' || d.status === 'paid')) moved(d, -1);
  });
  const plank = stock['4407 · Oak plank'];
  ok(!!plank, 'Oak plank found in stock');
  ok(plank && plank.qty === 6, 'stock = 10 bought − 4 sold = 6 (got ' + (plank && plank.qty) + ')');
  ok(plank && plank.costN === 1 && plank.cost === 1200, 'unit cost 12.00 recorded from bill');
  console.log(`\nstock tests: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
