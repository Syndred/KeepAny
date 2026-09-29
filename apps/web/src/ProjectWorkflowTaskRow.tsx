import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatMinorUnits, type Task } from '../../../packages/domain/src';
import { canRecordProjectWorkflowTask, recordProjectWorkflowTask } from '../../../packages/domain/src/project-workflow';
import { saveTaskIfCurrent } from '../../../packages/local-db/src';
import { Button } from './components/ui/button';
import { date, useAppContext } from './view-shared';

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
    } catch (cause) { setError(cause instanceof Error && cause.message === 'workflow-stale' ? t('workflowRoundStale') : cause instanceof Error && cause.message === 'task-stale' ? t('workflowTaskStale') : t('error')); }
    finally { setBusy(false); }
  }
  const record = workflow.record;
  const linkedKind = workflow.sourceAssetKind;
  const linked = workflow.sourceAssetId && linkedKind && data.assets.some(asset => asset.id === workflow.sourceAssetId && !asset.deleted);
  let sourceDetail = workflow.sourceDetail;
  if (workflow.step === 'closeSubscription') {
    const match = /^(\d+) (CNY|USD|EUR|GBP|JPY) \/ (\d+) (month|year|week|day); (.*)$/.exec(sourceDetail);
    sourceDetail = match
      ? `${formatMinorUnits(Number(match[1]), match[2], i18n.language)} / ${match[3]} ${t(match[4])}${match[5] ? ` · ${t('dueDate')}: ${date(match[5], i18n.language)}` : ''}`
      : '';
  } else if (workflow.step === 'closeDomain') {
    const parts = sourceDetail.split('; ');
    const renew = parts.pop() ?? '';
    const expiry = parts.pop() ?? '';
    const registrar = parts.join('; ');
    sourceDetail = [registrar && `${t('projectRegistrar')}: ${registrar}`, expiry && `${t('projectExpiry')}: ${date(expiry, i18n.language)}`, renew && `${t(renew === 'on' ? 'projectAutoRenewOn' : renew === 'off' ? 'projectAutoRenewOff' : 'projectAutoRenewUnknown')}`].filter(Boolean).join(' · ');
  } else if (workflow.step === 'closeBackup') {
    sourceDetail = `${sourceDetail} ${t('attachments')}`;
  } else if (['closeBacklink', 'closeRelated', 'closeDecision'].includes(workflow.step)) {
    sourceDetail = t(sourceDetail);
  }
  return <article className="project-workflow-task" id={`task-${task.id}`}>
    <div className="project-workflow-task-head">
      <strong>{t(`workflowStep_${workflow.step}`)}{workflow.sourceName ? ` · ${workflow.sourceName}` : ''}</strong>
      <span className={`project-workflow-chip ${record?.outcome ?? 'pending'}`}>{t(`workflowOutcome_${record?.outcome ?? 'pending'}`)}</span>
    </div>
    {sourceDetail && <p>{sourceDetail}</p>}
    <div className="project-workflow-source">
      {linked && linkedKind ? <Link to="/assets/$kind/$id" params={{ kind: linkedKind, id: workflow.sourceAssetId }}>{t('workflowOpenRelated')}</Link> : null}
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
