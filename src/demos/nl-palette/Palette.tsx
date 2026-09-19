// The command palette itself: debounced /classify-tree per keystroke pause, a chained
// /classify for the argument slot, the confidence gate, and a local fallback when the API is unavailable.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { classify, dm1, Dm1Error, onRateLimited, rateMany } from "../../lib/dm1.ts";
import { ARG_LABELS, ARG_SCALES, COMMANDS, GROUP_BY_KEY, PALETTE_EXAMPLES, paletteText, treeBody, type Command, type Theme } from "./data.ts";
import { fuzzyRank } from "./fuzzy.ts";
import { gateOf, pickTheme, previewLabel, rank, type Gate, type RankedCommand } from "./resolve.ts";

export const DEBOUNCE_MS = 250;

interface TreeLevel {
  label: string;
  probability: number;
  confidence: number;
  scores: Record<string, number>;
}
interface TreeResult {
  path: string[];
  label: string;
  probability: number;
  confidence: number;
  levels: TreeLevel[];
}

interface Resolved {
  query: string;
  group: TreeLevel;
  ranked: RankedCommand[];
  probability: number;
  gate: Gate;
  argPending: boolean;
}

export interface Pick {
  command: Command;
  arg?: string;
  /** What the user typed, reused verbatim as the text of the destructive check. */
  query: string;
  /** Already known to be destructive; skip the /yes-no call. */
  destructive: boolean;
}

interface Props {
  /** The only editor state the palette needs: pickTheme flips away from it. */
  theme: Theme;
  onPick: (p: Pick) => void;
  onClose: () => void;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function Palette({ theme, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Resolved | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [explicitPick, setExplicitPick] = useState(false);
  // dm1() retries 429 internally, so the pill is the only sign the visitor gets.
  const [rateLimited, setRateLimited] = useState(0);
  const inflight = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = query.trim();

  // Keep local title matching as an explicitly labelled outage fallback.
  const fuzzy = useMemo(() => trimmed ? fuzzyRank(trimmed, COMMANDS) : [], [trimmed]);

  const resolve = useCallback(
    async (q: string, signal: AbortSignal) => {
      const text = paletteText(q);
      const tree = await dm1<TreeResult>("classify-tree", treeBody(q), signal);
      const leaf = tree.data.levels[tree.data.levels.length - 1];
      const ranked = rank(leaf.scores, 8);
      const top = ranked[0];
      const slot = top?.command.arg;
      setResult({
        query: q,
        group: tree.data.levels[0],
        ranked,
        probability: tree.data.probability,
        gate: gateOf(tree.data.probability),
        argPending: Boolean(slot),
      });
      setPending(Boolean(slot));
      if (!slot) return;

      // Second call, only for the four commands that take an argument: /rate for the two
      // ordinal slots (font size, heading level), /classify for the two named ones.
      const steps = ARG_SCALES[slot];
      let value: string;
      let argProbability: number;
      if (steps) {
        const r = await rateMany([text], steps.map((x) => x.description), signal);
        value = steps[r.results[0].level].value;
        argProbability = r.results[0].scores[r.results[0].level];
      } else {
        const arg = await classify(text, ARG_LABELS[slot]!, signal);
        value = slot === "theme" ? pickTheme(arg.result.scores, theme, q) : arg.result.label;
        argProbability = arg.result.scores[value];
      }
      setResult((r) =>
        r && r.query === q
          ? {
              ...r,
              argPending: false,
              ranked: r.ranked.map((x) => (x.command.id === top.command.id ? { ...x, arg: value, argProbability } : x)),
            }
          : r,
      );
    },
    [theme],
  );

  // One request per keystroke pause. Stale requests are aborted, so a fast typist
  // costs one call, not one per letter.
  useEffect(() => {
    if (!trimmed) {
      inflight.current?.abort();
      inflight.current = null;
      setResult(null);
      setPending(false);
      setError(null);
      return;
    }
    const timer = setTimeout(() => {
      if (inflight.current) {
        inflight.current.abort();
      }
      const controller = new AbortController();
      inflight.current = controller;
      setPending(true);
      setError(null);
      resolve(trimmed, controller.signal)
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Dm1Error ? `${err.code}: ${err.message}` : err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (controller.signal.aborted) return;
          inflight.current = null;
          setPending(false);
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [trimmed, resolve]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => onRateLimited(setRateLimited), []);
  useEffect(() => {
    setCursor(0);
    setExplicitPick(false);
  }, [result?.query]);
  useEffect(() => () => inflight.current?.abort(), []);

  const stale = result !== null && result.query !== trimmed;
  const uncertain = result?.gate === "uncertain";
  const fallback = Boolean(error);

  /** What Enter acts on: the catalog when empty, local title matching after an error. */
  const primary: Array<{ command: Command; arg?: string; probability?: number; argProbability?: number }> = useMemo(() => {
    if (!trimmed) return COMMANDS.slice(0, 12).map((command) => ({ command }));
    if (fallback) return fuzzy.slice(0, 8).map((f) => ({ command: f.command }));
    const list = result?.ranked ?? [];
    return (uncertain ? list.slice(0, 3) : list).map((r) => ({ command: r.command, arg: r.arg, probability: r.probability, argProbability: r.argProbability }));
  }, [trimmed, fallback, fuzzy, result, uncertain]);

  function choose(i: number) {
    const item = primary[i];
    if (!item) return;
    onPick({ command: item.command, arg: item.arg, query: trimmed, destructive: Boolean(item.command.destructive) });
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setExplicitPick(true);
      setCursor((c) => Math.min(primary.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setExplicitPick(true);
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (pending && !result) return;
      // Below the gate, Enter needs an explicit pick: arrow keys or the mouse.
      if (uncertain && !fallback && trimmed && !explicitPick) return;
      choose(cursor);
    }
  }


  return (
    <div className="pal-backdrop" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Command palette">
        <div className="pal-input-row">
          <span className="pal-caret">›</span>
          <input
            ref={inputRef}
            className="pal-input"
            placeholder="Describe what you want… “make this louder”, “hide the left thing”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            autoComplete="off"
          />
          <button className="btn" type="button" onClick={onClose} aria-label="Close command palette">Close</button>
        </div>

        <div className="pal-examples" aria-label="Free example commands">
          {PALETTE_EXAMPLES.map((example) => <button className="btn" type="button" key={example} onClick={() => setQuery(example)}>{example}</button>)}
        </div>

        <div className="pal-status">
          {!trimmed ? (
            <span className="muted">{COMMANDS.length} commands · describe the effect, not the command name</span>
          ) : error ? (
            <>
              <span className="error">{error}</span>
              <span className="tag warn">local title matching · {error.startsWith("no_key:") ? "API key required" : "API unavailable"}</span>
            </>
          ) : result ? (
            <>
              <span className={`tag ${result.gate === "confident" ? "good" : "warn"}`}>
                {result.gate === "confident" ? "confident" : "low confidence — pick one"}
              </span>
              <span className="muted mono">
                {GROUP_BY_KEY[result.group.label] ?? result.group.label} {pct(result.group.probability)} → command match {pct(result.probability)}
              </span>
            </>
          ) : (
            <span className="muted">thinking…</span>
          )}
          {rateLimited > 0 ? <span className="tag warn">rate limited, retrying</span> : null}
          {pending ? <span className="pal-spin" aria-label="request in flight" /> : null}
        </div>

        {!fallback && result ? (
          <div className="pal-groups" title="Level 1 of the tree: which group of commands">
            {Object.entries(result.group.scores)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([g, p]) => (
                <span key={g} className={`pal-group ${g === result.group.label ? "on" : ""}`}>
                  {GROUP_BY_KEY[g] ?? g} <i>{pct(p)}</i>
                </span>
              ))}
          </div>
        ) : null}

        <div className={`pal-cols ${stale || pending ? "stale" : ""}`}>
          {(
            <ul className="pal-list" role="listbox" aria-label="Commands">
              {primary.length === 0 && trimmed && !pending ? (
                <li className="pal-empty">
                  {fallback ? "No local match. Try words from a command title." : "No result"}
                </li>
              ) : null}
              {primary.map((item, i) => (
                <li
                  key={item.command.id}
                  role="option"
                  aria-selected={i === cursor}
                  className={`pal-row ${i === cursor ? "cur" : ""} ${i === 0 && trimmed && result?.gate === "confident" ? "top" : ""} ${uncertain && trimmed && !fallback ? "pickme" : ""}`}
                  onMouseEnter={() => {
                    setCursor(i);
                    setExplicitPick(true);
                  }}
                  onClick={() => choose(i)}
                >
                  <span className="pal-title">
                    {trimmed && !fallback ? previewLabel({ command: item.command, arg: item.arg }) : item.command.title}
                    {item.argProbability !== undefined ? <span className="muted mono"> · arg {pct(item.argProbability)}</span> : null}
                    {fallback ? <span className="tag warn">local match</span> : null}
                    {item.arg === undefined && item.command.arg && result?.argPending && i === 0 ? <span className="muted"> …</span> : null}
                  </span>
                  <span className="pal-group-name">{item.command.group}</span>
                  {item.probability !== undefined ? (
                    <span className="pal-bar">
                      <span className="bar">
                        <i style={{ width: `${Math.max(2, item.probability * 100)}%` }} />
                      </span>
                      <b>{pct(item.probability)}</b>
                    </span>
                  ) : item.command.shortcut ? (
                    <kbd>{item.command.shortcut}</kbd>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pal-foot">
          <span className="muted">
            <kbd>↑↓</kbd> move · <kbd>↵</kbd> run · <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
