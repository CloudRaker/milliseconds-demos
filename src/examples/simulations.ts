import type { StockExample } from '../lib/example-contract';
import { stockGroups } from '../lib/stock-batch';
import * as assist from '../demos/agent-assist/data';
import * as dispatch from '../demos/dispatch/triage';
import { STOCK_TEXTS, STOCK_PAIRS } from '../demos/dispatch/stock';
import { STOCK_SEGMENTS, slotLabels } from '../demos/voice-turn/stock';
import { INTENT_LABELS, BARGE_IN, bargeInText, type Intent } from '../demos/voice-turn/data';
import { stockRequests as swarmRequests, STOCK_SCENES as SWARM_SCENES } from '../demos/swarm/stock';
import { stockRequests as towerRequests, STOCK_SCENES as TOWER_SCENES } from '../demos/tower/stock';
import { SEEDS } from '../demos/tower/data';
const examples: StockExample[] = [];
function groups(demo: string, scenario: string, route: StockExample['route'], texts: string[], rest: Record<string, unknown>) {
  stockGroups(texts).forEach((group, index) => examples.push({ demo, scenario: `${scenario}-${index + 1}`, route, body: { texts: group, ...rest } }));
}
groups('agent-assist', 'reply-macros', 'classify', assist.STOCK_TRANSCRIPTS, { labels: assist.MACRO_LABELS });
groups('agent-assist', 'intent', 'classify', assist.STOCK_TRANSCRIPTS, { labels: assist.INTENT_LABELS });
groups('agent-assist', 'churn', 'rate', assist.STOCK_TRANSCRIPTS, { scale: assist.CHURN_SCALE });
groups('agent-assist', 'frustration', 'rate', assist.STOCK_LATEST, { scale: assist.FRUSTRATION_SCALE });
groups('agent-assist', 'signals', 'yes-no', assist.STOCK_TRANSCRIPTS, { statements: assist.STATEMENTS });
groups('dispatch', 'category', 'classify', STOCK_TEXTS, { labels: dispatch.CATEGORY_LABELS });
groups('dispatch', 'severity', 'rate', STOCK_TEXTS, { scale: dispatch.SEVERITY_SCALE });
groups('dispatch', 'units', 'classify', STOCK_TEXTS, { labels: dispatch.PACKAGE_LABELS });
groups('dispatch', 'hazards', 'yes-no', STOCK_TEXTS, { statements: dispatch.STATEMENTS, ...dispatch.HINTS });
groups('dispatch', 'duplicate', 'yes-no', STOCK_PAIRS, { statements: [dispatch.DUPLICATE_STATEMENT], ...dispatch.DUPLICATE_HINTS });
groups('voice-turn', 'intent', 'classify', STOCK_SEGMENTS, { labels: INTENT_LABELS });
groups('voice-turn', 'interruption', 'yes-no', STOCK_SEGMENTS.map(segment => bargeInText('', segment)), { statements: [BARGE_IN.statement], when_true: BARGE_IN.when_true, when_false: BARGE_IN.when_false });
for (const [index, text] of STOCK_SEGMENTS.entries()) {
  for (const intent of Object.keys(INTENT_LABELS) as Intent[]) {
    const labels = slotLabels(intent, text);
    if (labels) examples.push({ demo: 'voice-turn', scenario: `detail-${index}-${intent}`, route: 'classify', body: { text, labels } });
  }
}
for (const count of [8, 16, 24, 32]) for (let scene = 0; scene < SWARM_SCENES; scene++) {
  swarmRequests(count, scene).forEach((body, index) => examples.push({ demo: 'swarm', scenario: `agents-${count}-scene-${scene + 1}-question-${index + 1}`, route: 'yes-no', body }));
}
for (const { seed } of SEEDS) for (const rush of [false, true]) for (let scene = 0; scene < TOWER_SCENES; scene++) {
  towerRequests(seed, rush, scene).forEach(({ route, body }) => {
    if (body.texts.length) examples.push({ demo: 'tower', scenario: `seed-${seed}-${rush ? 'rush' : 'normal'}-scene-${scene + 1}-${route}`, route, body });
  });
}
export default examples;
