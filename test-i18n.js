// i18n test: loads public/i18n.js with tiny DOM shims and checks translations
const fs = require('fs');
const path = require('path');

// minimal browser shims so the IIFE can run in Node
globalThis.localStorage = { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; } };
class FakeEl {}
FakeEl.prototype.innerHTML = '';
Object.defineProperty(FakeEl.prototype, 'innerHTML', { get() { return this._h || ''; }, set(v) { this._h = v; }, configurable: true });
globalThis.Element = FakeEl;
class FakeNode {}
FakeNode.prototype.textContent = '';
Object.defineProperty(FakeNode.prototype, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; }, configurable: true });
globalThis.Node = FakeNode;
globalThis.document = { documentElement: { lang: 'en' } };
globalThis.window = globalThis;

eval(fs.readFileSync(path.join(__dirname, 'public/i18n.js'), 'utf8'));

const I = globalThis.REDA_I18N;
let pass = 0, fail = 0;
const ok = (c, name) => { if (c) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ FAIL: ' + name); } };

// default language = English
ok(I.getLang() === 'en', 'default language is English');
ok(I.translateHtml('<h1>Documents & money</h1>') === '<h1>Documents & money</h1>', 'English: no change');
ok(I.translateHtml('<h1>Generated with Reda — lite ERP for small business</h1>').includes('lite ERP'), 'English print footer unchanged');

// switch to Latvian
I.setLang('lv');
ok(I.getLang() === 'lv', 'switch to Latvian');
ok(I.translateHtml('<h1>Documents & money</h1>') === '<h1>Dokumenti un nauda</h1>', 'heading translated');
ok(I.translateHtml('<a>📊 Invoices</a>') === '<a>📊 Rēķini</a>', 'sidebar translated');
ok(I.translateHtml('<h1>INVOICE</h1><div class="num">INV-0001 · Issued: 2026-10-01</div>') === '<h1>RĒĶINS</h1><div class="num">INV-0001 · Izsniegts: 2026-10-01</div>', 'print title + Issued translated, doc number untouched');
ok(I.translateHtml('<tr><td>Sum without VAT</td><td>VAT 21%</td></tr>').includes('Summa bez PVN') && !I.translateHtml('<tr><td>Sum without VAT</td><td>VAT 21%</td></tr>').includes('VAT 21'), 'VAT 21% → PVN 21%');
ok(I.translateHtml('<span class="badge sent">sent</span>') === '<span class="badge sent">nosūtīts</span>', 'status badge text translated, class untouched');
ok(I.translateHtml('<div>SIA Mežs</div>') === '<div>SIA Mežs</div>', 'user data untouched');
ok(I.translateHtml('<div>Invoice 388T-7</div>') === '<div>Rēķins 388T-7</div>', 'embedded English word translated, number kept');
ok(I.translateText('Loading…') === 'Ielādē…', 'textContent translation');
ok(I.translateText('arbitrary user message') === 'arbitrary user message', 'unknown text left alone');
// statuses via textContent (exact match)
ok(I.translateText('draft') === 'melnraksts' && I.translateText('paid') === 'apmaksāts', 'statuses translated (draft→melnraksts, paid→apmaksāts)');
// innerHTML auto-patch installed?
const d = Object.getOwnPropertyDescriptor(globalThis.Element.prototype, 'innerHTML');
ok(d && d.set && d.set.toString().includes('translateHtml'), 'innerHTML setter patched (auto-translates all views)');
// back to English
I.setLang('en');
ok(I.translateHtml('<h1>Documents & money</h1>') === '<h1>Documents & money</h1>', 'back to English works');

console.log(`\ni18n tests: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
