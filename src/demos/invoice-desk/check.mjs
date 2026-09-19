// Offline policy checks, not a model-accuracy evaluation. Last eight cases are held-out edge cases.
import assert from 'node:assert/strict';
import { FIELDS, amount, parseDraft, parseEvidence, parseVerification, checks } from './logic.ts';
import { BASE, REFERENCE, invoice, previewEvidence } from './data.ts';
const source=invoice(BASE), evidence=previewEvidence(BASE,source);
const verify={matches:true,probability:.99,found:['2520.00'],value:BASE.total};
const cases=[
 {label:'complete invoice',expected:'clean'},
 ...FIELDS.map(f=>({label:`missing ${f.key}`,draft:{[f.key]:''},expected:'missing'})),
 {label:'tax and subtotal disagree with total',draft:{total:'2820.00'},expected:'conflict'},
 {label:'wrong purchase order',draft:{po:'PO-999'},expected:'conflict'},
 {label:'wrong currency',draft:{currency:'EUR'},expected:'conflict'},
 {label:'duplicate vendor and invoice',reference:{priorInvoice:BASE.invoice_number},expected:'conflict'},
 {label:'missing reference number',reference:{po:''},expected:'missing'},
 {label:'missing reference total',reference:{total:''},expected:'missing'},
 {label:'missing reference currency',reference:{currency:''},expected:'missing'},
 {label:'unsupported vendor span',evidence:{vendor:undefined},expected:'review'},
 {label:'weak customer span',evidence:{customer:{...evidence.customer,probability:.6}},expected:'review'},
 {label:'source verification finds no amount',verify:{...verify,matches:false,found:[]},expected:'review'},
 {label:'source verification finds different amount',verify:{...verify,matches:false,found:['2820.00']},expected:'conflict'},
 {label:'held-out: three-digit containment rejected',draft:{total:'520'},verify:{...verify,value:'520'},expected:'conflict'},
 {label:'held-out: stale total check',verify:{...verify,value:'999'},expected:'review'},
 {label:'held-out: malformed decimal',draft:{tax:'1,20'},expected:'review'},
 {label:'held-out: vendor and customer same name',draft:{vendor:BASE.customer},expected:'review'},
 {label:'held-out: unavailable extraction evidence',evidence:Object.fromEntries(FIELDS.map(f=>[f.key,undefined])),expected:'review'},
 {label:'held-out: invalid amount reference',reference:{total:'not known'},expected:'conflict'},
 {label:'held-out: low-confidence verification',verify:{...verify,probability:.65},expected:'review'},
 {label:'held-out: reference total changed',reference:{total:'2400'},expected:'conflict'},
];
assert.equal(cases.length,30);
for(const c of cases){const out=checks({...BASE,...c.draft},{...evidence,...c.evidence},c.verify??verify,{...REFERENCE,...c.reference});assert(c.expected==='clean'?out.every(r=>r.kind==='pass'):out.some(r=>r.kind===c.expected),c.label);}
assert.equal(amount('$2,520.00'),252000);assert.equal(amount('USD 2520.00'),252000);assert.equal(amount('2.520,00'),null);assert.equal(amount('Infinity'),null);assert.equal(amount('1.005'),null);
assert.throws(()=>parseDraft({total:{amount:10}}));assert.throws(()=>parseDraft({total:NaN}));
assert.throws(()=>parseEvidence({results:[]},source));
const rows=FIELDS.map(f=>evidence[f.key]);rows[0]={...rows[0],start:0};assert.equal(parseEvidence({results:rows},source).invoice_number,undefined);
assert.deepEqual(parseVerification({matches:false,probability:0,found:['invented']},'2520',source).found,[]);
assert.throws(()=>parseVerification({matches:true,probability:2,found:[]},'2520',source));
console.log('30 labelled policy cases passed (8 held-out); amount, payload and offset guards passed. These are not 30 model calls.');
