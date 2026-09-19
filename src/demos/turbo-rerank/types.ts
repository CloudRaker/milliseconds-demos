/** Types shared by the corpus fixtures, the BM25 index and the island. Ported from the Jev experiment. */
export type DocKind = "handbook" | "hr" | "api" | "runbook" | "architecture";

export interface Passage {
  id: string;
  doc: string;
  title: string;
  kind: DocKind;
  text: string;
}

export interface Bm25Hit {
  id: string;
  score: number;
}

export interface BenchQuery {
  query: string;
  target: string;
  /** Shares (almost) no content words with the target passage. */
  paraphrase?: boolean;
}
