import { Sim } from './engine';
import { candidateState, flatten, LABELS, URGENCY_SCALE, HANDOFF } from './ask';
import { FIX_MAP } from './world';
export const STOCK_SCENES = 6;
export function stockSector(seed: number, rushHour: boolean, scene: number): Sim {
  const sim = new Sim({ seed, rushHour });
  // Fixed arrivals and positions, independent of the previous scene's model decisions.
  for (let tick = 0; tick < (1 + scene % STOCK_SCENES) * 40; tick++) sim.step(0.5);
  return sim;
}
export function stockRequests(seed: number, rushHour: boolean, scene: number) {
  const sim = stockSector(seed, rushHour, scene);
  const texts = sim.candidates().slice(0, 32).map(aircraft => flatten(candidateState(aircraft, sim.conflicts, sim.byId(), sim.t, FIX_MAP)));
  return [{ route: 'classify' as const, body: { texts, labels: LABELS } }, { route: 'rate' as const, body: { texts, scale: URGENCY_SCALE } }, { route: 'yes-no' as const, body: { texts, ...HANDOFF } }];
}
