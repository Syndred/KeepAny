import { z } from 'zod';
export { parseMinorUnits, inputFromMinorUnits, formatMinorUnits } from './money';
export const kinds = ['project','account','subscription','item','vault'] as const;
export const currencies = ['CNY','USD','EUR','GBP','JPY'] as const;

// Date-only values are Gregorian calendar dates, independent of the host time zone.
// Local Date and date-fns calendar operations can skip a date (for example, Apia 2011-12-30).
function calendarDate(year:number,month:number,day:number){
 const date=new Date(0);
 date.setUTCHours(0,0,0,0);
 date.setUTCFullYear(year,month,day);
 return date;
}
function parseDateOnly(value:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('invalid-date');
 const year=Number(value.slice(0,4)),month=Number(value.slice(5,7)),day=Number(value.slice(8,10));
 const date=calendarDate(year,month-1,day);
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('invalid-date');
 return date;
}
function validDateOnly(value:string){try{parseDateOnly(value);return true;}catch{return false;}}
function formatDateOnly(date:Date){
 if(!Number.isFinite(date.getTime())||date.getUTCFullYear()<0||date.getUTCFullYear()>9999)throw Error('invalid-date');
 return `${String(date.getUTCFullYear()).padStart(4,'0')}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`;
}
// Operation markers identify committed history pairs even if the asset is edited before journal cleanup.
export const assetSchema = z.object({
 id:z.string().min(1).max(96), kind:z.enum(kinds), name:z.string().trim().min(1).max(160), category:z.string().max(100).default(''), tags:z.array(z.string().max(60)).max(100).default([]),
 description:z.string().max(20000).default(''), url:z.string().max(2000).default(''), contact:z.string().max(500).default(''), longDescription:z.string().max(30000).default(''),
 amount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),currency:z.enum(currencies).default('CNY'),cycle:z.enum(['month','year','week','day']).default('month'),interval:z.number().int().min(1).max(100).default(1),dueDate:z.string().default(''),billingAnchor:z.string().default(''),renewalCount:z.number().int().nonnegative().default(0),lastRenewalId:z.string().max(96).default(''),lastItemEventId:z.string().max(96).default(''),purchaseDate:z.string().default(''),warrantyDate:z.string().default(''),trialEndsAt:z.string().default(''),discountUntil:z.string().default(''),discountAmount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),cancelledAt:z.string().default(''),location:z.string().max(300).default(''),status:z.enum(['active','paused','cancelled','loaned','archived']).default('active'),borrower:z.string().max(200).default(''),username:z.string().max(300).default(''),notes:z.string().max(20000).default(''),attachments:z.array(z.string().uuid()).max(20).default([]),createdAt:z.string(),updatedAt:z.string(),deleted:z.boolean().default(false),
}).superRefine((v,ctx)=>{ for(const key of ['dueDate','billingAnchor','purchaseDate','warrantyDate','trialEndsAt','discountUntil'] as const) if(v[key] && !validDateOnly(v[key]))ctx.addIssue({code:'custom',path:[key],message:'date'});if(v.discountAmount>v.amount)ctx.addIssue({code:'custom',path:['discountAmount'],message:'discount'});if(v.url && !/^https?:\/\//i.test(v.url) && !(v.kind==='vault' && /^(bitwarden|onepassword):\/\//i.test(v.url)))ctx.addIssue({code:'custom',path:['url'],message:'url'}); });
export type Asset=z.infer<typeof assetSchema>;
export type AssetKind=typeof kinds[number];
export const relationSchema=z.object({id:z.string().min(1).max(96),from:z.string().min(1).max(96),to:z.string().min(1).max(96),label:z.string().min(1).max(100),source:z.string().max(500).optional(),createdAt:z.string(),verifiedAt:z.string().default(''),deleted:z.boolean().default(false)}).refine(v=>v.from!==v.to,'self-relation');
export type Relation=z.infer<typeof relationSchema>;
export const impactSnapshotSchema=z.object({
 accountId:z.string().min(1).max(96),relationId:z.string().min(1).max(96),relatedAssetId:z.string().min(1).max(96),
 fromAssetId:z.string().min(1).max(96),toAssetId:z.string().min(1).max(96),
 fromName:z.string().min(1).max(160),toName:z.string().min(1).max(160),relatedName:z.string().min(1).max(160),
 label:z.string().min(1).max(100),source:z.string().max(500),verifiedAt:z.string().max(64),generatedAt:z.string().min(1).max(64),
 legacyDedupeKey:z.string().max(200).optional(),
});
export type ImpactSnapshot=z.infer<typeof impactSnapshotSchema>;
export const taskSchema=z.object({id:z.string().min(1).max(96),name:z.string().min(1).max(300),assetId:z.string().max(96).default(''),dueDate:z.string().refine(v=>!v||validDateOnly(v),'date').default(''),done:z.boolean().default(false),completedAt:z.string().default(''),completionHistory:z.array(z.string().min(1).max(64)).default([]),createdAt:z.string(),dedupeKey:z.string().max(200).default(''),impactSnapshot:impactSnapshotSchema.optional(),deleted:z.boolean().default(false)});
export type Task=z.infer<typeof taskSchema>;
export const categorySchema=z.object({id:z.string().min(1).max(96),kind:z.enum(kinds),name:z.string().min(1).max(60),order:z.number().int(),deleted:z.boolean().default(false)});
export type Category=z.infer<typeof categorySchema>;
export const submissionSchema=z.object({id:z.string().min(1).max(96),assetId:z.string().min(1).max(96),name:z.string().min(1).max(200),url:z.string().url().refine(v=>/^https?:\/\//.test(v)),status:z.enum(['planned','submitted','review','indexed','verify','rejected']),submittedAt:z.string().default(''),verifiedAt:z.string().default(''),evidence:z.string().max(2000).default(''),deleted:z.boolean().default(false)});
export type Submission=z.infer<typeof submissionSchema>;
export const historySchema=z.object({id:z.string().min(1).max(96),assetId:z.string().min(1).max(96),action:z.enum(['loan','return','renew','maintenance']),note:z.string(),borrower:z.string().max(200).optional(),eventDate:z.string().refine(validDateOnly,'date').optional(),billDate:z.string().refine(validDateOnly,'date').optional(),amount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),currency:z.enum(currencies).optional(),createdAt:z.string(),deleted:z.boolean().default(false)});
export type History=z.infer<typeof historySchema>;
export function newAsset(kind:AssetKind):Asset{const now=new Date().toISOString();return assetSchema.parse({id:crypto.randomUUID(),kind,name:'Untitled',createdAt:now,updatedAt:now});}
export function nextDue(date:string,cycle:Asset['cycle'],interval=1){return dueOnCycle(date,cycle,interval,1);}
export function monthlyMinorUnits(asset:Asset):bigint{
  const periods=BigInt(asset.interval);
  const amount=BigInt(asset.amount);
  const numerator=asset.cycle==='week'?amount*52n:asset.cycle==='day'?amount*365n:amount;
  const denominator=periods*(asset.cycle==='year'||asset.cycle==='week'||asset.cycle==='day'?12n:1n);
  return (2n*numerator+denominator)/(2n*denominator);
}
export function monthlyAmount(asset:Asset){return Number(monthlyMinorUnits(asset));}
// Recalculate from the original anchor, so a January 31 monthly bill returns to March 31 after February.
export function dueOnCycle(anchor:string,cycle:Asset['cycle'],interval:number,periods:number){
  if(!Number.isInteger(periods)||periods<0||!Number.isInteger(interval)||interval<1)throw Error('invalid-period');
  const date=parseDateOnly(anchor);
  const count=interval*periods;
  if(!Number.isSafeInteger(count))throw Error('invalid-period');
  if(cycle==='month'||cycle==='year'){
    const months=count*(cycle==='year'?12:1);
    if(!Number.isSafeInteger(months))throw Error('invalid-period');
    const targetMonth=date.getUTCMonth()+months;
    const year=date.getUTCFullYear()+Math.floor(targetMonth/12);
    const month=targetMonth%12;
    const lastDay=calendarDate(year,month+1,0).getUTCDate();
    return formatDateOnly(calendarDate(year,month,Math.min(date.getUTCDate(),lastDay)));
  }
  const days=count*(cycle==='week'?7:1);
  if(!Number.isSafeInteger(days))throw Error('invalid-period');
  date.setUTCDate(date.getUTCDate()+days);
  return formatDateOnly(date);
}
// Estimate for one billing date; this does not confirm that a payment occurred.
// monthlyAmount remains the undiscounted planning equivalent.
export function actualCharge(asset:Asset,onDate:string){
  if(asset.kind!=='subscription'||asset.status!=='active'||asset.deleted)return null;
  parseDateOnly(onDate);
  if(asset.trialEndsAt && onDate<asset.trialEndsAt)return 0;
  return Math.max(0,asset.amount-(asset.discountUntil && onDate<=asset.discountUntil?asset.discountAmount:0));
}
export function normalizeUrl(raw:string){const u=new URL(raw);if(!['https:','http:'].includes(u.protocol))throw Error('url');u.hash='';u.hostname=u.hostname.toLowerCase();return u.toString().replace(/\/$/,'');}
export function duplicates(candidate:Asset,assets:Asset[]){return assets.filter(a=>!a.deleted&&a.kind===candidate.kind&&(a.name.trim().toLowerCase()===candidate.name.trim().toLowerCase()||(candidate.url&&a.url&&normalizeUrl(a.url)===normalizeUrl(candidate.url))));}
export const entitySchemas={asset:assetSchema,relation:relationSchema,task:taskSchema,category:categorySchema,submission:submissionSchema,history:historySchema,preference:z.object({id:z.string().min(1).max(96),value:z.unknown(),deleted:z.boolean().default(false)})};
export type EntityType=keyof typeof entitySchemas;
