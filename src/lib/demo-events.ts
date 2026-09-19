import { track } from '@plausible-analytics/tracker';

export type DemoEvent = 'sample_viewed' | 'run_started' | 'run_completed' | 'run_failed' | 'run_cancelled' | 'own_input_run' | 'evidence_opened' | 'policy_changed' | 'code_copied' | 'exported';

/** Deliberately accepts no text or arbitrary properties: business inputs never enter analytics. */
export function trackDemoEvent(demo: string, action: DemoEvent) {
  if (typeof window === 'undefined') return;
  try { track('Demo workflow', { props: { demo, action }, url: window.location.origin + window.location.pathname }); } catch { /* Analytics must never interrupt a workflow. */ }
}
