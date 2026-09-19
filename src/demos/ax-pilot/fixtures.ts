// The five recorded macOS accessibility trees from jev-ax-pilot/Tests/Fixtures, shipped verbatim
// (39 KB to 119 KB of raw AXUIElement JSON each) and flattened at run time by the ported
// TreeFlattener in pilot.ts — the same call the simulated-desktop loop makes every step.

import { flatten, rect, type AXNode, type AXSnapshot, type FlatTree } from "./pilot.ts";
import Calculator from "./fixtures/Calculator.json" with { type: "json" };
import TextEdit from "./fixtures/TextEdit.json" with { type: "json" };
import Safari from "./fixtures/Safari.json" with { type: "json" };
import Notes from "./fixtures/Notes.json" with { type: "json" };
import SystemSettings from "./fixtures/SystemSettings.json" with { type: "json" };

/** The recorded JSON node shape: same fields as AXNode, but frame is [[x, y], [w, h]]. */
interface RawNode extends Omit<AXNode, "frame" | "children"> {
  frame?: [[number, number], [number, number]];
  children?: RawNode[];
}
interface RawSnapshot {
  appName: string;
  windowTitle?: string;
  root: RawNode;
}

/** AXNode.swift's decoder defaults: every attribute optional, frame as origin + size pairs. */
function decode(node: RawNode): AXNode {
  const [[x, y], [w, h]] = node.frame ?? [[0, 0], [0, 0]];
  return { ...node, frame: rect(x, y, w, h), children: node.children?.map(decode) };
}
const snapshotOf = (raw: RawSnapshot): AXSnapshot => {
  const root = decode(raw.root);
  return {
    appName: raw.appName,
    // Notes and System Settings were recorded with no usable top-level title: fall back the way the
    // Swift StateBuilder did, to the frontmost window's own title and then to the app name.
    windowTitle:
      raw.windowTitle ||
      (root.children ?? []).find((c) => c.role === "AXWindow")?.title ||
      raw.appName,
    root,
  };
};

const RAW: Array<{ file: string; goal: string; raw: unknown }> = [
  { file: "Calculator", goal: "In Calculator compute 48*12", raw: Calculator },
  { file: "TextEdit", goal: "In TextEdit make a new document and type Hello from milliseconds", raw: TextEdit },
  { file: "Safari", goal: "In Safari open a new tab and go to milliseconds.ai", raw: Safari },
  { file: "Notes", goal: "Create a new note titled Grocery list in Notes", raw: Notes },
  { file: "SystemSettings", goal: "Open System Settings and turn on Dark Mode", raw: SystemSettings },
];

export interface RecordedTree {
  file: string;
  goal: string;
  /** How many nodes the recorded file holds before the flattener prunes them. */
  rawNodes: number;
  snapshot: AXSnapshot;
  tree: FlatTree;
}

const countNodes = (n: AXNode): number => 1 + (n.children ?? []).reduce((s, c) => s + countNodes(c), 0);

export default RAW.map(({ file, goal, raw }): RecordedTree => {
  const snapshot = snapshotOf(raw as RawSnapshot);
  return { file, goal, rawNodes: countNodes(snapshot.root), snapshot, tree: flatten(snapshot, goal) };
});
