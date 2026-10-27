// Reda i18n — language switch (default: English; change in Settings → Language)
// New languages: add a block to DICT below with "your phrase": "translation".
(function () {
  const LANGS = { en: 'English', lv: 'Latviešu' };
  const getLang = () => { try { return localStorage.getItem('reda_lang') || 'en'; } catch { return 'en'; } };
  const setLang = (l) => { try { localStorage.setItem('reda_lang', LANGS[l] ? l : 'en'); } catch {} };

  const DICT = {
    lv: {
      // ---- sidebar / general ----
      '📊 Invoices': '📊 Rēķini',
      '👥 Customers & suppliers': '👥 Klienti un piegādātāji',
      '⚙️ Settings': '⚙️ Iestatījumi',
      'Log out': 'Izrakstīties',
      'Loading…': 'Ielādē…',
      'Search': 'Meklēt',
      // ---- page headings ----
      'Documents & money': 'Dokumenti un nauda',
      'Customers & suppliers': 'Klienti un piegādātāji',
      'Settings': 'Iestatījumi',
      'Welcome back': 'Laipni lūdzam atpakaļ',
      'Create your workspace': 'Izveidojiet savu darbvietu',
      'Two-step verification': 'Divfaktoru autentifikācija',
      'Two-step verification (Microsoft Authenticator)': 'Divfaktoru autentifikācija (Microsoft Authenticator)',
      'Protect your account': 'Aizsargājiet savu kontu',
      'Company & account': 'Uzņēmums un konts',
      // ---- dashboard cards ----
      'New document': 'Jauns dokuments',
      'Your documents': 'Jūsu dokumenti',
      '📦 My stock (inventory)': '📦 Mans krājums (noliktava)',
      '📷 Scan a document (optional)': '📷 Skenēt dokumentu (pēc izvēles)',
      '🛒 Purchase steps': '🛒 Iepirkuma soļi',
      '💼 By customer': '💼 Pēc klienta',
      '💰 Unpaid — who to chase, what to pay': '💰 Neapmaksāts — kam zvanīt, ko maksāt',
      '🧪 Demo data for testing': '🧪 Testa dati izmēģināšanai',
      '🏢 Company details & logo (used on printouts)': '🏢 Uzņēmuma dati un logo (uz izdrukas)',
      '👥 People in your company': '👥 Cilvēki jūsu uzņēmumā',
      // ---- scans page ----
      '📎 Scanned originals': '📎 Noskenētie origināli',
      'Scanned originals (PDF / photos)': 'Noskenētie origināli (PDF / foto)',
      'View': 'Apskatīt',
      'New scan': 'Jauns',
      'No scanned originals yet': 'Noskenētu originālu vēl nav',
      // ---- stats ----
      'Customers owe you': 'Klienti ir parādā jums',
      'You owe suppliers': 'Jūs esat parādā piegādātājiem',
      'Sales invoiced': 'Izrakstītie rēķini',
      'Sales paid': 'Apmaksātie rēķini',
      'Open offers': 'Aktīvie piedāvājumi',
      // ---- tabs / doc types ----
      'All': 'Visi',
      'Offer': 'Piedāvājums',
      'Delivery note': 'Pavadzīme',
      'Invoice': 'Rēķins',
      'Purchase bill': 'Iepirkuma rēķins',
      // ---- form labels ----
      'Type': 'Veids',
      'Customer / supplier': 'Klients / piegādātājs',
      'Currency': 'Valūta',
      'Bank account for payment': 'Bankas konts apmaksai',
      'Bank accounts (you can add more than one)': 'Bankas konti (var pievienot vairākus)',
      'Document date': 'Dokumenta datums',
      'Payment due date': 'Apmaksas termiņš',
      'Note (optional)': 'Piezīme (pēc izvēles)',
      'Products / services': 'Preces / pakalpojumi',
      'VAT country (local law)': 'PVN valsts (likums)',
      'VAT rate': 'PVN likme',
      'Sum without VAT': 'Summa bez PVN',
      'VAT amount': 'PVN summa',
      'Total with VAT': 'Kopā ar PVN',
      'Address': 'Adrese',
      'Registration no.': 'Reģistrācijas nr.',
      'VAT (PVN) no.': 'PVN (VAT) nr.',
      'Phone': 'Telefons',
      'Email': 'E-pasts',
      'Name': 'Vārds',
      'Name *': 'Nosaukums *',
      'Password': 'Parole',
      'Password (min 8 characters)': 'Parole (vismaz 8 zīmes)',
      'Password (min 8)': 'Parole (vismaz 8)',
      'Company name': 'Uzņēmuma nosaukums',
      'Your name': 'Jūsu vārds',
      'Role': 'Loma',
      'Authenticator code': 'Autentifikatora kods',
      'Language / Valoda': 'Language / Valoda',
      // ---- buttons ----
      'Add document': 'Pievienot dokumentu',
      '+ Add line': '+ Pievienot rindu',
      '📷 Scan / photo / PDF / Excel': '📷 Skenēt / foto / PDF / Excel',
      'Save company details': 'Saglabāt uzņēmuma datus',
      'Log in': 'Pieslēgties',
      '+ Add bank account': '+ Pievienot bankas kontu',
      '➕ Add 10 demo documents': '➕ Pievienot 10 testa dokumentus',
      'Delete': 'Dzēst',
      'Mark sent': 'Atzīmēt kā nosūtītu',
      '→ Invoice': '→ Rēķins',
      '→ Delivery': '→ Pavadzīme',
      '➕ Lines': '➕ Rindas',
      '💰 Pay': '💰 Maksāt',
      '✔ Accepted': '✔ Pieņemts',
      '📤 Order': '📤 Pasūtīt',
      '📥 Received': '📥 Saņemts',
      'Create account': 'Izveidot kontu',
      'Log in instead': 'Esošs konts? Ieej šeit',
      // ---- table headers ----
      'Customer': 'Klients',
      'Amount': 'Summa',
      'Paid': 'Apmaksāts',
      'Remaining': 'Atlikums',
      'Due': 'Termiņš',
      'Status': 'Statuss',
      'Product': 'Prece',
      'In stock': 'Noliktavā',
      'Unit cost (last)': 'Iepirkuma cena (pēdējā)',
      'Value': 'Vērtība',
      'Code': 'Kods',
      'Product / service': 'Prece / pakalpojums',
      'Tax code': 'PVN kods',
      'Qty': 'Daudzums',
      'Unit price': 'Vienības cena',
      'Sum': 'Summa',
      // ---- sort ----
      'Sort:': 'Kārtot:',
      'Newest first': 'Jaunākie sākumā',
      'Customer A–Z': 'Klients A–Z',
      'Amount high → low': 'Summa lielākā → mazākā',
      'Due date (soonest)': 'Termiņš (tuvākais)',
      'Unpaid first': 'Neapmaksātie sākumā',
      // ---- statuses ----
      'draft': 'melnraksts', 'sent': 'nosūtīts', 'paid': 'apmaksāts',
      'ordered': 'pasūtīts', 'received': 'saņemts',
      'accepted': 'pieņemts', 'rejected': 'noraidīts', 'delivered': 'nogādāts',
      // ---- purchase steps panel ----
      '📝 1. Decided to buy': '📝 1. Izlēmām pirkt',
      '📤 2. Ordered (email sent)': '📤 2. Pasūtīts (e-pasts nosūtīts)',
      '📥 3. In stock': '📥 3. Noliktavā',
      '✔ 4. Paid': '✔ 4. Apmaksāts',
      // ---- placeholders ----
      '🔎 Search by word, name, number or amount…': '🔎 Meklēt pēc vārda, nosaukuma, numura vai summas…',
      '🔎 Find a product…': '🔎 Atrast preci…',
      'Start typing a name, phone or email…': 'Sāciet rakstīt vārdu, telefonu vai e-pastu…',
      'Search by company, person, phone, email, registration or VAT number…': 'Meklēt uzņēmumu, personu, telefonu, e-pastu, reģistrācijas vai PVN numuru…',
      'Product or service': 'Prece vai pakalpojums',
      'Optional (CN/VAT)': 'Pēc izvēles (CN/PVN)',
      'Extra note for this document': 'Papildu piezīme šim dokumentam',
      'Bank name (e.g. Swedbank)': 'Bankas nosaukums (piem. Swedbank)',
      'SWIFT/BIC (optional)': 'SWIFT/BIC (pēc izvēles)',
      'Street, city, postal code, country': 'Iela, pilsēta, pasta indekss, valsts',
      // ---- empty states ----
      'No documents here yet — create one above. Only your company can see these.': 'Šeit vēl nav dokumentu — izveidojiet to augstāk. Tos redz tikai jūsu uzņēmums.',
      'Nothing unpaid. ✔': 'Nav neapmaksātu. ✔',
      'No purchase bills yet. Scan a supplier bill and choose “Purchase bill”.': 'Iepirkuma rēķinu vēl nav. Noskenējiet piegādātāja rēķinu un izvēlieties “Iepirkuma rēķins”.',
      'No sales invoices yet.': 'Pārdošanas rēķinu vēl nav.',
      // ---- print (PDF) ----
      'OFFER / QUOTE': 'PIEDĀVĀJUMS',
      'DELIVERY NOTE': 'PAVADZĪME',
      'INVOICE': 'RĒĶINS',
      'PURCHASE BILL': 'IEPIRKUMA RĒĶINS',
      'From': 'Izdevējs',
      'To': 'Saņēmējs',
      'Issued:': 'Izsniegts:',
      'Total incl. VAT': 'Kopā ar PVN',
      'Paid to date': 'Apmaksāts līdz šodienai',
      'Total due': 'Apmaksājama kopsumma',
      'Total offered': 'Piedāvājuma kopsumma',
      'Payment/delivery due:': 'Apmaksas/piegādes termiņš:',
      'Status:': 'Statuss:',
      'Printed on': 'Izdrukāts',
      'Generated with Reda — lite ERP for small business': 'Izveidots ar Reda — vienkāršs ERP mazajiem uzņēmumiem',
      'Pay to:': 'Maksājuma konts:',
      'Reg. no.': 'Reģ. nr.',
      'VAT no.': 'PVN nr.',
      'Bank:': 'Banka:',
      // ---- contacts view ----
      '👤 person': '👤 persona',
      '🏢 company': '🏢 uzņēmums',
      '✏️ Edit': '✏️ Labot',
      'Add contact': 'Pievienot kontaktu',
      'VAT no.': 'PVN nr.',
      'No contacts found. Add your first customer below — then you can pick them by name, phone or email when writing invoices.': 'Kontaktu nav. Pievienojiet pirmo klientu zemāk — pēc tam rēķinus varēsiet izvēlēties pēc vārda, telefona vai e-pasta.',
      'Person': 'Persona',
      'Company': 'Uzņēmums',
      // ---- login / register ----
      'Create your company workspace': 'Izveidojiet savas firmas darbvietu',
      'Log in instead': 'Esošs konts? Ieej šeit',
      'No account yet?': 'Konta vēl nav?',
      'Email': 'E-pasts',
      // ---- settings / MFA ----
      'Two-step verification (Microsoft Authenticator)': 'Divfaktoru autentifikācija (Microsoft Authenticator)',
      'Set up Microsoft Authenticator': 'Iestatīt Microsoft Authenticator',
      'Set up Microsoft Authenticator': 'Iestatīt Microsoft Authenticator',
      'Disable MFA': 'Izslēgt MFA',
      'Disable': 'Izslēgt',
      'Enable': 'Ieslēgt',
      'Save': 'Saglabāt',
      'Cancel': 'Atcelt',
      '📤 Upload logo': '📤 Augšupielādēt logo',
      '🗑 Remove logo': '🗑 Noņemt logo',
      'Demo data for testing': 'Testa dati izmēģināšanai',
      // ---- scanned / scan statuses ----
      'Scanned goods — please check': 'Noskenētas preces — pārbaudiet',
      'check': 'pārbaudīt',
      '← converted': '← konvertēts',
      // ---- contacts import / export ----
      'Import from Excel / CSV': 'Importēt no Excel / CSV',
      'Export CSV': 'Eksportēt CSV',
      'Save contact': 'Saglabāt kontaktu',
      'Cancel edit': 'Atcelt labošanu',
      'Add new contact': 'Pievienot jaunu kontaktu',
      'Clear': 'Notīrīt',
      'Reading file…': 'Nolasu failu…',
      'No contacts found — is there a "Name" column?': 'Kontakti nav atrasti — vai failā ir kolonna "Name"?',
      // ---- backups (v12) ----
      '💾 Backups': '💾 Rezerves kopijas',
      'Reda keeps everything (documents, contacts, scanned originals) in one database file. Set a folder here and Reda will save a full copy there every day — or click "Back up now" any time. Keep the 30 newest copies, older ones are removed automatically.': 'Reda glabā visu (dokumentus, kontaktus, skenētos oriģinālus) vienā datubāzes failā. Norādiet mapi, un Reda katru dienu saglabās tajā pilnu kopiju — vai arī jebkurā laikā nospiediet "Izveidot kopiju tagad". Tiek glabātas 30 jaunākās kopijas, vecākās tiek dzēstas automātiski.',
      'Backup folder (full path on the server)': 'Rezerves kopiju mape (pilnais ceļš serverī)',
      'Save a fresh copy automatically every day': 'Saglabāt svaigu kopiju automātiski katru dienu',
      'Save settings': 'Saglabāt iestatījumus',
      'Back up now': 'Izveidot kopiju tagad',
      'Download backup file': 'Lejupielādēt rezerves kopiju',
      'No backups saved yet.': 'Rezerves kopiju vēl nav.',
      'File': 'Fails',
      'Size': 'Izmērs',
      'Created': 'Izveidots',
      'Saving…': 'Saglabāju…',
      'Settings saved ✔': 'Iestatījumi saglabāti ✔',
      'Making backup…': 'Izveidoju kopiju…',
    },
  };

  // dynamic patterns (numbers inside), applied after exact phrases
  const PATTERNS = {
    lv: [
      [/VAT (\d+(?:[.,]\d+)?)%/, 'PVN $1%'],
      [/VAT (\d+(?:[.,]\d+)?)%/, 'PVN $1%'], // (kept twice: totals row + header contexts)
    ],
  };

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const caches = {};
  function rules(lang) {
    if (lang === 'en' || !DICT[lang]) return [];
    if (!caches[lang]) {
      caches[lang] = Object.entries(DICT[lang])
        .sort((a, b) => b[0].length - a[0].length)
        .map(([en, tr]) => [new RegExp(`(^|[^A-Za-z0-9])${escapeRe(en)}($|[^A-Za-z0-9])`, 'g'), (m, a, b) => a + tr + b]);
    }
    return caches[lang];
  }

  function translateHtml(html) {
    const lang = getLang();
    if (lang === 'en') return html;
    const phrasePass = (text) => {
      let out = text;
      for (const [re, rep] of rules(lang)) out = out.replace(re, rep);
      for (const [re, rep] of (PATTERNS[lang] || [])) out = out.replace(re, rep);
      return out;
    };
    // translate only text between tags — never inside <...> (class names, ids, data stay intact)
    return String(html).split(/(<[^>]*>)/).map((seg) =>
      seg.startsWith('<') ? seg : phrasePass(seg)
    ).join('');
  }
  function translateText(s) {
    const lang = getLang();
    if (lang === 'en' || !DICT[lang] || !s) return s;
    const t = DICT[lang][String(s)];
    return t || s;
  }

  // auto-translate everything the app renders via innerHTML / textContent
  const htmlDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  Object.defineProperty(Element.prototype, 'innerHTML', {
    get: htmlDesc.get,
    set(v) { htmlDesc.set.call(this, translateHtml(String(v))); },
    configurable: true,
  });
  const textDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
  Object.defineProperty(Node.prototype, 'textContent', {
    get: textDesc.get,
    set(v) { textDesc.set.call(this, translateText(v)); },
    configurable: true,
  });

  window.REDA_I18N = { getLang, setLang, translateHtml, translateText, LANGS };
  document.documentElement.lang = getLang();
})();
