// Pure helpers for the Scheduler status contract. The backend returns
// is_active/mode/message/last_started_at/last_completed_at/next_run/last_error,
// last_failed_profiles, active_manual_jobs, capacity_remaining, and pipeline —
// never status/last_run. Tested behaviorally; SamparkScheduler renders from these.

export function describeSchedulerStatus(data) {
  const d = data || {};
  const isActive = Boolean(d.is_active);
  const mode = String(d.mode || (isActive ? 'running' : 'idle'));
  return {
    isActive,
    manualActive: Number(d.active_manual_jobs || 0) > 0,
    capacityOut: d.capacity_remaining !== undefined && Number(d.capacity_remaining) <= 0,
    label: isActive ? `Active · ${mode}` : `Idle · ${mode}`,
    lastStarted: d.last_started_at || '',
    lastCompleted: d.last_completed_at || '',
    lastRun: d.last_completed_at || d.last_started_at || '',
    nextRun: d.next_run || '',
    lastError: d.last_error || '',
    failedProfiles: Array.isArray(d.last_failed_profiles) ? d.last_failed_profiles : [],
    pipelineMode: (d.pipeline || {}).mode || '',
    degraded: Boolean(
      ((d.pipeline || {}).web_search_enabled || (d.pipeline || {}).chat_summary_enabled) &&
      (d.pipeline || {}).credentials_ready === false,
    ),
  };
}

export function isRunDisabled(data, localPending = false) {
  if (localPending) return true;
  const s = describeSchedulerStatus(data);
  return s.isActive || s.manualActive || s.capacityOut;
}

export function isConflictStatus(status) {
  return Number(status) === 409;
}
