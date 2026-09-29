import { taskSchema, type Asset, type ProjectWorkflowSnapshot, type Relation, type Submission, type Task } from './index';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export type ProjectWorkflowKind = ProjectWorkflowSnapshot['kind'];
export type ProjectWorkflowStep = ProjectWorkflowSnapshot['step'];
export type ProjectWorkflowProposal = Pick<ProjectWorkflowSnapshot, 'proposedName' | 'proposedDescription' | 'proposedUrl' | 'changeNote'>;
type Source = Pick<ProjectWorkflowSnapshot, 'step' | 'sourceId' | 'sourceName' | 'sourceUrl' | 'sourceDetail' | 'sourceAssetId' | 'sourceAssetKind'>;
const stepOrder: ProjectWorkflowStep[] = ['brandProfile','brandSubmission','brandRelation','brandDomain','closeBackup','closeHandoff','closeSubscription','closeDomain','closeBacklink','closeRelated','closeDecision'];

/** A single immutable checklist round. Each row remains an ordinary RxDB task. */
export function buildProjectWorkflowTasks(input: {
  project: Asset; assets: Asset[]; relations: Relation[]; submissions: Submission[];
  kind: ProjectWorkflowKind; proposal?: ProjectWorkflowProposal; roundId: string; at: string;
  title: (step: ProjectWorkflowStep, sourceName: string) => string;
}): Task[] {
  const { project, assets, relations, submissions, kind, proposal, roundId, at, title } = input;
  if (project.kind !== 'project' || project.deleted) throw Error('workflow-project');
  if (kind === 'brand' && !proposal?.proposedName.trim() && !proposal?.proposedDescription.trim() && !proposal?.proposedUrl.trim() && !proposal?.changeNote.trim()) throw Error('workflow-proposal');
  if (proposal?.proposedUrl && !/^https?:\/\//i.test(proposal.proposedUrl)) throw Error('workflow-url');
  const live = new Map(assets.filter(asset => !asset.deleted).map(asset => [asset.id, asset]));
  const linked = new Map<string, Asset>();
  const liveRelations = relations.filter(relation => !relation.deleted && (relation.from === project.id || relation.to === project.id));
  for (const relation of liveRelations) {
    const other = live.get(relation.from === project.id ? relation.to : relation.from);
    if (other) linked.set(other.id, other);
  }
  const backlinkRows = submissions.filter(row => !row.deleted && row.assetId === project.id);
  const source = (step: ProjectWorkflowStep, fields: Partial<Source> = {}): Source => ({ step, sourceId: '', sourceName: '', sourceUrl: '', sourceAssetId: '', ...fields, sourceDetail: (fields.sourceDetail ?? '').slice(0, 2000) });
  const steps: Source[] = kind === 'brand' ? [
    source('brandProfile', { sourceId: project.id, sourceName: project.name, sourceUrl: project.url, sourceDetail: project.description, sourceAssetId: project.id, sourceAssetKind: 'project' }),
    ...backlinkRows.map(row => source('brandSubmission', { sourceId: row.id, sourceName: row.name, sourceUrl: row.url, sourceDetail: row.status })),
    ...liveRelations.flatMap(relation => {
      const other = live.get(relation.from === project.id ? relation.to : relation.from);
      return other ? [source('brandRelation', { sourceId: relation.id, sourceName: other.name, sourceUrl: other.url, sourceDetail: relation.label, sourceAssetId: other.id, sourceAssetKind: other.kind })] : [];
    }),
    ...project.projectDomains.map(domain => source('brandDomain', { sourceId: domain.id, sourceName: domain.name, sourceUrl: project.url, sourceDetail: domain.registrar })),
  ] : [
    source('closeBackup', { sourceId: project.id, sourceName: project.name, sourceDetail: `${project.attachments.length}` }),
    source('closeHandoff', { sourceId: project.id, sourceName: project.name, sourceDetail: [...linked.values()].filter(asset => asset.kind === 'account' || asset.kind === 'vault').map(asset => asset.name).join(' · ') }),
    ...[...linked.values()].filter(asset => asset.kind === 'subscription').map(asset => source('closeSubscription', { sourceId: asset.id, sourceName: asset.name, sourceUrl: asset.url, sourceDetail: `${asset.amount} ${asset.currency} / ${asset.interval} ${asset.cycle}; ${asset.dueDate}`, sourceAssetId: asset.id, sourceAssetKind: asset.kind })),
    ...project.projectDomains.map(domain => source('closeDomain', { sourceId: domain.id, sourceName: domain.name, sourceDetail: `${domain.registrar}; ${domain.expiryDate}; ${domain.autoRenew}` })),
    ...backlinkRows.map(row => source('closeBacklink', { sourceId: row.id, sourceName: row.name, sourceUrl: row.url, sourceDetail: row.status })),
    ...[...linked.values()].filter(asset => asset.kind !== 'subscription').map(asset => source('closeRelated', { sourceId: asset.id, sourceName: asset.name, sourceUrl: asset.url, sourceDetail: asset.kind, sourceAssetId: asset.id, sourceAssetKind: asset.kind })),
    source('closeDecision', { sourceId: project.id, sourceName: project.name, sourceDetail: project.status }),
  ];
  if (steps.length > 1000) throw Error('workflow-batch-size');
  const snapshot = {
    kind, roundId, projectId: project.id, generatedAt: at,
    projectName: project.name, projectDescription: project.description, projectUrl: project.url,
    proposedName: proposal?.proposedName.trim() ?? '', proposedDescription: proposal?.proposedDescription.trim() ?? '',
    proposedUrl: proposal?.proposedUrl.trim() ?? '', changeNote: proposal?.changeNote.trim() ?? '',
    attachmentIds: [...project.attachments], recordHistory: [],
  };
  return steps.map(row => taskSchema.parse({
    id: crypto.randomUUID(), name: title(row.step, row.sourceName), assetId: project.id,
    dueDate: '', done: false, completedAt: '', createdAt: at, deleted: false,
    dedupeKey: `workflow:${bytesToHex(sha256(utf8ToBytes(`${project.id}\u0000${kind}\u0000${row.step}\u0000${row.sourceId}`))).slice(0, 48)}`,
    projectWorkflow: { ...snapshot, ...row },
  }));
}

export function currentProjectWorkflowRound(tasks: Task[], projectId: string, kind: ProjectWorkflowKind): Task[] {
  const rows = tasks.filter(task => !task.deleted && task.projectWorkflow?.projectId === projectId && task.projectWorkflow.kind === kind);
  const latest = rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))[0]?.projectWorkflow?.roundId;
  return latest ? rows.filter(task => task.projectWorkflow?.roundId === latest).sort((a, b) => stepOrder.indexOf(a.projectWorkflow!.step) - stepOrder.indexOf(b.projectWorkflow!.step) || a.name.localeCompare(b.name)) : [];
}

export function canRecordProjectWorkflowTask(task: Task, round: Task[]) {
  if (task.projectWorkflow?.step !== 'closeDecision') return true;
  return round.every(row => row.id === task.id || row.projectWorkflow?.record?.outcome === 'done' || row.projectWorkflow?.record?.outcome === 'na');
}

export function recordProjectWorkflowTask(task: Task, outcome: 'done' | 'blocked' | 'na', evidence: string, at: string): Task {
  const workflow = task.projectWorkflow;
  if (!workflow) throw Error('workflow-task');
  const record = { outcome, evidence: evidence.trim(), recordedAt: at };
  const complete = outcome === 'done' || outcome === 'na';
  return taskSchema.parse({
    ...task, done: complete, completedAt: complete ? at : '',
    completionHistory: complete ? [...task.completionHistory, at] : task.completionHistory,
    projectWorkflow: { ...workflow, record, recordHistory: [...workflow.recordHistory, ...(workflow.record ? [workflow.record] : [])].slice(-50) },
  });
}
