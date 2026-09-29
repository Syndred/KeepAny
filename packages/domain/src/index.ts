import { z } from 'zod';
import { maintenanceScheduleSchema } from './task-repeat';
export { parseMinorUnits, inputFromMinorUnits, formatMinorUnits } from './money';
export const kinds = ['project','account','subscription','item','vault'] as const;
export const currencies = ['CNY','USD','EUR','GBP','JPY'] as const;
export const itemLifecycleStatuses = ['inUse','idle','repairing','resold','retired'] as const;
export const itemWarrantyStatuses = ['unverified','inWarranty','outOfWarranty','notApplicable'] as const;
// Domain holdings belong to a project record and are included in the same local backup/sync payload.
export const projectDomainSchema=z.object({
 id:z.string().uuid(),name:z.string().trim().min(1).max(253).regex(/^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i),
 registrar:z.string().max(200).default(''),accountId:z.string().max(96).default(''),
 expiryDate:z.string().default(''),annualAmount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().default(null),
 currency:z.enum(currencies).default('CNY'),autoRenew:z.enum(['unknown','on','off']).default('unknown'),
});
export type ProjectDomain=z.infer<typeof projectDomainSchema>;
export const projectMediaSchema=z.object({
 logoId:z.union([z.literal(''),z.string().uuid()]).default(''),homeScreenshotId:z.union([z.literal(''),z.string().uuid()]).default(''),
 productScreenshotIds:z.array(z.string().uuid()).max(4).default([]),promoCoverId:z.union([z.literal(''),z.string().uuid()]).default(''),
});
export type ProjectMedia=z.infer<typeof projectMediaSchema>;
export const itemMediaSchema=z.object({
 coverId:z.union([z.literal(''),z.string().uuid()]).default(''),
 detailIds:z.array(z.string().uuid()).max(16).default([]),
 receiptIds:z.array(z.string().uuid()).max(16).default([]),
});
export type ItemMedia=z.infer<typeof itemMediaSchema>;

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
 accountProvider:z.string().max(200).default(''),accountProfileVerifiedAt:z.string().default(''),
 projectLaunchMonth:z.string().default(''),projectInspectionDate:z.string().default(''),projectDomains:z.array(projectDomainSchema).max(50).default([]),
 projectTitle:z.string().max(300).default(''),projectPromoUrl:z.string().max(2000).default(''),projectMediumDescription:z.string().max(2500).default(''),projectFeatures:z.string().max(2500).default(''),projectPricing:z.string().max(2500).default(''),projectPricingType:z.string().max(300).default(''),projectEmail:z.string().max(300).default(''),projectMedia:projectMediaSchema.default({logoId:'',homeScreenshotId:'',productScreenshotIds:[],promoCoverId:''}),
 amount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),currency:z.enum(currencies).default('CNY'),itemPurchasePriceKnown:z.boolean().default(false),cycle:z.enum(['month','year','week','day']).default('month'),interval:z.number().int().min(1).max(100).default(1),dueDate:z.string().default(''),billingAnchor:z.string().default(''),renewalCount:z.number().int().nonnegative().default(0),lastRenewalId:z.string().max(96).default(''),lastItemEventId:z.string().max(96).default(''),purchaseDate:z.string().default(''),warrantyDate:z.string().default(''),itemStartDate:z.string().default(''),itemStatusDate:z.string().default(''),itemLifecycleStatus:z.enum(itemLifecycleStatuses).nullable().default(null),itemWarrantyStatus:z.enum(itemWarrantyStatuses).nullable().default(null),itemMedia:itemMediaSchema.default({coverId:'',detailIds:[],receiptIds:[]}),itemExpectedReturnDate:z.string().default(''),trialEndsAt:z.string().default(''),discountUntil:z.string().default(''),discountAmount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),cancelledAt:z.string().default(''),location:z.string().max(300).default(''),status:z.enum(['active','paused','cancelled','loaned','archived']).default('active'),borrower:z.string().max(200).default(''),username:z.string().max(300).default(''),notes:z.string().max(20000).default(''),attachments:z.array(z.string().uuid()).max(20).default([]),createdAt:z.string(),updatedAt:z.string(),deleted:z.boolean().default(false),
}).superRefine((v,ctx)=>{
 for(const key of ['dueDate','billingAnchor','purchaseDate','warrantyDate','itemStartDate','itemStatusDate','itemExpectedReturnDate','trialEndsAt','discountUntil','projectInspectionDate','accountProfileVerifiedAt'] as const) if(v[key] && !validDateOnly(v[key]))ctx.addIssue({code:'custom',path:[key],message:'date'});
 if(v.projectLaunchMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v.projectLaunchMonth))ctx.addIssue({code:'custom',path:['projectLaunchMonth'],message:'month'});
 for(const [index,domain] of v.projectDomains.entries())if(domain.expiryDate&&!validDateOnly(domain.expiryDate))ctx.addIssue({code:'custom',path:['projectDomains',index,'expiryDate'],message:'date'});
 if(v.discountAmount>v.amount)ctx.addIssue({code:'custom',path:['discountAmount'],message:'discount'});
 if(v.url && !/^https?:\/\//i.test(v.url) && !(v.kind==='vault' && /^(bitwarden|onepassword):\/\//i.test(v.url)))ctx.addIssue({code:'custom',path:['url'],message:'url'});
 if(v.projectPromoUrl && (!/^https?:\/\//i.test(v.projectPromoUrl) || !z.url().safeParse(v.projectPromoUrl).success))ctx.addIssue({code:'custom',path:['projectPromoUrl'],message:'url'});
 if(v.projectEmail && !z.email().safeParse(v.projectEmail).success)ctx.addIssue({code:'custom',path:['projectEmail'],message:'email'});
 const mediaIds=[v.projectMedia.logoId,v.projectMedia.homeScreenshotId,v.projectMedia.promoCoverId,...v.projectMedia.productScreenshotIds].filter(Boolean);
 if(mediaIds.length && v.kind!=='project')ctx.addIssue({code:'custom',path:['projectMedia'],message:'project-only'});
 if(new Set(mediaIds).size!==mediaIds.length || mediaIds.some(id=>!v.attachments.includes(id)))ctx.addIssue({code:'custom',path:['projectMedia'],message:'attachment-reference'});
 const itemMediaIds=[v.itemMedia.coverId,...v.itemMedia.detailIds,...v.itemMedia.receiptIds].filter(Boolean);
 if(itemMediaIds.length && v.kind!=='item')ctx.addIssue({code:'custom',path:['itemMedia'],message:'item-only'});
 if(new Set(itemMediaIds).size!==itemMediaIds.length || itemMediaIds.some(id=>!v.attachments.includes(id)))ctx.addIssue({code:'custom',path:['itemMedia'],message:'attachment-reference'});
 if(v.itemExpectedReturnDate && (v.kind!=='item' || v.status!=='loaned'))ctx.addIssue({code:'custom',path:['itemExpectedReturnDate'],message:'loaned-only'});
}).transform(v=>v.kind==='item'&&v.amount>0&&!v.itemPurchasePriceKnown?{...v,itemPurchasePriceKnown:true}:v);
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
export const projectWorkflowRecordSchema=z.object({outcome:z.enum(['done','blocked','na']),evidence:z.string().trim().min(1).max(2000),recordedAt:z.string().datetime()});
export const projectWorkflowSnapshotSchema=z.object({
 kind:z.enum(['brand','close']),roundId:z.string().uuid(),projectId:z.string().min(1).max(96),generatedAt:z.string().datetime(),
 projectName:z.string().min(1).max(160),projectDescription:z.string().max(20000),projectUrl:z.string().max(2000),
 proposedName:z.string().max(160).default(''),proposedDescription:z.string().max(2000).default(''),proposedUrl:z.string().max(2000).default(''),changeNote:z.string().max(2000).default(''),
 step:z.enum(['brandProfile','brandSubmission','brandRelation','brandDomain','closeBackup','closeHandoff','closeSubscription','closeDomain','closeBacklink','closeRelated','closeDecision']),
 sourceId:z.string().max(96).default(''),sourceName:z.string().max(300).default(''),sourceUrl:z.string().max(2048).default(''),sourceDetail:z.string().max(2000).default(''),sourceAssetId:z.string().max(96).default(''),sourceAssetKind:z.enum(kinds).optional(),
 attachmentIds:z.array(z.string().uuid()).max(20).default([]),record:projectWorkflowRecordSchema.optional(),recordHistory:z.array(projectWorkflowRecordSchema).max(50).default([]),
});
export type ProjectWorkflowSnapshot=z.infer<typeof projectWorkflowSnapshotSchema>;
export const maintenanceRecordSchema=z.object({action:z.enum(['complete','skip','defer']),actionDate:z.string().refine(validDateOnly,'date'),previousDueDate:z.string().refine(validDateOnly,'date'),nextDueDate:z.string().refine(v=>v===null||validDateOnly(v),'date').nullable(),advancedOccurrences:z.number().int().nonnegative().safe(),evidence:z.string().trim().min(1).max(1000),recordedAt:z.string().datetime()}).superRefine((record,ctx)=>{if(record.action==='defer' && (!record.nextDueDate || record.nextDueDate<=record.previousDueDate || record.advancedOccurrences!==0))ctx.addIssue({code:'custom',path:['nextDueDate'],message:'defer-date'});});
export const maintenancePlanSchema=z.object({schedule:maintenanceScheduleSchema,active:z.boolean(),deferredUntil:z.string().refine(v=>!v||validDateOnly(v),'date').default(''),records:z.array(maintenanceRecordSchema).max(1000).default([])}).superRefine((plan,ctx)=>{if(plan.deferredUntil && (!plan.active || plan.deferredUntil<=plan.schedule.dueDate))ctx.addIssue({code:'custom',path:['deferredUntil'],message:'defer-date'});});
export type MaintenancePlan=z.infer<typeof maintenancePlanSchema>;
export const taskSchema=z.object({id:z.string().min(1).max(96),name:z.string().min(1).max(300),assetId:z.string().max(96).default(''),dueDate:z.string().refine(v=>!v||validDateOnly(v),'date').default(''),done:z.boolean().default(false),completedAt:z.string().default(''),completionHistory:z.array(z.string().min(1).max(64)).default([]),createdAt:z.string(),dedupeKey:z.string().max(200).default(''),impactSnapshot:impactSnapshotSchema.optional(),projectWorkflow:projectWorkflowSnapshotSchema.optional(),maintenancePlan:maintenancePlanSchema.optional(),deleted:z.boolean().default(false)}).superRefine((task,ctx)=>{
 if(task.projectWorkflow){
  if(task.assetId!==task.projectWorkflow.projectId)ctx.addIssue({code:'custom',path:['assetId'],message:'workflow-project'});
  const record=task.projectWorkflow.record;const complete=record?.outcome==='done'||record?.outcome==='na';
  if(task.done!==complete || task.completedAt!==(complete?record?.recordedAt:''))ctx.addIssue({code:'custom',path:['projectWorkflow'],message:'workflow-record'});
 }
 if(task.maintenancePlan){
  const plan=task.maintenancePlan;const last=plan.records.at(-1);const prior=plan.records.at(-2);
  const effectiveDueDate=plan.active?(plan.deferredUntil||plan.schedule.dueDate):last?.previousDueDate;
  if(!task.assetId || task.dueDate!==effectiveDueDate || task.done===plan.active || (plan.active && task.completedAt) || (plan.active && last && last.nextDueDate!==effectiveDueDate) || (!plan.active && (plan.schedule.rule.mode!=='once'||!last||last.nextDueDate!==null||last.previousDueDate!==(prior?.action==='defer'?prior.nextDueDate:plan.schedule.dueDate)||task.completedAt!==last.recordedAt)))ctx.addIssue({code:'custom',path:['maintenancePlan'],message:'maintenance-state'});
  if(task.projectWorkflow || task.impactSnapshot)ctx.addIssue({code:'custom',path:['maintenancePlan'],message:'maintenance-mixed'});
 }
});
export type Task=z.infer<typeof taskSchema>;
export const categorySchema=z.object({id:z.string().min(1).max(96),kind:z.enum(kinds),name:z.string().min(1).max(60),order:z.number().int(),deleted:z.boolean().default(false)});
export type Category=z.infer<typeof categorySchema>;
export const normalizeCategoryName = (name: string): string => name.trim().normalize('NFKC').toLowerCase();
export const submissionSchema=z.object({id:z.string().min(1).max(96),assetId:z.string().min(1).max(96),name:z.string().min(1).max(200),url:z.string().url().refine(v=>/^https?:\/\//.test(v)),status:z.enum(['planned','submitted','review','indexed','verify','rejected']),submittedAt:z.string().default(''),verifiedAt:z.string().default(''),evidence:z.string().max(2000).default(''),deleted:z.boolean().default(false),externalLink:z.object({profileId:z.string().min(1).max(96),destinationKey:z.string().min(1).max(512),ledgerKey:z.string().min(1).max(640),publicationStatus:z.string().max(64),listingClaim:z.enum(['none','claimed','verified']),publicUrl:z.string().max(2048),evidenceUrl:z.string().max(2048),indexEvidenceUrl:z.string().max(2048),failureReason:z.string().max(2000),importedAt:z.string().datetime()}).optional()});
export type Submission=z.infer<typeof submissionSchema>;
export const financeActions=['expense','topup','refund','balance'] as const;
export const historySchema=z.object({
 id:z.string().min(1).max(96),assetId:z.string().min(1).max(96),
 action:z.enum(['loan','return','renew','maintenance','itemStatus',...financeActions]),
 title:z.string().trim().max(160).optional(),source:z.string().trim().max(300).optional(),
 note:z.string(),borrower:z.string().max(200).optional(),
 expectedReturnDate:z.string().refine(v=>!v||validDateOnly(v),'date').optional(),
 itemStatusBefore:z.enum(itemLifecycleStatuses).nullable().optional(),itemStatusAfter:z.enum(itemLifecycleStatuses).optional(),
 eventDate:z.string().refine(validDateOnly,'date').optional(),billDate:z.string().refine(validDateOnly,'date').optional(),
 amount:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),currency:z.enum(currencies).optional(),
 createdAt:z.string(),deleted:z.boolean().default(false),
}).superRefine((value,ctx)=>{
 if(value.action==='itemStatus' && (value.itemStatusBefore===undefined || !value.itemStatusAfter || !value.eventDate))ctx.addIssue({code:'custom',path:['itemStatusAfter'],message:'item-status'});
 if(value.expectedReturnDate && value.action!=='loan')ctx.addIssue({code:'custom',path:['expectedReturnDate'],message:'loan-only'});
 if(value.expectedReturnDate && value.eventDate && value.expectedReturnDate<value.eventDate)ctx.addIssue({code:'custom',path:['expectedReturnDate'],message:'before-loan'});
 if(!financeActions.includes(value.action as typeof financeActions[number]))return;
 if(!value.title)ctx.addIssue({code:'custom',path:['title'],message:'title'});
 if(!value.eventDate)ctx.addIssue({code:'custom',path:['eventDate'],message:'date'});
 if(value.amount===undefined || (value.action!=='balance'&&value.amount===0))ctx.addIssue({code:'custom',path:['amount'],message:'amount'});
 if(!value.currency)ctx.addIssue({code:'custom',path:['currency'],message:'currency'});
});
export type History=z.infer<typeof historySchema>;
export function newAsset(kind:AssetKind):Asset{const now=new Date().toISOString();return assetSchema.parse({id:crypto.randomUUID(),kind,name:'Untitled',...(kind==='item'?{itemLifecycleStatus:'inUse',itemWarrantyStatus:'unverified'}:{}),createdAt:now,updatedAt:now});}
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
