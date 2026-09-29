import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Task } from '../../../packages/domain/src';
import { canRecordProjectWorkflowTask, recordProjectWorkflowTask } from '../../../packages/domain/src/project-workflow';
import { saveTaskIfCurrent } from '../../../packages/local-db/src';
import { Button } from './components/ui/button';
import { useAppContext } from './view-shared';

export function ProjectWorkflowTaskRow({ task, round: suppliedRound }: { task: Task; round?: Task[] }) {
  const { t, i18n, } = useTranslation();
  const { data, notify } = useAppContext();
  const workflow = task.projectWorkflow;
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<'done' | 'blocked' | 'na'>(workflow?.record?.outcome ?? 'done');
  const [evidence, setEvidence] = useState(workflow?.record?.evidence ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!workflow) return null;
  const round = suppliedRound ?? data.tasks.filter(row => !row.deleted && row.projectWorkflow?.roundId === workflow.roundId);
  const finalLocked = !canRecordProjectWorkflowTask(task, round);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !workflow) return;
    if (!evidence.trim()) { setError(t('workflowEvidenceRequired')); return; }
    if (finalLocked) { setError(t('workflowFinalLocked')); return; }
    setBusy(true); setError('');
    try {
      const next = recordProjectWorkflowTask(task, outcome, evidence, new Date().toISOString());
      await saveTaskIfCurrent(task, next);
      setEditing(false);
      notify(t('saved'));
    } catch (cause) { setError(cause instanceof Error && cause.message === 'task-stale' ? t('workflowTaskStale') : t('error')); }
    finally { setBusy(false); }
  }
  const record = workflow.record;
  const linked = workflow.sourceAssetId && workflow.sourceAssetKind && data.assets.some(asset => asset.id === workflow.sourceAssetId && !asset.deleted);
  return <article className="project-workflow-task" id={`task-${task.id}`}>
    <div className="project-workflow-task-head">
      <strong>{t(`workflowStep_${workflow.step}`)}{workflow.sourceName ? ` · ${workflow.sourceName}` : ''}</strong>
      <span className={`project-workflow-chip ${record?.outcome ?? 'pending'}`}>{t(`workflowOutcome_${record?.outcome ?? 'pending'}`)}</span>
    </div>
    {workflow.sourceDetail && ['brandProfile','brandRelation','brandDomain'].includes(workflow.step) && <p>{workflow.sourceDetail}</p>}
    <div className="project-workflow-source">
      {linked ? <Link to="/assets/$kind/$id" params={{ kind: workflow.sourceAssetKind!, id: workflow.sourceAssetId }}>{t('workflowOpenRelated')}</Link> : null}
      {workflow.sourceUrl && <a href={workflow.sourceUrl} target="_blank" rel="noopener noreferrer">{t('workflowOpenSource')}</a>}
      <small>{t('workflowSnapshotAt')}: {new Date(workflow.generatedAt).toLocaleString(i18n.language)}</small>
    </div>
    {record && <div className="project-workflow-record"><b>{t('workflowEvidence')}:</b> {record.evidence}<small>{new Date(record.recordedAt).toLocaleString(i18n.language)}</small></div>}
    {finalLocked && <p className="field-error">{t('workflowFinalLocked')}</p>}
    {editing ? <form className="project-workflow-record-form" onSubmit={event => void submit(event)}>
      <label>{t('workflowResult')}<select value={outcome} onChange={event => setOutcome(event.target.value as typeof outcome)} disabled={busy}>
        <option value="done">{t('workflowOutcome_done')}</option><option value="blocked">{t('workflowOutcome_blocked')}</option><option value="na">{t('workflowOutcome_na')}</option>
      </select></label>
      <label>{t('workflowEvidence')}<textarea value={evidence} maxLength={2000} rows={3} onChange={event => { setEvidence(event.target.value); setError(''); }} required disabled={busy} placeholder={t('workflowEvidenceHint')} /></label>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="project-workflow-actions"><Button type="button" onClick={() => setEditing(false)} disabled={busy}>{t('cancel')}</Button><Button type="submit" variant="primary" disabled={busy}>{t('workflowSaveRecord')}</Button></div>
    </form> : <Button size="small" onClick={() => { setOutcome(record?.outcome ?? 'done'); setEvidence(record?.evidence ?? ''); setEditing(true); }} disabled={finalLocked}>{t(record ? 'workflowEditRecord' : 'workflowRecordResult')}</Button>}
  </article>;
}
