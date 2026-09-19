// Sends the demo's real request bodies to the live API and prints the answers.
//   MS_API_KEY=sk-... node src/demos/swarm/smoke.mjs
// Node 24 strips the types in data.ts, so the scenes and statements here are the page's.
import {
  CHASE_THRESHOLD,
  FAR,
  FLEE_THRESHOLD,
  JUDGMENTS,
  MID,
  SEED,
  applyDecision,
  buildPerception,
  composeDecision,
  createWorld,
  heuristicDecision,
  neighbours,
  sceneText,
  step,
} from "./data.ts";

const API = "https://api.milliseconds.ai/v1/decision-machine-1";
const KEY = process.env.MS_API_KEY;
if (!KEY) throw new Error("set MS_API_KEY");

async function yesNo(texts, j) {
  const t0 = performance.now();
  const res = await fetch(`${API}/yes-no`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ texts, statement: j.statement, when_true: j.when_true, when_false: j.when_false }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`yes-no ${res.status}: ${body.slice(0, 300)}`);
  return {
    results: JSON.parse(body).results,
    wall: Math.round(performance.now() - t0),
    inference: res.headers.get("x-inference-ms"),
    tokens: res.headers.get("x-input-tokens"),
  };
}

// Warm the seeded world with six seconds of code play, so agents cluster, hunt and hide.
const world = createWorld({ seed: SEED, agentCount: 16, policy: "heuristic", human: false });
for (let i = 0; i < 60 * 6; i++) {
  if (i % 60 === 0) for (const a of world.agents) applyDecision(a, { ...heuristicDecision(world, a), seq: ++a.seq }, i * 16);
  step(world, 1 / 60);
}

const agents = world.agents.filter((a) => a.alive).slice(0, 16);
const per = agents.map((a) => buildPerception(world, a));

// Probes the seed world does not produce on its own: a predator walking in, prey at every
// distance band, and both of those given to a greedy agent and to a cautious one.
const base = per[0];
const probe = (p, over) => ({ ...p, ...over });
const sweep = [40, 120, 250, 600].map((d) => ({
  tag: `predator ${d}px`,
  p: probe(base, {
    nearby_agents: [
      { id: "a90", rel: "bigger", size: 60, dist: d, dir: "E", moving: "W (toward you)" },
      ...base.nearby_agents.filter((a) => a.rel !== "bigger").slice(0, 2),
    ],
  }),
}));
const preyBands = [
  ["lunge", 60],
  ["short chase", 150],
  ["far off", 320],
  ["none", 900],
];
const styled = [];
for (const style of ["greedy", "cautious"]) {
  for (const [name, d] of preyBands) {
    styled.push({
      tag: `prey ${name}, ${style}`,
      p: probe(base, {
        you: { ...base.you, personality: style },
        nearby_agents: [{ id: "a91", rel: "smaller", size: 10, dist: d, dir: "N", moving: "still" }],
      }),
    });
  }
}

// The scenes that caught the run question acting on scenery: a prowler in the 200-400px
// band (which the text calls "prowls in the distance") with and without prey in reach,
// and a no-threat scene for the two personalities the sweep above does not cover.
const lunge = { id: "a91", rel: "smaller", size: 10, dist: 60, dir: "N", moving: "still" };
const prowler = { id: "a90", rel: "bigger", size: 60, dist: 250, dir: "E", moving: "W (toward you)" };
const traps = [
  { tag: "prowler 250 + prey", p: probe(base, { nearby_agents: [prowler, lunge] }) },
  { tag: "prowler 250, no prey", p: probe(base, { nearby_agents: [prowler] }) },
  ...["aggressive", "trickster"].map((style) => ({
    tag: `no threat + prey, ${style}`,
    p: probe(base, { you: { ...base.you, personality: style }, nearby_agents: [lunge] }),
  })),
];

const allP = [...per, ...sweep.map((x) => x.p), ...styled.map((x) => x.p), ...traps.map((x) => x.p)];
const tags = [...agents.map((a) => a.id), ...sweep.map((x) => x.tag), ...styled.map((x) => x.tag), ...traps.map((x) => x.tag)];
if (allP.length > 32) throw new Error(`${allP.length} scenes: one texts array holds at most 32`);

// Each judgment sends its own texts: only the run question gets the personality sentence.
const out = {};
for (const j of JUDGMENTS) {
  const texts = allP.map((p) => sceneText(p, { style: j.style }));
  const r = await yesNo(texts, j);
  out[j.key] = { ...r, texts };
  console.log(
    `${j.key.padEnd(6)} ${r.wall}ms round trip, ${r.inference}ms model, ${r.tokens} input tokens for ${texts.length} scenes` +
      `${j.style ? " (style line included)" : ""}`,
  );
}

const pad = (v, n) => String(v).padEnd(n);
console.log(`\n${pad("scene", 22)}${pad("run?", 10)}${pad("chase?", 10)}${pad("boost?", 10)}what the code does`);
for (let i = 0; i < allP.length; i++) {
  const p = (k) => {
    const r = out[k].results[i];
    return `${r.answer ? "yes" : "no "} ${r.probability.toFixed(2)}`;
  };
  const j = { flee: out.flee.results[i].probability, chase: out.chase.results[i].probability, boost: out.boost.results[i].probability, at: 1 };
  let act;
  if (i < agents.length) {
    const d = composeDecision(world, agents[i], j);
    const n = neighbours(world, agents[i]);
    act = `${d.target === n.prey?.id ? "chase" : d.target ? "feed" : "flee"} ${d.move}${d.boost ? " + boost" : ""}`;
  } else {
    act = j.flee >= FLEE_THRESHOLD ? "flee" : j.chase >= CHASE_THRESHOLD ? "chase" : "feed";
  }
  console.log(`${pad(tags[i], 22)}${pad(p("flee"), 10)}${pad(p("chase"), 10)}${pad(p("boost"), 10)}${act}`);
}

// The bug this run has to catch: composeDecision must never target prey the scene text
// declared invisible. Anything past FAR reads as "You see nothing small enough to swallow".
let contradictions = 0;
for (let i = 0; i < agents.length; i++) {
  const a = agents[i];
  const { prey, preyD } = neighbours(world, a);
  const text = out.chase.texts[i];
  const blind = text.includes("nothing small enough to swallow");
  const d = composeDecision(world, a, { flee: 0, chase: 1, boost: 0, at: 1 });
  if (blind && prey && d.target === prey.id) {
    contradictions++;
    console.log(`  CONTRADICTION ${a.id}: text says no prey, code targets ${prey.id} at ${Math.round(preyD)}px`);
  }
}
console.log(`\nprey past FAR=${FAR}px that the code still targeted: ${contradictions} (must be 0)`);
console.log(`\nsample run scene (${tags[0]}):\n${out.flee.texts[0]}`);
console.log(`sample chase scene (${tags[0]}):\n${out.chase.texts[0]}`);
// The run question must separate a real predator from scenery: anything the text calls a
// distant prowler, or no threat at all, has to stay under the threshold that makes an
// agent turn and run.
let falseRuns = 0;
for (let i = agents.length; i < allP.length; i++) {
  const big = allP[i].nearby_agents.find((a) => a.rel === "bigger");
  const scenery = !big || big.dist >= MID;
  const p = out.flee.results[i].probability;
  if (scenery && p >= FLEE_THRESHOLD) {
    falseRuns++;
    console.log(`  FALSE RUN ${tags[i]}: run=${p.toFixed(2)} with no threat inside ${MID}px`);
  }
}
console.log(`probe scenes with no close threat that still answered run: ${falseRuns} (must be 0)`);

console.log(`\nExpect: run rises only as the predator closes inside ${MID}px; chase high only for lunge/short chase,`);
console.log(`and the same for greedy and cautious; boost high only when something is at contact range.`);
