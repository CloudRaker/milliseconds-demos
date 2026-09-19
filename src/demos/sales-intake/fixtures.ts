import type { Intent, Lead, Match } from './logic.ts';
import { factsFrom } from './logic.ts';
export const FIXTURES: {id:string; subject:string; text:string; intent:Intent; split:'development'|'held-out'}[] = [
['01','Invoice automation for our team',"Hi, I'm Maya Chen at Northstar Foods. Email: maya@northstar.example. We need to automate invoice processing across our warehouses. Can we book a software demo? We want to start next month. Our budget is $12,000 per year.",'sales'],
['02','Looking at document workflows',"I'm Oliver from Cedar Studio, oliver@cedar.example. We are evaluating software to process client documents automatically. Could you share pricing? No rollout date has been set and our budget is not decided.",'sales'],
['03','Locked out of my account',"Hi, I'm Priya at Fieldwork, priya@fieldwork.example. We already use your product. Our team cannot log in after the latest update. Please help restore access today.",'support'],
['04','Engineering opportunities',"I'm Leo Martinez, leo@candidate.example. Are you hiring frontend engineers? I'd love to apply for an open role. My resume is available on request.",'careers'],
['05','More leads for your business',"I'm Drew from Pipeline Partners. We sell outsourced appointment setting. Our package starts at $900 per month. Can we pitch our service to your sales director?",'vendor'],
['06','Software for next year',"I'm Sam at Brightside Books, sam@brightside.example. We need a social media scheduling tool. Can we see a demo of your software? We plan to start next year. Budget: $2,000 annually.",'sales'],
['07','Pricing request','We need invoice extraction software. Please send your pricing and a demo link.','sales'],
['08','Renewal billing','We are already a customer. Our renewal invoice was charged twice. Please investigate.','support'],
['09','Internship','Are you accepting applications for a summer design internship?','careers'],
['10','SEO offer','We sell SEO audits and would like your company to buy our services.','vendor'],
['11','Empty greeting','Hello there.','other'],
['12','Document trial','Can we trial your document processing software next week? I am Ana at Marlow, ana@marlow.example.','sales'],
['13','No budget yet','We are researching invoice automation. No budget has been approved. Can we get pricing?','sales'],
['14','Product defect','Your export button is broken in our current subscription. Please fix it.','support'],
['15','Job follow-up','I interviewed for the designer job yesterday. Is there an update on my application?','careers'],
['16','Agency pitch','Our agency can rebuild your marketing site. Would you like to buy a package?','vendor'],
['17','Ambiguous question','Could someone call me about the thing we discussed?','other'],
['18','Missing timeline','We want to purchase document automation software. Contact Jules at Prism, jules@prism.example.','sales'],
['19','CRM tool inquiry','We want to buy a CRM for tracking sales calls, not document processing. Please send pricing.','sales'],
['20','Security questionnaire','We are assessing your product for a new purchase. Could you send a security questionnaire and price list?','sales'],
['21','Account cancellation','Please cancel our existing subscription and confirm our final bill.','support'],
['22','Resume submission','Attached is my resume for your open data engineering role.','careers'],
['23','Translation inquiry','Bonjour, nous voulons acheter votre logiciel de traitement de factures. Pouvons-nous voir une démo?','sales'],
['24','Partnership ambiguity','We might be able to work together. Let me know if you want to talk.','other'],
['25','Held-out: source role','I work at Birch Ltd, alex@birch.example. Your company was recommended by Vale. We want a demo of your invoice automation software this quarter.','sales'],
['26','Held-out: not purchasing','We already pay for your software and need to reset the administrator password.','support'],
['27','Held-out: no employer','I would like to apply for the support engineer job. My name is Lee, lee@candidate.example.','careers'],
['28','Held-out: supplier pricing','We can sell your company 5,000 qualified leads for $400. Contact our agency for a demo of our service.','vendor'],
['29','Held-out: conflicting timing','We want invoice automation software but have not agreed on timing: finance says next month, IT says next year. Can we see a demo?','sales'],
['30','Held-out: unknown','Please forward this to the appropriate person. Thank you.','other'],
].map(([id,subject,text,intent],i)=>({id,subject,text,intent:intent as Intent,split:i>=24?'held-out':'development'}));
export const SAMPLES = FIXTURES.slice(0,6);
const values = [
{company:'Northstar Foods',contact:'Maya Chen',email:'maya@northstar.example',need:'automate invoice processing',timing:'next month',budget:'$12,000 per year'},
{company:'Cedar Studio',contact:'Oliver',email:'oliver@cedar.example',need:'process client documents automatically',timing:'',budget:''},
{company:'Fieldwork',contact:'Priya',email:'priya@fieldwork.example',need:'cannot log in',timing:'',budget:''},
{company:'',contact:'Leo Martinez',email:'leo@candidate.example',need:'',timing:'',budget:''},
{company:'Pipeline Partners',contact:'Drew',email:'',need:'',timing:'',budget:''},
{company:'Brightside Books',contact:'Sam',email:'sam@brightside.example',need:'social media scheduling tool',timing:'next year',budget:'$2,000 annually'},
];
const fits: Match[][] = [['match','match','match'],['match','match','unknown'],['unknown','not_fit','unknown'],['unknown','not_fit','unknown'],['unknown','not_fit','unknown'],['not_fit','match','not_fit']];
export function sampleLeads(): Lead[] { return SAMPLES.map((row,i)=>({intent:row.intent,routeReview:false,facts:factsFrom({data:values[i]},row.text),fit:[...fits[i]]})); }
