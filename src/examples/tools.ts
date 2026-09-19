import type { StockExample } from '../lib/example-contract';
import { chunk } from '../lib/dm1';
import * as commit from '../demos/commit-sentry/data';
import * as send from '../demos/send-guard/data';
import * as shell from '../demos/shell-guard/data';
import { buildState, stateText } from '../demos/shell-guard/guard';
import { SAMPLES } from '../demos/jev-lint/data';
import { changedLines, enclosingFunction, extractFunctions } from '../demos/jev-lint/analysis';
import { batchTexts, buildRefs, scanLines, PROBES, SEVERITY_LABELS } from '../demos/jev-lint/markers';
import { buildWorkbook, REVIEW_COUNT, LEAD_COUNT } from '../demos/judge-sheets/sheets';
import { SCHEMAS, bodyFor, formulaFor } from '../demos/judge-sheets/predict';
import { planChunks } from '../demos/judge-sheets/runner';

const examples: StockExample[] = [];
const add = (demo: string, scenario: string, route: StockExample['route'], body: StockExample['body']) => examples.push({ demo, scenario, route, body });

const texts = commit.HUNKS.map(commit.hunkText);
add('commit-sentry', 'staged-diff-risk', 'rate', { texts, scale: commit.RISK_SCALE });
add('commit-sentry', 'staged-diff-kind', 'classify', { texts, labels: commit.KIND_LABELS });
add('commit-sentry', 'staged-diff-findings', 'yes-no', { texts, statements: commit.STATEMENTS });
const lines = commit.HUNKS.flatMap(h => commit.addedLines(h).filter(l => l.t.trim()).map(l => commit.lineText(h, l)));
chunk(lines).forEach((texts, i) => add('commit-sentry', `added-lines-${i + 1}`, 'yes-no', { texts, statements: commit.STATEMENTS }));
chunk(commit.allMessageClaims(commit.HUNKS)).forEach((statements, i) => add('commit-sentry', `message-coverage-${i + 1}`, 'yes-no', { text: `Commit message: ${commit.COMMIT_MESSAGE}`, statements }));
add('commit-sentry', 'message-quality', 'rate', { text: commit.COMMIT_MESSAGE, scale: commit.MESSAGE_SCALE });

// Changing the audience for a supplied draft is a useful stock interaction too.
for (const [i, scenario] of send.SCENARIOS.entries()) for (const channel of send.CHANNELS) {
  const text = send.judgeText(channel, scenario.draft);
  const id = `draft-${i + 1}-${channel.id}`;
  add('send-guard', `${id}-checks`, 'yes-no', { text, statements: [...send.CORE_STATEMENTS.map(s => s.text), ...send.findSpans(scenario.draft).map(send.spanStatement)] });
  add('send-guard', `${id}-verdict`, 'classify', { text, labels: send.VERDICT_LABELS });
  add('send-guard', `${id}-legal`, 'rate', { texts: [text], scale: send.LEGAL_SCALE });
}

const machine = { cwd: shell.START_CWD, tree: shell.SEED_TREE, git: shell.SEED_GIT, history: shell.SEED_HISTORY };
const commands = [...new Set([...shell.BENCH_COMMANDS, ...shell.SCENARIOS.map(s => s.command), ...shell.ADVERSARIAL.map(s => s.command)])];
for (const [i, command] of commands.entries()) {
  const text = stateText(buildState(command, machine));
  add('shell-guard', `command-${i + 1}-context`, 'yes-no', { text, statements: shell.CTX_STATEMENTS.map(([, s]) => s) });
  add('shell-guard', `command-${i + 1}-plain`, 'yes-no', { text: command, statements: shell.PLAIN_STATEMENTS.map(([, s]) => s) });
  add('shell-guard', `command-${i + 1}-verdict`, 'classify', { text, labels: shell.VERDICT_LABELS });
}
chunk(shell.BENCH_COMMANDS).forEach((commands, i) => {
  const texts = commands.map(c => stateText(buildState(c, machine)));
  shell.CTX_STATEMENTS.forEach(([, statement], j) => add('shell-guard', `batch-${i + 1}-context-${j + 1}`, 'yes-no', { texts, statement }));
  shell.PLAIN_STATEMENTS.forEach(([, statement], j) => add('shell-guard', `batch-${i + 1}-plain-${j + 1}`, 'yes-no', { texts: commands, statement }));
  add('shell-guard', `batch-${i + 1}-verdict`, 'classify', { texts, labels: shell.VERDICT_LABELS });
});

function lintBatch(scenario: string, texts: string[]) {
  if (!texts.length) return;
  PROBES.forEach(p => add('jev-lint', `${scenario}-${p.id}`, 'yes-no', { texts, statement: p.statement, when_true: p.when_true, when_false: p.when_false }));
  add('jev-lint', `${scenario}-severity`, 'classify', { texts, labels: SEVERITY_LABELS });
}
const append = (text: string, snippet: string) => text + (text.endsWith('\n') ? '' : '\n') + snippet;
for (const sample of SAMPLES) {
  const variants = [[sample.text], [sample.text, append(sample.text, sample.demo)], [sample.text, append(sample.text, sample.demoAlt)], [sample.text, append(sample.text, sample.demo), append(append(sample.text, sample.demo), sample.demoAlt)], [sample.text, append(sample.text, sample.demoAlt), append(append(sample.text, sample.demoAlt), sample.demo)]];
  variants.forEach((states, v) => states.forEach((source, n) => {
    chunk(buildRefs(source, sample.language, scanLines(source, sample.language))).slice(0, 2).forEach((refs, i) => lintBatch(`${sample.id}-${v}-${n}-scan-${i}`, batchTexts(refs)));
    if (!n) return;
    const groups = new Map<string, number[]>();
    const functions = extractFunctions(source, sample.language);
    for (const line of changedLines(states[n - 1], source)) {
      const f = enclosingFunction(functions, line);
      const key = f ? String(f.startLine) : 'top';
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    for (const [group, lines] of groups) lintBatch(`${sample.id}-${v}-${n}-edit-${group}`, batchTexts(buildRefs(source, sample.language, lines).slice(0, 32)));
  }));
}

// The same workbook evaluator and batch planner as the UI preserve deduplication and row order.
for (const sheet of ['Reviews', 'Leads']) for (const schema of SCHEMAS.filter(s => !['yesno', 'scale'].includes(s.id))) {
  const wb = buildWorkbook();
  const textCol = sheet === 'Reviews' ? 2 : 3;
  const rows = sheet === 'Reviews' ? REVIEW_COUNT : LEAD_COUNT;
  for (let row = 1; row <= rows; row++) wb.setCell(sheet, row, textCol + 1, formulaFor(schema, schema.label, textCol, row));
  planChunks(wb.recalc().pending).forEach((c, i) => {
    const { route, body } = bodyFor(c.specs[0]);
    add('judge-sheets', `${sheet.toLowerCase()}-${schema.id}-${i + 1}`, route, { texts: c.texts, ...body });
  });
}
export default examples;
