import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, basename, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha = b => createHash('sha256').update(b).digest('hex');
const check = (ok, message) => { if (!ok) throw Error(message); };
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const inputs = ['scripts/lib/portable-candidate.mjs', 'scripts/testing/browser-config.ts', 'scripts/serve-preview-for-tests.mjs', 'tests/e2e/vault-links-layout.spec.ts', 'playwright.vault-links-layout.config.ts', 'tests/e2e/helpers/portable-candidate.ts', 'tests/e2e/helpers/vault-access.ts', 'tests/e2e/helpers/select-choice.ts', 'tests/e2e/fixtures/password-smart-import-visual.ts', 'packages/local-db/src/backup-crypto.ts', 'scripts/verify-vault-links-layout-evidence.mjs'];
const canonical = b => { const s = new TextDecoder('utf-8', { fatal: true }).decode(b); check(!s.includes('\0'), 'NUL in source'); return Buffer.from(s.replaceAll('\r\n', '\n')); };
const safe = (base, name) => { check(typeof name === 'string' && !isAbsolute(name) && !name.includes('\\') && !name.split('/').some(s => s === '..' || s === '.' || !s), 'Unsafe evidence path'); const p = resolve(base, name); check(p.startsWith(resolve(base) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')), 'Evidence path escapes base'); return p; };
const sizes = [...[390,563,768,1280,1920,2560].map(w => [w,900]), [1280,720]];
const expected = ['zh-CN','en'].flatMap(l => sizes.map(([w,h]) => `${l}:${w}:${h}`));
const screenshots = ['empty','single','single-selected', ...Array.from({length:2},()=>['open','selected','category-focus','hint-focus','focused','match-hover','match-focus','match-pressed','matched']).flat(), 'reloaded'];
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
async function main() {
 const args = process.argv.slice(2);
 if (args[0] === '--create') {
  const [directory, destination] = args.slice(1).map(p => resolve(p)); check(directory && destination, 'Usage: --create evidenceDir record.json');
  const cases = [];
  for (const d of await readdir(directory, { withFileTypes: true })) if (d.isDirectory()) {
   const p = join(directory, d.name, 'result.json'), bytes = await readFile(p), raw = JSON.parse(bytes);
   cases.push({ id: `${raw.language}:${raw.width}:${raw.height}`, path: relative(dirname(destination), p).replaceAll('\\','/'), sha256: sha(bytes) });
  }
  const first = await read(safe(dirname(destination), cases[0].path));
  const record = { schema: 'keepany.vault-links-layout.evidence.v1', candidate: first.candidate, archiveSha256: first.archiveSha256, indexSha256: first.indexSha256, scope: '14 language/viewport combinations, actual empty/single/multiple UI; machine integrity/geometry only, separate human review required. Shared raw identity is checked; no rebuild/live runtime is inferred.', cases, inputs: await Promise.all(inputs.map(async path => ({ path, canonicalSha256: sha(canonical(await readFile(join(root,path)))) }))) };
  await verify(record, dirname(destination)); await writeFile(destination, JSON.stringify(record,null,2)+'\n', { flag: 'wx' }); console.log('Created and verified FC24 14-case record'); return;
 }
 check(args[0], 'Provide the current evidence record path, or --create evidenceDir record.json');
 const recordPath = resolve(args[0]);
 await verify(await read(recordPath), dirname(recordPath)); console.log('FC24 evidence passed: 14 combinations; human visual verdict not inferred');
}
async function verify(record, base) {
 check(record.schema === 'keepany.vault-links-layout.evidence.v1', 'Invalid schema');
 check(/^[a-f0-9]{40}$/.test(record.candidate) && /^[a-f0-9]{64}$/.test(record.archiveSha256) && /^[a-f0-9]{64}$/.test(record.indexSha256), 'Invalid candidate identity');
 check(Array.isArray(record.cases) && record.cases.length === 14 && new Set(record.cases.map(c=>c.id)).size === 14 && expected.every(id=>record.cases.some(c=>c.id===id)), 'Missing/duplicate FC24 combinations');
 check(Array.isArray(record.inputs) && record.inputs.length === inputs.length && new Set(record.inputs.map(x=>x.path)).size === inputs.length && inputs.every(p=>record.inputs.some(x=>x.path===p)), 'Missing input binding');
 for (const x of record.inputs) check(sha(canonical(await readFile(safe(root,x.path)))) === x.canonicalSha256, 'Changed FC24 input');
 for (const c of record.cases) {
  const p = safe(base,c.path), bytes = await readFile(p); check(sha(bytes)===c.sha256, 'Raw hash mismatch'); const r = JSON.parse(bytes);
  check(r.status==='passed' && Array.isArray(r.errors) && r.errors.length===0, 'Case incomplete/errors');
  check(`${r.language}:${r.width}:${r.height}`===c.id && r.candidate===record.candidate && r.archiveSha256===record.archiveSha256 && r.indexSha256===record.indexSha256 && typeof r.sourceDirty==='boolean', 'Raw identity mismatch');
  check(Array.isArray(r.steps), 'Missing steps');
  for (const stage of ['empty','single','single-selected','open','selected','focused','matched']) {
   const list = r.steps.filter(s=>s.stage===stage); check(list.length === (['open','selected','focused','matched'].includes(stage) ? 2 : 1), 'Missing geometry stage');
   for (const s of list) {
    for (const key of ['outer','header','footer','workspace','review','viewport']) check(s[key] && Object.values(s[key]).every(Number.isFinite), 'Nonfinite geometry');
    check(Number.isFinite(s.documentWidth) && s.documentWidth<=r.width && s.viewport.width===r.width && s.viewport.height===r.height, 'Viewport overflow/mismatch');
    check(s.outer.scrollHeight<=s.outer.clientHeight+1 && s.outer.scrollTop===0, 'Outer overflow/scroll');
    for (const q of [s.outer,s.header,s.footer]) check(q.width>0 && q.height>0 && q.left>=-1 && q.right<=r.width+1 && q.top>=-1 && q.bottom<=r.height+1, 'Header/footer outside viewport');
    if(r.width>760) check(s.review.top>=s.header.bottom-1 && s.review.bottom<=s.footer.top+1, 'Desktop review outside workspace');
   }
  }
  const shots=r.steps.filter(s=>s.stage==='screenshot'); check(shots.length===screenshots.length && new Set(shots.map(s=>s.name)).size===shots.length && same(shots.map(s=>s.label),screenshots), 'Missing/duplicate/out-of-order state screenshots');
  for(const s of shots){ check(typeof s.name==='string' && basename(s.path)===s.name+'.png' && !s.name.includes('/') && !s.name.includes('\\'), 'Unsafe screenshot name'); const b=await readFile(join(dirname(p),s.name+'.png')); check(sha(b)===s.sha256 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.readUInt32BE(16)===r.width && b.readUInt32BE(20)===r.height, 'PNG hash/signature/dimension mismatch'); }
  const cancel=r.steps.filter(s=>s.stage==='cancel-preserved'), saved=r.steps.filter(s=>s.stage==='saved-refreshed');
  check(cancel.length===1 && /^[a-f0-9]{64}$/.test(cancel[0].fingerprint) && saved.length===1, 'Missing persistence stage'); const s=saved[0];
  const expectedEntries = r.fixtureVersion === 'unified-accounts-13' ? 13 : r.fixtureVersion === undefined ? 12 : 0;
  check(Array.isArray(s.ids) && expectedEntries>0 && s.ids.length===expectedEntries && new Set(s.ids).size===expectedEntries && s.ids.every(id=>typeof id==='string'&&id.length>0) && s.ids.includes(s.linkedEntryId), 'Invalid preserved entry IDs');
  const chosen=r.steps.filter(x=>x.stage==='selected-bottom');
  check(chosen.length===2 && chosen.every(x=>x.selectedId===`vault-connect-choice-${s.linkedEntryId}`), 'Selected entry does not match saved entry');
  check(Array.isArray(s.originalAccounts) && s.originalAccounts.length===1 && same(s.originalAccounts,cancel[0].originalAccounts) && Array.isArray(s.accounts) && s.accounts.length===3 && new Set(s.accounts).size===3 && s.originalAccounts.every(id=>s.accounts.includes(id)) && s.linkedAssetIds?.length===1 && s.primaryId===s.linkedAssetIds[0] && s.accounts.includes('/assets/account/'+s.primaryId), 'Invalid saved account link');
  const before=s.originalMetadata, metadata=s.savedMetadata;
  check(before && Array.isArray(before.assets) && before.assets.length===1 && Array.isArray(before.relations) && before.relations.length===0 && sha(JSON.stringify(before))===cancel[0].metadataSha256, 'Invalid original metadata');
  check(metadata && Array.isArray(metadata.assets) && metadata.assets.length===3 && new Set(metadata.assets.map(x=>x.id)).size===3 && same(metadata,s.reloadedMetadata), 'Metadata not exactly preserved after reload');
  const original=before.assets[0], primary=metadata.assets.find(x=>x.id===s.primaryId), identity=metadata.assets.find(x=>x.id===s.identityId);
  check(original.kind==='account' && original.name==='Independent FC24 unrelated original' && original.username==='fc24-unrelated-user' && original.category==='other' && original.deleted===false && s.originalAccounts[0]==='/assets/account/'+original.id && same(metadata.assets.find(x=>x.id===original.id),original), 'Original account changed');
  check(primary && /^pw-account-[a-f0-9]{64}$/.test(primary.id) && primary.kind==='account' && primary.name===s.linkedEntryTitle && primary.username===s.linkedEntryUsername && primary.deleted===false, 'Primary account fields/role mismatch');
  check(identity && /^login-identity-[a-f0-9]{64}$/.test(identity.id) && identity.id!==primary.id && identity.id!==original.id && identity.kind==='account' && identity.name===s.linkedEntryUsername && identity.username===s.linkedEntryUsername && identity.category==='email' && identity.accountProvider==='example.test' && identity.deleted===false, 'Email identity fields/role mismatch');
  check(Array.isArray(metadata.relations) && metadata.relations.length===1 && metadata.relations[0].from===primary.id && metadata.relations[0].to===identity.id && metadata.relations[0].label===(r.language==='zh-CN'?'登录邮箱':'Login email') && metadata.relations[0].deleted===false, 'Wrong/missing/duplicate login relationship');
  check(same([...s.accounts].sort(),metadata.assets.map(x=>'/assets/account/'+x.id).sort()), 'UI account IDs differ from downloaded metadata');
  check(/^[a-f0-9]{64}$/.test(s.savedSha256) && s.savedSha256===s.reloadedSha256 && s.beforeSha256===cancel[0].fingerprint, 'Persistence fingerprint mismatch');
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
