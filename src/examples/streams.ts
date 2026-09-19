import type { StockExample } from '../lib/example-contract';
import { stockGroups } from '../lib/stock-batch';
import * as firehose from '../demos/firehose/data';
import * as chat from '../demos/modstream/data';
import * as logs from '../demos/log-sentinel/data';
import { RUN_ORDER, emailText } from '../demos/inbox-blitz/data';
import * as inbox from '../demos/inbox-blitz/logic';
import { DEMO_LINES } from '../demos/live-minutes/data';
import { windowCalls } from '../demos/live-minutes/judge';

const examples: StockExample[] = [];
function cohorts(demo: string, scenario: string, route: StockExample['route'], stock: string[], rest: Record<string, unknown>) {
  stockGroups(stock).forEach((texts, index) => examples.push({ demo, scenario: `${scenario}-${index + 1}`, route, body: { texts, ...rest } }));
}
cohorts('firehose', 'chat-category', 'classify', firehose.STOCK_TEXTS, { labels: firehose.CATEGORY_LABELS });
cohorts('firehose', 'chat-language', 'classify', firehose.STOCK_TEXTS, { labels: firehose.LANGUAGE_LABELS });
cohorts('firehose', 'chat-severity', 'rate', firehose.STOCK_TEXTS, { scale: firehose.SEVERITY_SCALE });
cohorts('modstream', 'chat-and-raid-signals', 'yes-no', chat.STOCK_TEXTS, { statements: chat.STATEMENTS.map(s => s.statement) });
cohorts('modstream', 'chat-and-raid-action', 'classify', chat.STOCK_TEXTS, { labels: chat.ACTION_LABELS });
cohorts('modstream', 'chat-and-raid-severity', 'rate', chat.STOCK_TEXTS, { scale: chat.SEVERITY_SCALE });
cohorts('log-sentinel', 'sample-and-storm-actionable', 'yes-no', logs.STOCK_TEXTS, { ...logs.ACTIONABLE });
cohorts('log-sentinel', 'sample-and-storm-security', 'yes-no', logs.STOCK_TEXTS, { ...logs.SECURITY });
cohorts('log-sentinel', 'sample-and-storm-severity', 'rate', logs.STOCK_TEXTS, { scale: logs.SEVERITY_SCALE });
cohorts('log-sentinel', 'sample-and-storm-category', 'classify', logs.STOCK_TEXTS, { labels: logs.CATEGORY_LABELS });
for (const call of windowCalls(DEMO_LINES.slice(0, 40))) {
  const { texts, ...rest } = call.body;
  cohorts('live-minutes', `meeting-${call.key}`, call.route, texts as string[], rest);
}
// All three shipped inbox sizes share prefixes of these same eight complete batches.
for (let offset = 0; offset < 256; offset += 32) {
  const texts = RUN_ORDER.slice(offset, offset + 32).map(emailText);
  const scenario = `sample-inbox-${offset / 32 + 1}`;
  examples.push(
    { demo: 'inbox-blitz', scenario: `${scenario}-category`, route: 'classify', body: { texts, labels: inbox.CATEGORY_LABELS } },
    { demo: 'inbox-blitz', scenario: `${scenario}-signals`, route: 'yes-no', body: { texts, statements: inbox.STATEMENT_KEYS.map(key => inbox.STATEMENTS[key]) } },
    { demo: 'inbox-blitz', scenario: `${scenario}-urgency`, route: 'rate', body: { texts, scale: inbox.URGENCY_SCALE } },
    { demo: 'inbox-blitz', scenario: `${scenario}-sentiment`, route: 'rate', body: { texts, scale: inbox.SENTIMENT_SCALE } },
  );
  inbox.SUGGESTED_INTENTS.forEach((intent, index) => examples.push({ demo: 'inbox-blitz', scenario: `${scenario}-intent-${index + 1}`, route: 'yes-no', body: { texts, statement: inbox.intentStatement(intent) } }));
}
export default examples;
