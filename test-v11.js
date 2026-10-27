// v11 test: scanned originals storage + Excel/CSV contact import
const BASE = process.argv[2] || 'http://localhost:3222';
let cookie = '';
let pass = 0, fail = 0;
function ok(cond, name) { if (cond) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ FAIL: ' + name); } }
async function api(method, path, body, raw) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}

(async () => {
  const T = Date.now() % 999999;
  await api('POST', '/api/register', { companyName: 'ScanCo ' + T, email: 'sc' + T + '@t.lv', password: 'Passw0rd!23', name: 'S' });

  // --- scanned originals ---
  // 1x1 transparent PNG
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const pdf = 'data:application/pdf;base64,JVBERi0xLjQKJSBUZXN0CnRyYWlsZXIKPDwKLzw+Cg==';
  let r = await api('POST', '/api/scans', { data: png, filename: 'bill1.png' });
  ok(r.status === 201 && r.data.ok && r.data.id, 'upload PNG scan');
  const id1 = r.data.id;
  r = await api('POST', '/api/scans', { data: pdf, filename: 'inv1.pdf' });
  ok(r.status === 201, 'upload PDF scan');
  r = await api('GET', '/api/scans');
  ok(r.status === 200 && r.data.scans.length === 2, 'list shows 2 scans');
  ok(r.data.scans.every((s) => !s.data), 'list meta does not include heavy base64');
  let raw = await api('GET', '/api/scans/' + id1, null, true);
  ok(raw.status === 200 && (raw.headers.get('content-type') || '').includes('image/png'), 'serve PNG with correct mime');
  const buf = await raw.arrayBuffer();
  ok(buf.byteLength > 0, 'PNG bytes non-empty');
  // invalid mime rejected
  r = await api('POST', '/api/scans', { data: 'data:text/html;base64,PGI+aGk8L2I+', filename: 'x.html' });
  ok(r.status === 400, 'reject non-image/pdf mime');
  r = await api('POST', '/api/scans', { data: 'not-a-dataurl', filename: 'x' });
  ok(r.status === 400, 'reject garbage dataURL');
  // link to document number
  const inv = await api('POST', '/api/invoices', { doc_type: 'invoice', customer: 'SIA Klients', amount: 50 });
  r = await api('PATCH', '/api/scans', { id: id1, doc_number: inv.data.number });
  ok(r.status === 200, 'PATCH link scan to doc number');
  r = await api('GET', '/api/scans');
  ok(r.data.scans.find((s) => s.id === id1).doc_number === inv.data.number, 'link round-trips');
  // delete
  r = await api('DELETE', '/api/scans?id=' + id1);
  ok(r.status === 200, 'delete scan');
  r = await api('GET', '/api/scans');
  ok(r.data.scans.length === 1, 'one scan left after delete');

  // --- contacts import ---
  const contacts = [
    { kind: 'company', name: 'SIA Alfa', reg_no: '40001000001', vat_no: 'LV40001000001', email: 'alfa@t.lv', phone: '+371 1', address: 'Rīga' },
    { kind: 'supplier', name: 'SIA Beta', reg_no: '40001000002', vat_no: 'LV40001000002', email: 'beta@t.lv', phone: '+371 2', address: 'Liepāja' },
    { name: 'Jānis Bērziņš', email: 'janis@t.lv', phone: '+371 3' },
  ];
  r = await api('POST', '/api/contacts/import', { contacts });
  ok(r.status === 201 && r.data.added === 3, 'import 3 contacts (added=' + (r.data && r.data.added) + ')');
  r = await api('GET', '/api/contacts');
  ok(r.data.contacts.length === 3, 'list shows 3 contacts');
  ok(r.data.contacts.some((c) => c.name === 'Jānis Bērziņš' && c.kind === 'company'), 'row without kind defaults to company');
  // dedupe: re-import same → 0 added
  r = await api('POST', '/api/contacts/import', { contacts });
  ok(r.status === 201 && r.data.added === 0, 're-import dedupes by name (added 0)');
  // dedupe within batch (same vat twice in one batch)
  r = await api('POST', '/api/contacts/import', { contacts: [
    { name: 'SIA Gama', vat_no: 'LV999' },
    { name: 'SIA Gama Dup', vat_no: 'LV999' },
  ]});
  ok(r.data.added === 1, 'dedupe within one batch by VAT');
  // dedupe by name (only applies when the existing contact has no VAT no.)
  r = await api('POST', '/api/contacts/import', { contacts: [{ name: 'jānis bērziņš' }] });
  ok(r.data.added === 0, 'dedupe by name (case-insensitive, no-VAT contact)');
  // rows without name skipped
  r = await api('POST', '/api/contacts/import', { contacts: [{ name: '', email: 'x@t.lv' }, { email: 'y@t.lv' }] });
  ok(r.data.added === 0, 'rows without name are skipped');
  // >500 rows are capped at 500
  r = await api('POST', '/api/contacts/import', { contacts: Array.from({ length: 501 }, (_, i) => ({ name: 'N' + i })) });
  ok(r.status === 201 && r.data.added === 500, 'batch capped at 500 rows (added ' + (r.data && r.data.added) + ')');

  // --- tenant isolation ---
  cookie = '';
  await api('POST', '/api/register', { companyName: 'IsoCo ' + T, email: 'ic' + T + '@t.lv', password: 'Passw0rd!23', name: 'I' });
  r = await api('GET', '/api/scans');
  ok(r.data.scans.length === 0, 'other tenant sees no scans');
  r = await api('GET', '/api/contacts');
  ok(r.data.contacts.length === 0, 'other tenant sees no contacts');
  r = await api('POST', '/api/contacts/import', { contacts: [{ name: 'SIA Alfa' }] });
  ok(r.data.added === 1, 'other tenant can import same name (separate data)');

  console.log('\nv11 tests: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
