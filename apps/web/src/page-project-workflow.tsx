import { Textarea } from "./components/ui/textarea";
import { Input } from "./components/ui/input";
import { Link, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset, Task } from '../../../packages/domain/src';
import { buildProjectWorkflowTasks, currentProjectWorkflowRound, type ProjectWorkflowKind, type ProjectWorkflowProposal } from '../../../packages/domain/src/project-workflow';
import { archiveProjectIfWorkflowComplete, saveBatch } from '../../../packages/local-db/src';
import { Button } from './components/ui/button';
import { Dialog } from './components/ui/dialog';
import { TextLink } from './components/ui/text-link';
import { ProjectWorkflowTaskRow } from './ProjectWorkflowTaskRow';
import { useAppContext } from './view-shared';
import './project-workflow.css';

const initialProposal: ProjectWorkflowProposal = { proposedName: '', proposedDescription: '', proposedUrl: '', changeNote: '' };

export function ProjectWorkflowPage({ projectId, flow, embedded = false }: { projectId?: string; flow?: ProjectWorkflowKind; embedded?: boolean } = {}) {
  const params = (useRouterState({ select: state => state.matches.at(-1)?.params }) ?? {}) as { id?: string; flow?: string };
  const id = projectId ?? params.id;
  const kind: ProjectWorkflowKind = flow ?? (params.flow === 'close' ? 'close' : 'brand');
  const { data, notify } = useAppContext();
  const { t, i18n } = useTranslation();
  const project = data.assets.find(asset => asset.id === id && asset.kind === 'project' && !asset.deleted);
  const round = currentProjectWorkflowRound(data.tasks, id ?? '', kind);
  const [newRound, setNewRound] = useState(false);
  const [report, setReport] = useState(false);
  const [proposal, setProposal] = useState<ProjectWorkflowProposal>(initialProposal);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [draftRoundId, setDraftRoundId] = useState(() => crypto.randomUUID());
  const creating = !round.length || newRound;
  const snapshot = round[0]?.projectWorkflow;
  const activeProposal = creating ? proposal : snapshot ? { proposedName: snapshot.proposedName, proposedDescription: snapshot.proposedDescription, proposedUrl: snapshot.proposedUrl, changeNote: snapshot.changeNote } : initialProposal;
  const counts = {
    done: round.filter(task => task.projectWorkflow?.record?.outcome === 'done').length,
    blocked: round.filter(task => task.projectWorkflow?.record?.outcome === 'blocked').length,
    na: round.filter(task => task.projectWorkflow?.record?.outcome === 'na').length,
    pending: round.filter(task => !task.projectWorkflow?.record).length,
  };
  const complete = !!round.length && counts.pending === 0 && counts.blocked === 0;

  function plan(preview: boolean): Task[] {
    if (!project) return [];
    const effectiveProposal = kind === 'brand' && preview && !Object.values(proposal).some(value => value.trim()) ? { ...proposal, changeNote: 'preview' } : proposal;
    return buildProjectWorkflowTasks({
      project, assets: data.assets, relations: data.relations, submissions: data.submissions,
      kind, proposal: effectiveProposal, roundId: draftRoundId, at: new Date().toISOString(),
      title: (step, sourceName) => `${t(`workflowStep_${step}`)}${sourceName ? ` · ${sourceName}` : ''}`,
    });
  }
  let previewTasks: Task[] = [];
  if (creating && project) {
    try { previewTasks = plan(true); } catch { /* Start action reports validation. */ }
  }
  async function start() {
    if (busy || !project) return;
    if ((!newRound && round.length) || (newRound && !complete)) { setError(t('workflowExistingRound')); return; }
    setBusy(true); setError('');
    try {
      const tasks = plan(false);
      if (tasks.length > 1000) throw Error('workflow-batch-size');
      if (!newRound && currentProjectWorkflowRound(data.tasks, project.id, kind).length) throw Error('workflow-existing');
      await saveBatch(tasks.map(value => ({ type: 'task' as const, value })));
      setNewRound(false); setReport(false); setDraftRoundId(crypto.randomUUID());
      notify(t('workflowPlanCreated'));
    } catch (cause) {
      setError(cause instanceof Error && cause.message === 'workflow-batch-size' ? t('workflowTooMany') : cause instanceof Error && cause.message === 'workflow-proposal' ? t('workflowProposalRequired') : cause instanceof Error && cause.message === 'workflow-url' ? t('workflowUrlInvalid') : cause instanceof Error && cause.message === 'task-duplicate' ? t('workflowExistingRound') : t('error'));
    } finally { setBusy(false); }
  }
  async function archive() {
    if (!project || !complete || kind !== 'close' || !round.some(task => task.projectWorkflow?.step === 'closeDecision' && task.projectWorkflow.record?.outcome === 'done')) return;
    setBusy(true); setError('');
    try {
      await archiveProjectIfWorkflowComplete(project, round[0].projectWorkflow?.roundId ?? '');
      setArchiveOpen(false); notify(t('saved'));
    } catch (cause) { setError(cause instanceof Error && cause.message === 'workflow-stale' ? t('workflowRoundStale') : t('assetStale')); }
    finally { setBusy(false); }
  }
  if (data.loading) return <main className="page"><p>{t('loading')}</p></main>;
  if (!project) return <main className="page"><p>{t('noMatches')}</p></main>;
  const related = data.relations.filter(relation => !relation.deleted && (relation.from === project.id || relation.to === project.id)).map(relation => data.assets.find(asset => asset.id === (relation.from === project.id ? relation.to : relation.from) && !asset.deleted && asset.kind !== 'vault')).filter((asset): asset is Asset => !!asset);
  const visible = creating ? previewTasks : round;
  const Container = embedded ? 'div' : 'main';
  const HeroTitle = embedded ? 'h2' : 'h1';
  return <Container className={embedded ? 'project-workflow-page project-workflow-embedded' : 'page project-workflow-page'}>
    {!embedded && <TextLink asChild><Link className="back-link" to="/assets/$kind/$id" params={{ kind: 'project', id: project.id }}>{t('workflowBackToProject')}</Link></TextLink>}
    <div className="project-workflow-hero"><div><div className="eyebrow">{t('project')} · {t('workflowTitle')}</div><HeroTitle>{t(kind === 'brand' ? 'workflowBrandTitle' : 'workflowCloseTitle')}</HeroTitle><p>{project.name}</p></div><div className="project-workflow-steps"><span className={creating ? 'current' : ''}>{t('workflowPreview')}</span><span className={!creating && !report ? 'current' : ''}>{t('workflowPlan')}</span><span className={report ? 'current' : ''}>{t('workflowReport')}</span></div></div>
    <div className="project-workflow-layout"><div className="project-workflow-main">
      {creating ? <section className="card project-workflow-card">
        <h2>{t('workflowPreview')}</h2>
        <p>{t(kind === 'brand' ? 'workflowBrandIntro' : 'workflowCloseIntro')}</p>
        {kind === 'brand' && <div className="project-workflow-fields">
          <label>{t('workflowProposedName')}<Input value={proposal.proposedName} maxLength={160} onChange={event => setProposal({ ...proposal, proposedName: event.target.value })} /></label>
          <label>{t('workflowProposedDescription')}<Textarea value={proposal.proposedDescription} maxLength={2000} rows={2} onChange={event => setProposal({ ...proposal, proposedDescription: event.target.value })} /></label>
          <label>{t('workflowProposedUrl')}<Input type="url" value={proposal.proposedUrl} maxLength={2000} onChange={event => setProposal({ ...proposal, proposedUrl: event.target.value })} /></label>
          <label>{t('workflowChangeNote')}<Textarea value={proposal.changeNote} maxLength={2000} rows={2} onChange={event => setProposal({ ...proposal, changeNote: event.target.value })} /></label>
        </div>}
        <div className="project-workflow-before-after"><div><small>{t('workflowCurrentSnapshot')}</small><strong>{project.name}</strong><p>{project.description || '—'}</p><p>{project.url || '—'}</p></div>{kind === 'brand' && <div><small>{t('workflowProposedSnapshot')}</small><strong>{proposal.proposedName || '—'}</strong><p>{proposal.proposedDescription || '—'}</p><p>{proposal.proposedUrl || '—'}</p></div>}</div>
        <p className="project-workflow-warning">{t(kind === 'brand' ? 'workflowBrandManual' : 'workflowCloseManual')}</p>
      </section> : <section className="card project-workflow-card"><div className="project-workflow-card-head"><div><h2>{t('workflowPlan')}</h2><p>{t('workflowSnapshotAt')}: {snapshot && new Date(snapshot.generatedAt).toLocaleString(i18n.language)}</p></div><Button size="small" disabled={!complete} title={!complete ? t('workflowNewRoundLocked') : undefined} onClick={() => { setNewRound(true); setReport(false); setProposal(initialProposal); setDraftRoundId(crypto.randomUUID()); }}>{t('workflowNewRound')}</Button></div>
        {kind === 'brand' && <div className="project-workflow-before-after"><div><small>{t('workflowCurrentSnapshot')}</small><strong>{snapshot?.projectName}</strong><p>{snapshot?.projectDescription || '—'}</p><p>{snapshot?.projectUrl || '—'}</p></div><div><small>{t('workflowProposedSnapshot')}</small><strong>{activeProposal.proposedName || '—'}</strong><p>{activeProposal.proposedDescription || '—'}</p><p>{activeProposal.proposedUrl || '—'}</p><p>{activeProposal.changeNote}</p></div></div>}
        <p className="project-workflow-warning">{t(kind === 'brand' ? 'workflowBrandManual' : 'workflowCloseManual')}</p>
      </section>}
      <section className="card project-workflow-card"><div className="project-workflow-card-head"><div><h2>{t(creating ? 'workflowImpactList' : report ? 'workflowReport' : 'workflowPlanTasks')}</h2><p>{creating ? t('workflowTaskCount', { count: visible.length }) : t('workflowProgress', { resolved: counts.done + counts.na, total: round.length, blocked: counts.blocked })}</p></div>{!creating && <Button onClick={() => setReport(!report)}>{t(report ? 'workflowBackToPlan' : 'workflowViewReport')}</Button>}</div>
        {report ? <div className="project-workflow-report"><div className="project-workflow-report-counts"><span>{t('workflowOutcome_done')}: {counts.done}</span><span>{t('workflowOutcome_na')}: {counts.na}</span><span>{t('workflowOutcome_blocked')}: {counts.blocked}</span><span>{t('workflowOutcome_pending')}: {counts.pending}</span></div><p>{t(complete ? 'workflowReportComplete' : 'workflowReportIncomplete')}</p>{round.map(task => <div key={task.id} className="project-workflow-report-row"><strong>{t(`workflowStep_${task.projectWorkflow?.step}`)} · {task.projectWorkflow?.sourceName}</strong><span>{t(`workflowOutcome_${task.projectWorkflow?.record?.outcome ?? 'pending'}`)}</span><p>{task.projectWorkflow?.record?.evidence || t('workflowNoEvidence')}</p></div>)}{kind === 'close' && complete && project.status !== 'archived' && round.some(task => task.projectWorkflow?.step === 'closeDecision' && task.projectWorkflow.record?.outcome === 'done') && <Button variant="primary" onClick={() => setArchiveOpen(true)}>{t('workflowArchiveLocal')}</Button>}{project.status === 'archived' && <p>{t('workflowArchivedLocal')}</p>}</div> : <div className="project-workflow-task-list">{visible.map(task => creating ? <div key={task.id} className="project-workflow-preview-row"><strong>{t(`workflowStep_${task.projectWorkflow?.step}`)} · {task.projectWorkflow?.sourceName}</strong>{task.projectWorkflow?.sourceUrl && <small>{task.projectWorkflow.sourceUrl}</small>}</div> : <ProjectWorkflowTaskRow key={task.id} task={task} round={round} />)}</div>}
        {creating && <div className="project-workflow-actions"><Button variant="primary" onClick={() => void start()} disabled={busy}>{t('workflowCreatePlan')}</Button>{newRound && <Button onClick={() => setNewRound(false)}>{t('cancel')}</Button>}</div>}
        {error && <p className="field-error" role="alert">{error}</p>}
      </section>
    </div><aside className="project-workflow-side"><section className="card project-workflow-card"><h2>{t('workflowRelatedAssets')}</h2>{related.length ? related.map(asset => <Link key={asset.id} to="/assets/$kind/$id" params={{ kind: asset.kind, id: asset.id }}>{asset.name}<small>{t(asset.kind)}</small></Link>) : <p>{t('none')}</p>}</section><section className="card project-workflow-card"><h2>{t('workflowScope')}</h2><p>{t('workflowScopeHint')}</p><p>{t('workflowNoPasswords')}</p></section></aside></div>
    {archiveOpen && <Dialog title={t('workflowArchiveLocal')} onClose={() => !busy && setArchiveOpen(false)}><p>{t('workflowArchiveConfirm')}</p><div className="project-workflow-actions"><Button onClick={() => setArchiveOpen(false)} disabled={busy}>{t('cancel')}</Button><Button variant="primary" onClick={() => void archive()} disabled={busy}>{t('workflowConfirmArchive')}</Button></div>{error && <p className="field-error" role="alert">{error}</p>}</Dialog>}
  </Container>;
}
