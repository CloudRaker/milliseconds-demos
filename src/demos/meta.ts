/** One entry per demo, exported as `default` from src/demos/<slug>/meta.ts. The index page globs them. */
export interface DemoMeta {
  slug: string;
  title: string;
  /** One sentence, shown on the card and as the page description. */
  summary: string;
  /** The first action a visitor can take in the demo. */
  instruction: string;
  /** Which API routes the demo calls, e.g. ["yes-no", "classify"]. */
  routes: string[];
  /** The input used by the demo; omitted for existing text workflows. */
  modality?: 'text' | 'image';
  /** Source repository folder name, for the attribution link. */
  origin?: string;
  category?: "Documents & operations" | "Sales & commerce" | "Customer experience" | "Developer & interactive";
  /** Display order on the index; lower first. */
  order?: number;
}
