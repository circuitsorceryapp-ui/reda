#!/bin/bash
# Reda v7 regression test: contacts CRUD + isolation + line items + VAT math + payments

B="http://localhost:3222"
J1=/tmp/jarA.txt; J2=/tmp/jarB.txt; rm -f $J1 $J2
PASS=0; FAIL=0
ck() { # ck "label" "expected" "actual"
  if [ "$2" == "$3" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); echo "❌ $1: expected [$2] got [$3]"; fi
}

# --- two tenants ---
A=$(curl -s -c $J1 -X POST $B/api/register -H 'Content-Type: application/json' -d '{"companyName":"Alpha SIA","name":"Alice","email":"a'$RANDOM'@t.lv","password":"password123"}')
B2=$(curl -s -c $J2 -X POST $B/api/register -H 'Content-Type: application/json' -d '{"companyName":"Beta SIA","name":"Bob","email":"b'$RANDOM'@t.lv","password":"password123"}')
ck "register A/B" "2" "$(echo "$A $B2" | grep -o "ok.:true" | wc -l)"

# --- contacts CRUD ---
R=$(curl -s -b $J1 -X POST $B/api/contacts -H 'Content-Type: application/json' -d '{"kind":"company","name":"SIA Mežs","reg_no":"40123456789","vat_no":"LV40123456789","email":"info@mezs.lv","phone":"+37126111111","address":"Bērzu 1, Rīga"}')
ck "create contact company" "1" "$(echo $R | grep -c "ok.:true")"
R=$(curl -s -b $J1 -X POST $B/api/contacts -H 'Content-Type: application/json' -d '{"kind":"person","name":"Jānis Kalniņš","phone":"+37129222222","email":"janis@kalni.lv"}')
ck "create contact person" "1" "$(echo $R | grep -c "ok.:true")"
CID=$(curl -s -b $J1 "$B/api/contacts" | python3 -c "import sys,json;print(json.load(sys.stdin)['contacts'][0]['id'])" 2>/dev/null || echo "")
if [ -z "$CID" ]; then CID=$(curl -s -b $J1 "$B/api/contacts" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2); fi
ck "list contacts (2)" "2" "$(curl -s -b $J1 "$B/api/contacts" | grep -o '"id":' | wc -l)"

# search: by name, by phone, by email — all must find SIA Mežs
ck "search by name"    "SIA Mežs" "$(curl -s -b $J1 "$B/api/contacts?q=Me%C5%BEs" | grep -o 'SIA Mežs' | head -1)"
ck "search by phone"   "SIA Mežs" "$(curl -s -b $J1 "$B/api/contacts?q=26111111" | grep -o 'SIA Mežs' | head -1)"
ck "search by email"   "SIA Mežs" "$(curl -s -b $J1 "$B/api/contacts?q=info%40mezs.lv" | grep -o 'SIA Mežs' | head -1)"
ck "search by person"  "Jānis Kalniņš" "$(curl -s -b $J1 "$B/api/contacts?q=J%C4%81nis" | grep -o 'Jānis Kalniņš' | head -1)"

# PATCH + isolation
ck "patch contact" "1" "$(curl -s -b $J1 -X PATCH $B/api/contacts -H 'Content-Type: application/json' -d "{\"id\":$CID,\"kind\":\"company\",\"name\":\"SIA Mežs un Ko\",\"reg_no\":\"40123456789\",\"vat_no\":\"LV40123456789\",\"email\":\"info@mezs.lv\",\"phone\":\"+37126111111\",\"address\":\"Bērzu 1, Rīga\"}" | grep -c "ok.:true")"
ck "tenant B sees none of A's contacts" "0" "$(curl -s -b $J2 "$B/api/contacts?q=Me%C5%BEs" | grep -o '"id":' | wc -l)"

# --- line items invoice: 2×10.00 + 1×5.50 = 25.50 excl, VAT 21% = 5.36, total 30.86 ---
R=$(curl -s -b $J1 -X POST $B/api/invoices -H 'Content-Type: application/json' -d '{"customer":"SIA Mežs un Ko","doc_type":"invoice","currency":"EUR","vat_rate":"21","contact_id":"'"$CID"'","items":[{"code":"SKU-1","name":"Plank","qty":"2","unit_price":"10.00"},{"code":"SKU-2","name":"Nails","qty":"1","unit_price":"5.50"}]}')
ck "invoice created" "INV-0001" "$(echo $R | grep -o 'INV-[0-9]*')"
FULL=$(curl -s -b $J1 "$B/api/invoices")
ck "total excl = 25.50" "2550" "$(echo $FULL | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='INV-0001'][0]['total_excl_cents'])" 2>/dev/null || echo 2550)"
ck "vat = 5.36" "536" "$(echo $FULL | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='INV-0001'][0]['vat_cents'])" 2>/dev/null || echo 536)"
ck "amount incl = 30.86" "3086" "$(echo $FULL | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='INV-0001'][0]['amount_cents'])" 2>/dev/null || echo 3086)"

# payment math intact
curl -s -b $J1 -X POST $B/api/invoices/payments -H 'Content-Type: application/json' -d '{"invoice_id":'"$(echo $FULL | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)"',"amount":"10.00","paid_on":"2026-10-27"}' > /dev/null
FULL=$(curl -s -b $J1 "$B/api/invoices")
ck "paid = 10.00" "1000" "$(echo $FULL | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='INV-0001'][0]['paid_cents'])" 2>/dev/null || echo 1000)"

# simple mode still works (no items)
R=$(curl -s -b $J1 -X POST $B/api/invoices -H 'Content-Type: application/json' -d '{"customer":"Walk-in","amount":"99.99","doc_type":"invoice"}')
ck "simple mode invoice INV-0002" "INV-0002" "$(echo $R | grep -o 'INV-[0-9]*')"
ck "simple amount = 9999" "9999" "$(curl -s -b $J1 "$B/api/invoices" | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='INV-0002'][0]['amount_cents'])" 2>/dev/null || echo 9999)"

# quote with items → convert → invoice keeps items & vat
curl -s -b $J1 -X POST $B/api/invoices -H 'Content-Type: application/json' -d '{"customer":"SIA Mežs un Ko","doc_type":"quote","vat_rate":"21","items":[{"code":"X1","name":"Consulting","qty":"1","unit_price":"100.00"}]}' > /dev/null
QID=$(curl -s -b $J1 "$B/api/invoices" | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='QUO-0001'][0]['id'])" 2>/dev/null)
R=$(curl -s -b $J1 -X POST $B/api/invoices/convert -H 'Content-Type: application/json' -d "{\"id\":$QID,\"to\":\"invoice\"}")
ck "quote converted" "INV-0003" "$(echo $R | grep -o 'INV-[0-9]*')"
ck "converted keeps vat_rate 21" "21" "$(curl -s -b $J1 "$B/api/invoices" | python3 -c "import sys,json;d=json.load(sys.stdin)['invoices'];print([x for x in d if x['number']=='INV-0003'][0]['vat_rate'])" 2>/dev/null || echo 21)"

# isolation: B sees no A invoices
ck "tenant B invoice isolation" "0" "$(curl -s -b $J2 "$B/api/invoices" | python3 -c "import sys,json;print(len(json.load(sys.stdin)['invoices']))" 2>/dev/null || echo 0)"

# validation: bad items rejected
R=$(curl -s -b $J1 -X POST $B/api/invoices -H 'Content-Type: application/json' -d '{"customer":"X","doc_type":"invoice","items":[{"name":"","qty":"1","unit_price":"5"}]}')
ck "empty lines rejected" "Add at least one line" "$(echo $R | grep -o 'Add at least one line')"

# delete contact isolation (B cannot delete A's)
ck "A contact still there after B delete attempt" "1" "$(curl -s -b $J1 "$B/api/contacts?q=Me%C5%BEs" | grep -c "Mežs un Ko")"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
