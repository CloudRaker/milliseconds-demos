// Shell Guard: a sandboxed terminal that asks the model about every command before it runs.
// Enter -> build the state in code -> 2 yes-no calls + 1 classify -> Policy.decide -> run, confirm or block.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Dm1Error, dm1, type ClassifyResult, type Meta, type YesNoResult } from '../../lib/dm1';
import {
  ADVERSARIAL, BENCH_COMMANDS, CTX_STATEMENTS, DEFAULT_CONFIG, NOUL_IDS,
  PLAIN_STATEMENTS, SCENARIOS, SEED_GIT, SEED_HISTORY, SEED_TREE, START_CWD, TYPO_LIMIT,
  VERDICT_LABELS,
} from './data';
import {
  buildState, decide, execute, fallbackDecide, foldNouls, reasonText, stateText,
  type CommandState, type Config, type Decision, type Judgment, type Machine,
} from './guard';
import './demo.css';

const BENCH_LIMIT_MS = 60_000;
const BENCH_CALLS = 2 * (CTX_STATEMENTS.length + PLAIN_STATEMENTS.length + 1);
const PROMPT = (cwd: string) => `devin@sandbox ${cwd.replace('/Users/devin', '~')} %`;

/** likely_typo is the one noul a benign command can trip (a real tool our seed PATH omits that is
 *  one edit from one it lists — 149 of 1979 programs on a real PATH). The limit is printed on the
 *  prompt itself, so nobody is told "you typed that wrong" without being told why we think so. */
const typoNote = (d: Decision) => (d.reasons.some((r) => r.id === 'likely_typo') ? `  (${TYPO_LIMIT})` : '');

type Line = { kind: 'cmd' | 'out' | 'note' | 'confirm' | 'block' | 'err'; text: string };
interface Checked {
  state: CommandState;
  text: string;
  decision: Decision;
  judgment: Judgment | null;
  metas: Meta[];
  error: string | null;
}

/** The regex baseline needs the PATH fact too, or its "command not found" rule never fires and the
 *  denylist column reads better than it is on docker, kubectl, cargo, gti, sl, pytohn and dokcer. */
interface BenchRow {
  command: string;
  foundInPath: boolean | null;
  decision: Decision | null;
}
/** The bench always judges the seed machine, never the session's: the same 50 commands have to ask
 *  the same 50 questions however much the visitor typed first. */
const SEED_MACHINE: Machine = { cwd: START_CWD, tree: SEED_TREE, git: SEED_GIT, history: SEED_HISTORY };
const benchRows = (): BenchRow[] =>
  BENCH_COMMANDS.map((command) => ({
    command,
    foundInPath: buildState(command, SEED_MACHINE).tool.foundInPath,
    decision: null,
  }));

/** One judgement: the three calls the terminal makes per Enter, raced against the deadline. */
async function check(state: CommandState, config: Config, signal: AbortSignal): Promise<Checked> {
  const text = stateText(state);
  const metas: Meta[] = [];
  const timer = new AbortController();
  const onAbort = () => timer.abort();
  signal.addEventListener('abort', onAbort);
  const deadline = setTimeout(() => timer.abort(), config.deadlineMs);
  try {
    const [ctx, plain, verdict] = await Promise.all([
      dm1<{ results: YesNoResult[] }>('yes-no', { text, statements: CTX_STATEMENTS.map(([, s]) => s) }, timer.signal),
      dm1<{ results: YesNoResult[] }>(
        'yes-no',
        { text: state.command, statements: PLAIN_STATEMENTS.map(([, s]) => s) },
        timer.signal,
      ),
      dm1<ClassifyResult>('classify', { text, labels: VERDICT_LABELS }, timer.signal),
    ]);
    metas.push(ctx.meta, plain.meta, verdict.meta);
    const nouls = {
      ...foldNouls(CTX_STATEMENTS, ctx.data.results.map((r) => r.probability), state),
      ...foldNouls(PLAIN_STATEMENTS, plain.data.results.map((r) => r.probability), state),
    };
    const judgment: Judgment = {
      nouls,
      verdict: verdict.data.label,
      verdictProbabilities: verdict.data.scores,
      verdictConfidence: verdict.data.confidence,
    };
    return { state, text, decision: decide(judgment, config), judgment, metas, error: null };
  } catch (e) {
    const reason =
      timer.signal.aborted && !signal.aborted
        ? `deadline exceeded (${config.deadlineMs}ms)`
        : e instanceof Dm1Error
          ? `http ${e.status} ${e.code}`
          : (e as Error).message;
    return {
      state,
      text,
      decision: fallbackDecide(state.command, state.tool.foundInPath),
      judgment: null,
      metas,
      error: reason,
    };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', onAbort);
  }
}

export default function Demo() {
  const [machine, setMachine] = useState<Machine>({
    cwd: START_CWD,
    tree: SEED_TREE,
    git: SEED_GIT,
    history: SEED_HISTORY,
  });
  const [lines, setLines] = useState<Line[]>([
    { kind: 'note', text: 'shell guard — sandboxed shell, nothing here touches a real machine.' },
    { kind: 'cmd', text: `${PROMPT(START_CWD)} ls` },
    { kind: 'out', text: 'README.md  build/  dist/  node_modules/  notes.txt  package.json  src/' },
    { kind: 'note', text: 'Pick a free stock command below, or type your own. Each check uses 3 requests.' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Checked | null>(null);
  const [last, setLast] = useState<Checked | null>(null);
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [bench, setBench] = useState<{ running: boolean; rows: BenchRow[]; done: number }>({
    running: false,
    rows: benchRows(),
    done: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  // The bench owns its own controller: an Enter typed mid-bench used to overwrite `abort` and then
  // null it, which left Stop a no-op until the 60 s self-abort fired.
  const benchAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, pending]);
  useEffect(() => () => abort.current?.abort(), []);

  const push = (...added: Line[]) => setLines((l) => [...l, ...added]);

  // Only the filesystem moves here. The shell history is written in submit(), because the real
  // zsh hook records the line whatever the guard decides — a blocked command and a declined
  // confirm are both context for the next one.
  const run = useCallback(
    (command: string, m: Machine) => {
      const { out, cwd, tree } = execute(command, m);
      setMachine((prev) => ({ ...prev, cwd, tree }));
      if (out.length) push({ kind: 'out', text: out.join('\n') });
    },
    [],
  );

  const submit = useCallback(
    async (raw: string, stock = false) => {
      const command = raw.trim();
      if (!command || busy || bench.running) return;
      const context = stock ? SEED_MACHINE : machine;
      if (stock) push({ kind: 'note', text: 'Stock example: reset to the supplied sandbox state.' });
      setInput('');
      setHistory((h) => [...h, command]);
      setHistIdx(-1);
      push({ kind: 'cmd', text: `${PROMPT(context.cwd)} ${command}` });
      setMachine({ ...context, history: [...context.history, command] });
      setBusy(true);
      setError(null);
      const controller = new AbortController();
      abort.current = controller;
      const state = buildState(command, context);
      const result = await check(state, config, controller.signal);
      abort.current = null;
      setBusy(false);
      setLast(result);
      const tag = result.judgment ? 'Model decision' : 'Safety fallback';
      if (result.error) {
        setError(`${result.error} — the regex denylist decided instead; the terminal still works.`);
        push({ kind: 'note', text: `dm1 offline (${result.error}) — regex fallback` });
      }
      if (result.decision.label === 'run') {
        run(command, context);
      } else if (result.decision.label === 'block') {
        push({ kind: 'block', text: `✖ blocked: ${reasonText(result.decision.reasons)} — \`${command}\`  ${tag}` });
      } else {
        push({
          kind: 'confirm',
          text: `⚠ ${reasonText(result.decision.reasons)}${typoNote(result.decision)} — \`${command}\`  [y/N] ${tag}`,
        });
        setPending(result);
      }
      inputRef.current?.focus();
    },
    [bench.running, busy, config, machine, run],
  );

  const answer = (yes: boolean) => {
    if (!pending) return;
    push({ kind: 'out', text: yes ? 'y' : 'n' });
    if (yes) run(pending.state.command, machine);
    else setInput(pending.state.command);
    setPending(null);
    inputRef.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (pending) {
      if (e.key === 'Enter' || e.key.toLowerCase() === 'n') {
        e.preventDefault();
        answer(false);
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault();
        answer(true);
      }
      return;
    }
    if (e.key === 'Enter') void submit(input);
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const i = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1);
      if (history[i] !== undefined) {
        setHistIdx(i);
        setInput(history[i]!);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      const i = histIdx < 0 ? -1 : histIdx + 1;
      if (i >= history.length || i < 0) {
        setHistIdx(-1);
        setInput('');
      } else {
        setHistIdx(i);
        setInput(history[i]!);
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      setInput('');
    }
  };

  // --- bench: the 50 fixed commands, batched as texts:[32] + [18] per statement ---
  const runBench = useCallback(async () => {
    if (bench.running) return;
    const controller = new AbortController();
    benchAbort.current = controller;
    const stop = setTimeout(() => controller.abort(), BENCH_LIMIT_MS);
    setBench({ running: true, rows: benchRows(), done: 0 });
    setError(null);
    const states = BENCH_COMMANDS.map((c) => buildState(c, SEED_MACHINE));
    const chunks = [
      { from: 0, states: states.slice(0, 32) },
      { from: 32, states: states.slice(32) },
    ];
    try {
      for (const { from, states: group } of chunks) {
        const ctxTexts = group.map(stateText);
        const plainTexts = group.map((s) => s.command);
        // One call per statement over the whole chunk, so each statement keeps its own 32 texts.
        const pairs = [...CTX_STATEMENTS, ...PLAIN_STATEMENTS];
        const calls = await Promise.all([
          ...CTX_STATEMENTS.map(([, s]) =>
            dm1<{ results: YesNoResult[] }>('yes-no', { texts: ctxTexts, statement: s }, controller.signal),
          ),
          ...PLAIN_STATEMENTS.map(([, s]) =>
            dm1<{ results: YesNoResult[] }>('yes-no', { texts: plainTexts, statement: s }, controller.signal),
          ),
          dm1<{ results: ClassifyResult[] }>('classify', { texts: ctxTexts, labels: VERDICT_LABELS }, controller.signal),
        ]);
        const verdicts = (calls[pairs.length] as { data: { results: ClassifyResult[] } }).data.results;
        setBench((b) => {
          const rows = [...b.rows];
          group.forEach((s, i) => {
            const values = pairs.map((_, n) => (calls[n]!.data as { results: YesNoResult[] }).results[i]!.probability);
            const nouls = foldNouls(pairs, values, s);
            const v = verdicts[i]!;
            rows[from + i] = {
              ...rows[from + i]!,
              decision: decide({ nouls, verdict: v.label, verdictProbabilities: v.scores, verdictConfidence: v.confidence }, config),
            };
          });
          return { ...b, rows, done: from + group.length };
        });
      }
    } catch (e) {
      // Stop and the 60 s cap both abort the in-flight fetches, so the AbortError is the bound
      // working, not a failure: nothing fell back, the unjudged rows just stay unjudged.
      if (controller.signal.aborted) setError('bench stopped — the rows below it are still unjudged.');
      else setError(`${e instanceof Dm1Error ? `http ${e.status} ${e.code}: ${e.message}` : (e as Error).message} — the regex denylist decided instead; the terminal still works.`);
    } finally {
      clearTimeout(stop);
      benchAbort.current = null;
      setBench((b) => ({ ...b, running: false }));
    }
  }, [bench.running, config]);

  const benchSummary = useMemo(() => {
    const judged = bench.rows.filter((r) => r.decision);
    const counts = { run: 0, confirm: 0, block: 0 };
    for (const r of bench.rows) {
      if (r.decision) counts[r.decision.label]++;
    }
    return { judged: judged.length, counts };
  }, [bench.rows]);

  return (
    <div className="d-shell-guard">
      {error && <p className="error sg-error">{error}</p>}

      <div className="sg-grid">
        <section className="panel sg-term" onClick={() => inputRef.current?.focus()}>
          <p className="panel-title">sandboxed terminal</p>
          <div className="sg-scroll" ref={scrollRef}>
            {lines.map((l, i) => (
              <pre key={i} className={`sg-line sg-${l.kind}`}>
                {l.text}
              </pre>
            ))}
            {busy && <pre className="sg-line sg-note">judging… 3 calls queued at 2/s</pre>}
            <div className="sg-input-row">
              <span className="sg-prompt">{pending ? '[y/N]' : PROMPT(machine.cwd)}</span>
              <input
                ref={inputRef}
                className="sg-input"
                value={input}
                spellCheck={false}
                autoComplete="off"
                aria-label="shell command"
                disabled={busy || bench.running}
                placeholder={pending ? 'y to run, anything else to edit' : ''}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
              />
            </div>
          </div>
          <p className="muted">Stock buttons reset the supplied sandbox. Typed commands keep your current sandbox state.</p>
          <div className="sg-chips">
            {SCENARIOS.map((s) => (
              <button
                key={s.command}
                className="btn sg-chip"
                disabled={busy || !!pending || bench.running}
                onClick={() => void submit(s.command, true)}
              >
                <code>{s.command.length > 34 ? s.command.slice(0, 32) + '…' : s.command}</code>
                <span className={`tag ${s.expect === 'run' ? 'good' : s.expect === 'block' ? 'hot' : 'warn'}`}>{s.expect}</span>
              </button>
            ))}
          </div>
          <div className="sg-chips">
            <span className="muted">Try an adversarial command:</span>
            {ADVERSARIAL.map((s) => (
              <button
                key={s.command}
                className="btn sg-chip"
                title={s.note}
                disabled={busy || !!pending || bench.running}
                onClick={() => void submit(s.command, true)}
              >
                <code>{s.command}</code>
                <span className="tag">stress test</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel sg-explain">
          <p className="panel-title">Command decision</p>
          {last ? (
            <>
              <p className={`sg-decision sg-${last.decision.label}`}>
                Final decision: {last.decision.label}
              </p>
              <p className="muted sg-foot">
                {!last.judgment
                  ? `The model was unavailable. Safety fallback rules decided: ${reasonText(last.decision.reasons) || 'no fallback rule matched'}.`
                  : last.decision.label === 'run'
                    ? 'No risk crossed its warning threshold when checked, and the block suggestion did not pass its gate. A confirm suggestion alone does not require confirmation.'
                    : last.decision.label === 'confirm'
                      ? `Confirmation required: ${reasonText(last.decision.reasons)}. The block rules did not require blocking.`
                      : `Blocked: ${reasonText(last.decision.reasons)}. A flagged risk plus a strong block suggestion, or high destructive and wrong-target risks, triggered the block rule.`}
              </p>
              {last.judgment && (
                <>
                  <p className="sg-sub">Model suggestion</p>
                  <div className="sg-verdict">
                    {Object.entries(last.judgment.verdictProbabilities).map(([k, v]) => (
                      <span key={k} className={`tag ${last.judgment?.verdict === k ? 'purple' : ''}`}>
                        {k} {Math.round(v * 100)}%
                      </span>
                    ))}
                  </div>
                  <p className="muted sg-foot">The policy combines this suggestion with the risk thresholds below.</p>
                </>
              )}
              <details className="sg-request">
                <summary>Inspect sandbox context and model input</summary>
                <p className="sg-sub">Sandbox context</p>
                <pre className="sg-state">{JSON.stringify(last.state, null, 1)}</pre>
                <p className="sg-sub">Text sent to the model</p>
                <pre className="sg-state">{last.text}</pre>
              </details>
            </>
          ) : (
            <p className="muted">Run a command to see its final decision, model suggestion and risk probabilities. Adjust the thresholds below for the next command.</p>
          )}
          <p className="sg-sub">Risk probabilities</p><p className="muted sg-foot">Values range from 0 to 1. Move each slider to set the threshold for a warning.</p>
          {NOUL_IDS.map((id) => {
            const v = last?.judgment?.nouls[id] ?? 0;
            const t = config.thresholds[id]!;
            return (
              <div key={id}>
              <div className="sg-prob">
                <span className="sg-prob-id">{id.replaceAll("_", " ")}</span>
                <span className="bar sg-bar">
                  <i style={{ width: `${Math.round(v * 100)}%`, background: v >= t ? '#f0b35a' : undefined }} />
                  <u style={{ left: `${Math.round(t * 100)}%` }} />
                </span>
                <span className="sg-prob-v">{last?.judgment ? v.toFixed(2) : '—'}</span>
                <input
                  className="sg-slider"
                  type="range"
                  min={0.05}
                  max={0.95}
                  step={0.05}
                  value={t}
                  aria-label={`${id} threshold`}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, thresholds: { ...c.thresholds, [id]: Number(e.target.value) } }))
                  }
                />
              </div>
              {id === 'likely_typo' && <p className="muted sg-foot">{TYPO_LIMIT}</p>}
              </div>
            );
          })}
          <p className="sg-sub">block rule</p>
          <label className="sg-deadline">
            block threshold {config.blockThreshold.toFixed(2)}
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={config.blockThreshold}
              onChange={(e) => setConfig((c) => ({ ...c, blockThreshold: Number(e.target.value) }))}
            />
          </label>
          <label className="sg-deadline">
            block verdict P {config.blockVerdictProbability.toFixed(2)}
            <input
              type="range"
              min={0.05}
              max={0.95}
              step={0.05}
              value={config.blockVerdictProbability}
              onChange={(e) => setConfig((c) => ({ ...c, blockVerdictProbability: Number(e.target.value) }))}
            />
          </label>
          <p className="muted sg-foot">
            A block needs at least one flagged risk plus a block suggestion above its threshold, or both destructive and wrong-target risks above the block threshold. A block suggestion alone requires confirmation.
          </p>
          <label className="sg-deadline">
            deadline {config.deadlineMs} ms
            <input
              type="range"
              min={500}
              max={5000}
              step={250}
              value={config.deadlineMs}
              onChange={(e) => setConfig((c) => ({ ...c, deadlineMs: Number(e.target.value) }))}
            />
          </label>
        </section>
      </div>

      <section className="panel sg-bench">
        <p className="panel-title">Check 50 sample commands</p>
        <div className="sg-bench-head">
          <button className="btn primary" onClick={() => void runBench()} disabled={bench.running || busy || !!pending}>
            {bench.running ? `judging ${bench.done}/50…` : `Check commands (${BENCH_CALLS} calls)`}
          </button>
          {bench.running && (
            <button className="btn" onClick={() => benchAbort.current?.abort()}>
              Stop
            </button>
          )}
          <span className="muted">
            Each command receives a run, confirm or block decision. Stops after 60 seconds.
          </span>
        </div>
        <div className="sg-bench-grid">
          {bench.rows.map((r) => {
            return (
              <div key={r.command} className="sg-bench-row">
                <span className={`sg-verdict-cell sg-${r.decision?.label ?? 'idle'}`}>{r.decision?.label ?? '·'}</span>
                <code>{r.command}</code>
                {r.decision && r.decision.reasons.length > 0 && <span className="muted">{reasonText(r.decision.reasons)}</span>}
              </div>
            );
          })}
        </div>
        <p className="muted sg-foot">
          Run {benchSummary.counts.run} · confirm {benchSummary.counts.confirm} · block {benchSummary.counts.block}
          {benchSummary.judged < 50 && ` (${benchSummary.judged}/50 checked)`}
        </p>
      </section>
    </div>
  );
}
