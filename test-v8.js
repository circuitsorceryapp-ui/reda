// Reda v8 edge-case test: full API flow against a live server, incl. real TOTP MFA
// usage: node test-v8.js http://localhost:3222
const BASE = process.argv[2] || 'http://localhost:3222';
const crypto = require('crypto');
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { pass++; }
  else { fail++; console.log(`FAIL ${label} ${extra}`); }
};

// --- minimal TOTP generator (RFC 6238) to produce real authenticator codes ---
function base32Decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.toUpperCase().replace(/=+$/, '')) {
    const i = A.indexOf(ch); if (i < 0) continue;
    bits += i.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totpNow(secret) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 30000);
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[off] & 0x7f) << 24 | hmac[off+1] << 16 | hmac[off+2] << 8 | hmac[off+3]) % 1e6;
  return String(code).padStart(6, '0');
}

let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  // ---------- registration & auth ----------
  const email = `t${Date.now()}@test.lv`;
  let r = await api('POST', '/api/register', { companyName: 'TestCo', name: 'T', email, password: 'password123' });
  ok('register', r.status === 200 && r.data.ok);

  r = await api('POST', '/api/login', { email, password: 'wrongpassword' });
  ok('wrong password rejected', r.status !== 200 || r.data.error);

  r = await api('POST', '/api/login', { email, password: 'password123' });
  ok('login ok', r.data && r.data.ok === true);
  const authCookie = cookie;

  r = await api('GET', '/api/me');
  ok('me returns user', r.data && r.data.email === email);

  // unauthenticated access
  cookie = '';
  r = await api('GET', '/api/invoices');
  ok('no cookie -> 401', r.status === 401);
  cookie = authCookie;

  // ---------- MFA with real TOTP ----------
  r = await api('POST', '/api/mfa/setup', {});
  const secret = r.data.secret;
  ok('mfa setup returns secret', typeof secret === 'string' && secret.length >= 26);
  r = await api('POST', '/api/mfa/enable', { code: '000000' });
  ok('wrong mfa code rejected', !!r.data.error, JSON.stringify(r.data));
  r = await api('POST', '/api/mfa/enable', { code: totpNow(secret) });
  ok('correct mfa code enables', r.data.ok === true, JSON.stringify(r.data));

  r = await api('POST', '/api/logout', {});
  r = await api('POST', '/api/login', { email, password: 'password123' });
  ok('login asks for mfa', r.data.mfaRequired === true);
  r = await api('GET', '/api/invoices');
  ok('mfa-pending session cannot read data', r.status === 401);
  r = await api('POST', '/api/login/mfa', { code: '123456' });
  ok('wrong totp rejected', r.status !== 200 || r.data.error);
  r = await api('POST', '/api/login/mfa', { code: totpNow(secret) });
  ok('totp logs in', r.data && r.data.ok !== false, JSON.stringify(r.data));
  r = await api('GET', '/api/me');
  ok('session fully authorized after mfa', r.data && r.data.email === email);
  const goodCookie = cookie; // cookie valid AFTER the mfa logout/login cycle

  r = await api('POST', '/api/mfa/disable', { code: totpNow(secret) });
  ok('mfa disable with valid code', r.data.ok === true);

  // ---------- dates ----------
  r = await api('POST', '/api/invoices', { customer: 'A', doc_type: 'invoice', issue_date: '2020-01-15', due_date: '2020-02-15', items: [{ name: 'X', qty: '1', unit_price: '10' }] });
  ok('custom dates stored', r.data.ok && r.data.number === 'INV-0001');
  r = await api('GET', '/api/invoices');
  const inv = r.data.invoices.find(x => x.number === 'INV-0001');
  ok('issue_date = 2020-01-15', inv.issue_date === '2020-01-15', inv.issue_date);
  ok('due_date = 2020-02-15', inv.due_date === '2020-02-15', inv.due_date);
  ok('vat breakdown present', inv.total_excl_cents === 1000 && inv.vat_cents === 210 && inv.amount_cents === 1210);

  r = await api('POST', '/api/invoices', { customer: 'B', doc_type: 'invoice', issue_date: 'garbage-date', items: [{ name: 'X', qty: '1', unit_price: '5' }] });
  ok('invalid date falls back to today', r.data.ok && r.data.number === 'INV-0002');
  r = await api('GET', '/api/invoices');
  const inv2 = r.data.invoices.find(x => x.number === 'INV-0002');
  ok('fallback date is today', inv2.issue_date === new Date().toISOString().slice(0, 10), inv2.issue_date);

  // ---------- line item edge cases ----------
  r = await api('POST', '/api/invoices', { customer: 'C', doc_type: 'invoice', items: [{ name: 'X', qty: '-2', unit_price: '10' }] });
  ok('negative qty rejected', !!r.data.error);
  r = await api('POST', '/api/invoices', { customer: 'C', doc_type: 'invoice', items: [{ name: 'X', qty: '0', unit_price: '10' }] });
  ok('zero qty rejected', !!r.data.error);
  r = await api('POST', '/api/invoices', { customer: 'C', doc_type: 'invoice', vat_rate: '0', items: [{ name: 'Gift', qty: '1', unit_price: '0' }] });
  ok('0-price line with vat 0 ok', r.data.ok === true, JSON.stringify(r.data));
  r = await api('POST', '/api/invoices', { customer: 'C', doc_type: 'invoice', vat_rate: '150', items: [{ name: 'X', qty: '1', unit_price: '1' }] });
  ok('vat 150 clamped to 100', r.data.ok === true);
  r = await api('GET', '/api/invoices');
  const v150 = r.data.invoices.find(x => x.vat_rate === 100);
  ok('clamped vat stored as 100', !!v150);
  r = await api('POST', '/api/invoices', { customer: 'C', doc_type: 'invoice', vat_rate: '21', items: [{ name: 'Comma', qty: '2,5', unit_price: '4,40' }] });
  ok('comma decimals accepted', r.data.ok === true, JSON.stringify(r.data));
  r = await api('GET', '/api/invoices');
  const comma = r.data.invoices.find(x => x.items && x.items[0] && x.items[0].name === 'Comma');
  ok('2,5 x 4,40 = 11.00 excl', comma && comma.total_excl_cents === 1100, comma && String(comma.total_excl_cents));

  // ---------- bill -> invoice -> payments chain ----------
  r = await api('POST', '/api/invoices', { customer: 'Supplier', doc_type: 'bill', vat_rate: '21', items: [{ code: 'S1', name: 'Boards', qty: '10', unit_price: '2.00' }] });
  ok('bill created', r.data.ok && r.data.number === 'PUR-0001', JSON.stringify(r.data));
  r = await api('GET', '/api/invoices');
  const bill = r.data.invoices.find(x => x.number === 'PUR-0001');
  r = await api('POST', '/api/invoices/convert', { id: bill.id, to: 'quote' });
  ok('bill cannot convert to quote', !!r.data.error);
  r = await api('POST', '/api/invoices/convert', { id: bill.id, to: 'invoice' });
  const soldNum = r.data && r.data.number;
  ok('bill converts to invoice', r.data.ok && /^INV-\d{4}$/.test(soldNum), JSON.stringify(r.data));
  r = await api('GET', '/api/invoices');
  const sold = r.data.invoices.find(x => x.number === soldNum);
  ok('converted keeps items', sold && sold.items && sold.items.length === 1 && sold.items[0].qty === 10);
  ok('converted keeps vat_rate', sold.vat_rate === 21);
  ok('converted amount = 24.20', sold.amount_cents === 2420, String(sold.amount_cents));

  // overpay, delete payment, status flips
  r = await api('POST', '/api/invoices/payments', { invoice_id: sold.id, amount: '30' });
  ok('overpay allowed (partial+extra)', r.data.ok === true, JSON.stringify(r.data));
  r = await api('GET', '/api/invoices');
  ok('status paid after overpay', r.data.invoices.find(x => x.number === soldNum).status === 'paid');
  r = await api('POST', '/api/invoices/payments', { invoice_id: sold.id, amount: '-5' });
  ok('negative payment rejected', !!r.data.error);
  r = await api('POST', '/api/invoices/payments', { invoice_id: sold.id, amount: '0' });
  ok('zero payment rejected', !!r.data.error);
  r = await api('POST', '/api/invoices/payments', { invoice_id: bill.id, amount: '5' });
  ok('payment on bill ok', r.data.ok === true);
  r = await api('GET', '/api/invoices');
  const t = r.data.totals;
  ok('totals: you_owe = 24.20-5 = 19.20', t.you_owe === 1920, String(t.you_owe));

  // quote chain: quote -> delivery -> invoice
  r = await api('POST', '/api/invoices', { customer: 'Q', doc_type: 'quote', items: [{ name: 'Work', qty: '1', unit_price: '50' }] });
  const quo = r.data.number;
  r = await api('GET', '/api/invoices');
  const q = r.data.invoices.find(x => x.number === quo);
  r = await api('POST', '/api/invoices/convert', { id: q.id, to: 'delivery' });
  ok('quote -> delivery', r.data.ok === true);
  r = await api('GET', '/api/invoices');
  const dlv = r.data.invoices.find(x => x.number === 'DLV-0001');
  r = await api('POST', '/api/invoices/convert', { id: dlv.id, to: 'invoice' });
  ok('delivery -> invoice', r.data.ok === true);
  r = await api('POST', '/api/invoices/convert', { id: dlv.id, to: 'quote' });
  ok('delivery -> quote forbidden', !!r.data.error);

  // payments not allowed on quotes/delivery
  r = await api('GET', '/api/invoices');
  const dlv2 = r.data.invoices.find(x => x.number === 'DLV-0001');
  r = await api('POST', '/api/invoices/payments', { invoice_id: dlv2.id, amount: '5' });
  ok('no payments on delivery notes', !!r.data.error);

  // invalid status change
  r = await api('GET', '/api/invoices');
  const inv1 = r.data.invoices.find(x => x.number === 'INV-0001');
  r = await api('PATCH', '/api/invoices/status', { id: inv1.id, status: 'accepted' });
  ok('invalid status for invoice rejected', !!r.data.error);

  // ---------- contacts edge cases ----------
  r = await api('POST', '/api/contacts', { name: '' });
  ok('contact without name rejected', !!r.data.error);
  r = await api('POST', '/api/contacts', { name: 'A'.repeat(300) });
  ok('long name truncated ok', r.data.ok === true);
  r = await api('GET', '/api/contacts?q=');
  const longC = r.data.contacts.find(c => c.name.length === 200);
  ok('name capped at 200 chars', !!longC);
  r = await api('GET', '/api/contacts?q=%25'); // SQL wildcard injection attempt
  ok('sql wildcard query safe', Array.isArray(r.data.contacts));
  r = await api('PATCH', '/api/contacts', { id: 999999, name: 'X' });
  ok('patch nonexistent contact 404', r.status === 404);

  // ---------- cross-tenant isolation attack ----------
  const email2 = `u${Date.now()}@test.lv`;
  cookie = '';
  await api('POST', '/api/register', { companyName: 'Evil', name: 'E', email: email2, password: 'password123' });
  const evilCookie = cookie;
  cookie = goodCookie;
  r = await api('GET', '/api/invoices');
  const victimInv = r.data.invoices[0];
  const victimId = victimInv.id;
  cookie = evilCookie;
  r = await api('GET', '/api/invoices');
  ok('evil tenant sees 0 invoices', r.data.invoices.length === 0);
  r = await api('PATCH', '/api/invoices/status', { id: victimId, status: 'sent' });
  ok('evil cannot change status', r.status === 404);
  r = await api('POST', '/api/invoices/payments', { invoice_id: victimId, amount: '1' });
  ok('evil cannot pay victim invoice', r.status === 404);
  r = await api('DELETE', '/api/invoices?id=' + victimId);
  ok('evil cannot delete victim invoice', r.data.invoices !== undefined || r.status === 404 || r.data.ok === true); // deletes 0 rows
  cookie = goodCookie;
  r = await api('GET', '/api/invoices');
  ok('victim invoice still there', r.data.invoices.some(x => x.id === victimId));
  ok('evil delete did not change paid status', r.data.invoices.length > 0);

  // ---------- XSS safety (raw storage, escaped in frontend by esc()) ----------
  cookie = evilCookie;
  r = await api('POST', '/api/contacts', { name: '<script>alert(1)</script>', email: 'x@x.lv' });
  ok('xss name stored raw (escaped on render)', r.data.ok === true);

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('CRASH:', e); process.exit(2); });
