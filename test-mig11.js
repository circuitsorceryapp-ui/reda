// migration check: old v6-era DB upgrades cleanly, old data intact, new features work
const BASE = 'http://localhost:3232';
let cookie = '';
async function api(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ FAIL: ' + n); } };

(async () => {
  // old user from build-mig95.js — need credentials; check crypto helper for known seed
  // build-mig95 inserts a user via hashPassword — read its tail for email/password
  const r = await api('POST', '/api/login', { email: process.env.MIG_EMAIL, password: process.env.MIG_PASS });
  ok(r.status === 200 && !r.data.error, 'old user can log in after migration');
  const inv = await api('GET', '/api/invoices');
  ok(inv.data.invoices.length === 2, 'old invoices survived (2)');
  ok(inv.data.invoices.some((x) => x.customer === 'SIA KVILLER'), 'Latvian name prefix cleaned in invoices');
  ok(inv.data.invoices.some((x) => x.number === 'PUR-0001'), 'old bill PUR-0001 present');
  const c = await api('GET', '/api/contacts');
  ok(c.data.contacts.some((x) => x.name === 'SIA Mežs'), 'contact name prefix cleaned');
  // new v11 features work on migrated DB
  const s = await api('POST', '/api/scans', { data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', filename: 'm.png' });
  ok(s.status === 201, 'scans table auto-created on old DB, upload works');
  const i = await api('POST', '/api/contacts/import', { contacts: [{ name: 'SIA Jaunais' }] });
  ok(i.status === 201 && i.data.added === 1, 'contact import works on migrated DB');
  const p = await api('GET', '/api/company');
  ok(Array.isArray(p.data.banks), 'banks array available on migrated DB');
  console.log('\nmigration: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
