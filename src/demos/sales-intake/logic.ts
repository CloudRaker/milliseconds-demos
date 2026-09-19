export const INTENTS = {
  sales: 'The sender is interested in purchasing our software or requests a demo or pricing.',
  support: 'The sender needs help using our product or managing an existing subscription.',
  careers: 'The sender is seeking a job.',
  vendor: 'The sender wants to sell their product or services to our company.',
  other: 'The message purpose is unclear.',
};
export type Intent = keyof typeof INTENTS;
export const TEAMS: Record<Intent, string> = { sales: 'Sales', support: 'Customer support', careers: 'People team', vendor: 'Vendor review', other: 'Human review' };
export const FIELDS = { company: 'Company', contact: 'Contact', email: 'Email', need: 'Stated need', timing: 'Timing', budget: 'Budget' } as const;
export type Field = keyof typeof FIELDS;
export const SCHEMA = { type: 'object', properties: Object.fromEntries(Object.keys(FIELDS).map(key => [key, { type: 'string', description: ({company:'the sender company name, not the recipient company',contact:'the sender person name',email:'the sender email address',need:'the product or task the sender needs help with',timing:'the explicitly stated purchase or rollout timeline',budget:'the explicitly stated purchase budget, not a price offered by a vendor'} as Record<string,string>)[key] }])) };
export const DEFAULT_CRITERIA = ['Needs to automate document or invoice processing', 'Explicitly wants to evaluate or buy software', 'Is planning a project or purchase soon, such as next month'];
export const DIMENSIONS = ['Use-case fit', 'Purchase intent', 'Timing fit'];
export type Match = 'match' | 'not_fit' | 'unknown';
export type Fact = { value: string; verified: boolean; edited?: boolean };
export type Lead = { intent: Intent; routeReview: boolean; facts: Record<Field, Fact>; fit: Match[] };
export function fitLabels(criterion: string) { return { match: `The message explicitly meets this criterion: ${criterion}`, not_fit: `The message explicitly contradicts this criterion: ${criterion}`, unknown: `The message does not provide enough information to evaluate this criterion: ${criterion}` }; }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The model returned an invalid record. Retry the inbox.'); return value as Record<string, unknown>; }
export function batch(value: unknown, length: number): unknown[] { const rows = object(value).results; if (!Array.isArray(rows) || rows.length !== length) throw new Error('The model returned an incomplete batch. Retry the inbox.'); return rows; }
export function classification(value: unknown, labels: Record<string, string>): {label:string; uncertain:boolean} { const row = object(value); if (typeof row.label !== 'string' || !Object.hasOwn(labels,row.label) || typeof row.probability !== 'number' || !Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) throw new Error('The model returned an invalid classification. Retry the inbox.'); return {label:row.label, uncertain:row.probability < 0.8}; }
export function factsFrom(value: unknown, source: string): Record<Field, Fact> { const data = object(object(value).data); return Object.fromEntries(Object.keys(FIELDS).map(key => { const raw = data[key]; if (raw !== null && raw !== undefined && typeof raw !== 'string') throw new Error('The model returned a field with the wrong type. Retry the inbox.'); const text = typeof raw === 'string' ? raw.trim() : ''; return [key, {value:text, verified:!!text && source.includes(text)}]; })) as Record<Field, Fact>; }
export function fitFrom(value: unknown, criterion: string): Match { const result = classification(value, fitLabels(criterion)); return result.uncertain ? 'unknown' : result.label as Match; }
export function score(fit: Match[], weights: number[]): {value:number|null; coverage:number} { const total = weights.reduce((a,b)=>a+b,0); const known = fit.reduce((sum,v,i)=>sum+(v==='unknown'?0:weights[i]),0); const points = fit.reduce((sum,v,i)=>sum+(v==='match'?weights[i]:0),0); return {value:known ? Math.round(points / known * 100) : null,coverage:total ? Math.round(known / total * 100) : 0}; }
export function missing(lead: Lead): string[] { if (lead.intent !== 'sales') return []; return (['company','email','need'] as Field[]).filter(key => !lead.facts[key].value || !lead.facts[key].verified).map(key=>FIELDS[key]); }
export function destination(lead: Lead) { return lead.routeReview ? 'Human review' : TEAMS[lead.intent]; }
export function snippet(source:string, value:string) { const start = value ? source.indexOf(value) : -1; return start < 0 ? null : {before:source.slice(0,start), match:source.slice(start,start+value.length), after:source.slice(start+value.length)}; }

/** Without stated facts, a missing use case or timeline cannot be a rejection. */
export function groundedFit(fit: Match[], facts: Record<Field, Fact>): Match[] { return fit.map((value,i)=> (i===0 && !facts.need.verified) || (i===2 && !facts.timing.verified) ? 'unknown' : value); }

export const INTENT_KEYS: Intent[] = ['sales','support','careers','vendor'];
export const INTENT_STATEMENTS = ['The sender wants to purchase or evaluate software for their organization.','The sender asks for help with a product they already use.','The sender is applying for a job or asking about employment.','The sender is offering to sell their services to the recipient.'];
export function intentFrom(value: unknown): {label:Intent; uncertain:boolean} {
 const scores = batch(value,4).map((value,i)=> {const row=object(value);if(typeof row.probability!=='number'||!Number.isFinite(row.probability)||row.probability<0||row.probability>1||typeof row.answer!=='boolean')throw new Error('The model returned invalid intent signals. Retry the inbox.');return {label:INTENT_KEYS[i],probability:row.probability};}).sort((a,b)=>b.probability-a.probability);
 return {label:scores[0].probability<0.5?'other':scores[0].label,uncertain:scores[0].probability<0.8||scores[1].probability>=0.8};
}

export const intentRequest = (texts: string[]) => ({ texts, statements: INTENT_STATEMENTS });
export const factsRequest = (texts: string[]) => ({ texts, schema: SCHEMA });
export const fitRequest = (texts: string[], criterion: string) => ({ texts, labels: fitLabels(criterion) });
