import { buildPerception, createWorld, JUDGMENTS, sceneText, SEED } from './data';
export const STOCK_SCENES = 6;
export function stockWorld(agentCount: number, scene: number) {
  return createWorld({ seed: SEED + scene % STOCK_SCENES, agentCount, policy: 'dm1', human: true });
}
export function stockRequests(agentCount: number, scene: number) {
  const world = stockWorld(agentCount, scene);
  return JUDGMENTS.map(judgment => ({ texts: world.agents.filter(agent => agent.controller === 'dm1').map(agent => sceneText(buildPerception(world, agent), { style: judgment.style })), statement: judgment.statement, when_true: judgment.when_true, when_false: judgment.when_false }));
}
