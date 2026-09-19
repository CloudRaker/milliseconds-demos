import { generateSchedule, generateSurge, distance } from "./data";
import { DEFAULT_SEED, RUN_SECONDS } from "./sim";
import { composeText, composePair, MERGE_RADIUS_M } from "./triage";
export const STOCK_REPORTS = [...generateSchedule(DEFAULT_SEED, RUN_SECONDS), ...generateSurge(DEFAULT_SEED, 0, 10000)];
export const STOCK_TEXTS = STOCK_REPORTS.map(composeText);
// Any model-selected nearby incident may become the original report, including a repeated surge.
export const STOCK_PAIRS = [...new Set(STOCK_REPORTS.flatMap(report => STOCK_REPORTS.filter(original => distance(original.loc, report.loc) <= MERGE_RADIUS_M).map(original => composePair({ id: "", category: original.truth.category, summary: original.text.slice(0, 140), address: original.address, age_seconds: 0, distance_m: 0, units_dispatched: 0 }, report))))];
