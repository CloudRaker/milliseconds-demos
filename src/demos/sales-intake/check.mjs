import assert from 'node:assert/strict';
import { batch, classification, INTENTS, factsFrom, score, missing, snippet, fitFrom, groundedFit, intentFrom } from './logic.ts';
import { FIXTURES, sampleLeads } from './fixtures.ts';
assert.equal(FIXTURES.length,30); assert.equal(FIXTURES.filter(r=>r.split==='held-out').length,6);
assert.deepEqual(score(['match','unknown','not_fit'],[50,30,20]),{value:71,coverage:70});
assert.deepEqual(score(['unknown','unknown','unknown'],[50,30,20]),{value:null,coverage:0});
assert.deepEqual(score(['match','match','match'],[0,0,0]),{value:null,coverage:0});
assert.equal(fitFrom({label:'not_fit',probability:.6},'needs docs'),'unknown');
assert.throws(()=>batch({results:[]},2)); assert.throws(()=>classification({label:'toString',probability:.9},INTENTS));
assert.throws(()=>factsFrom({data:{company:{name:'Acme'}}},'Acme'));
assert.equal(factsFrom({data:{budget:'$400'}},'No budget stated').budget.verified,false);
assert.equal(factsFrom({data:{}},'No budget stated').budget.value,'');
assert.equal(snippet('No budget stated','$400'),null);
assert.deepEqual(snippet('Budget: $400','$400'),{before:'Budget: ',match:'$400',after:''});
const sales=sampleLeads()[0]; assert.deepEqual(missing(sales),[]);
sales.facts.email={value:'',verified:false}; assert.deepEqual(missing(sales),['Email']);
console.log('Sales Intake logic: weighted unknowns, missing facts, source spans, response guards and 30 fixtures passed.');

assert.deepEqual(groundedFit(['not_fit','match','not_fit'],factsFrom({data:{}},'hello')),['unknown','match','unknown']);

assert.deepEqual(intentFrom({results:[.99,.1,.1,.9].map(probability=>({answer:probability>=.5,probability}))}),{label:'sales',uncertain:true});
assert.deepEqual(intentFrom({results:[.1,.98,.1,.1].map(probability=>({answer:probability>=.5,probability}))}),{label:'support',uncertain:false});
assert.deepEqual(intentFrom({results:[.1,.1,.1,.1].map(probability=>({answer:false,probability}))}),{label:'other',uncertain:true});
