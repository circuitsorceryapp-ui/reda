// v12 test: backup folder settings, back up now, download, auto flag
const BASE = process.argv[2] || 'http://localhost:3222';
let cookie = '';
let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ FAIL: ' + n); } };
async function api(method, p, body, raw) {
  const res = await fetch(BASE + p, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  if (raw) return res;
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const fs = require('node:fs');
const BK = '/tmp/reda-bk-test';

(async () => {
  const T = Date.now() % 999999;
  await api('POST', '/api/register', { companyName: 'BkCo ' + T, email: 'bk' + T + '@t.lv', password: 'Passw0rd!23', name: 'B' });

  let r = await api('GET', '/api/backup');
  ok(r.status === 200 && r.data.folder === '' && r.data.auto === false && Array.isArray(r.data.files), 'backup settings start empty');

  // run without folder → clear error
  r = await api('POST', '/api/backup/run', {});
  ok(r.status === 400 && /folder/i.test(r.data.error), 'back up now without folder → helpful error');

  // bad folder (a file, not a folder)
  fs.writeFileSync('/tmp/reda-bk-file', 'x');
  r = await api('POST', '/api/backup', { folder: '/tmp/reda-bk-file', auto: true });
  ok(r.status === 400, 'folder pointing at a file rejected');

  // set a good folder
  fs.rmSync(BK, { recursive: true, force: true });
  r = await api('POST', '/api/backup', { folder: BK, auto: true });
  ok(r.status === 200 && r.data.folder === BK && r.data.auto === true, 'save backup folder + auto flag');
  r = await api('GET', '/api/backup');
  ok(r.data.folder === BK && r.data.auto === true, 'settings round-trip');

  // back up now
  r = await api('POST', '/api/backup/run', {});
  ok(r.status === 201 && /^reda-backup-\d{4}-\d\d-\d\d/.test(r.data.file), 'back up now creates timestamped file');
  ok(r.data.files.length === 1, 'file listed');
  const bytes = fs.readFileSync(BK + '/' + r.data.file);
  ok(bytes.slice(0, 15).toString() === 'SQLite format 3', 'backup file is a valid SQLite database');
  const { DatabaseSync } = require('node:sqlite');
  const bdb = new DatabaseSync(BK + '/' + r.data.file, { readOnly: true });
  ok(bdb.prepare('SELECT COUNT(*) c FROM tenants').get().c >= 1, 'backup opens and contains company data');
  bdb.close();

  // second backup, list grows
  const r2 = await api('POST', '/api/backup/run', {});
  ok(r2.data.files.length === 2, 'second backup listed (2 files)');

  // download endpoint
  const dl = await api('GET', '/api/backup/download', null, true);
  ok(dl.status === 200 && (dl.headers.get('content-disposition') || '').includes('attachment'), 'download served as attachment');
  const buf = Buffer.from(await dl.arrayBuffer());
  ok(buf.slice(0, 15).toString() === 'SQLite format 3', 'downloaded file is valid SQLite');

  // auto flag off
  r = await api('POST', '/api/backup', { folder: BK, auto: false });
  ok(r.data.auto === false, 'auto flag can be turned off');

  // requires login
  const savedCookie = cookie; cookie = '';
  const anon = await fetch(BASE + '/api/backup');
  ok(anon.status === 401 || anon.status === 403, 'backup endpoints require login');
  cookie = savedCookie;

  console.log('\nv12 tests: ' + pass + ' pass, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
