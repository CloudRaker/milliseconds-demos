import { canonical, type StockExample } from '../lib/example-contract';
import recordings from '../demos/ax-pilot/stock-recordings.json';

// These real responses form complete bounded traces. Pin the whole recording: refreshing an
// individual decision could produce a new state whose next request is outside this finite catalog.
// The initial Settings simulation and recorded tree produce identical requests. The first real
// capture is shared by both, avoiding two different recorded answers for a single cache identity.
const seen = new Set<string>();
export default (recordings as StockExample[]).filter(({ route, body }) => {
  const key = canonical({ route, body });
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
