// A working markdown notes editor whose command palette takes plain English.
// Editor state, commands and text helpers are the experiment's own files; the palette
// resolves natural-language commands through decision-machine-1.
import { useCallback, useEffect, useRef, useState } from "react";
import { yesNo, Dm1Error } from "../../lib/dm1.ts";
import { Benchmark } from "./Benchmark.tsx";
import { Palette, type Pick } from "./Palette.tsx";
import { DESTRUCTIVE_STATEMENT, destructiveBody, type Command } from "./data.ts";
import { execute, goToLine, initialState, openNote, renameNote, replaceAll, setSelection, setText } from "./execute.ts";
import { activeNote, cursorPosition, exportText, outlineOf, renderMarkdown, wordCount, type EditorState } from "./model.ts";
import { DESTRUCTIVE_GATE } from "./resolve.ts";
import "./demo.css";

interface Confirm {
  command: Command;
  arg?: string;
  probability?: number;
}

export default function Demo() {
  const [state, setState] = useState<EditorState>(initialState);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [promptValue, setPromptValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const applySelection = useRef(false);

  const note = activeNote(state);

  const run = useCallback((id: string, arg?: string) => {
    applySelection.current = true;
    setState((s) => execute(s, id, arg));
  }, []);

  /** Enter in the palette: destructive commands confirm straight away, the rest cost one /yes-no. */
  const onPick = useCallback(
    async (pick: Pick) => {
      setPaletteOpen(false);
      setError(null);
      if (!pick.query) {
        if (pick.destructive) setConfirm({ command: pick.command, arg: pick.arg });
        else run(pick.command.id, pick.arg);
        return;
      }
      if (pick.destructive) {
        setConfirm({ command: pick.command, arg: pick.arg });
        return;
      }
      setChecking(true);
      try {
        const body = destructiveBody(pick.query);
        const { results } = await yesNo(body.text, body.statements, body);
        const p = results[0]?.probability ?? 0;
        if (p >= DESTRUCTIVE_GATE) setConfirm({ command: pick.command, arg: pick.arg, probability: p });
        else run(pick.command.id, pick.arg);
      } catch (err) {
        setError(err instanceof Dm1Error ? `${err.code}: ${err.message}` : String(err));
        run(pick.command.id, pick.arg); // the check is a safety net, not a gate on the editor
      } finally {
        setChecking(false);
      }
    },
    [run],
  );

  // Ctrl/Cmd+K opens the palette; Ctrl+B and Ctrl+Shift+P keep their editor meanings.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "b" && !paletteOpen) {
        e.preventDefault();
        run("toggle_sidebar");
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "p" && !paletteOpen) {
        e.preventDefault();
        run("toggle_preview");
      } else if (e.key === "Escape" && !paletteOpen && (state.prompt || state.fullscreen)) {
        setState((s) => (s.prompt ? { ...s, prompt: null } : { ...s, fullscreen: false }));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, run, state.prompt, state.fullscreen]);

  // Side effects the reducer asks for (downloads) and cursor sync after a command.
  useEffect(() => {
    const ta = textareaRef.current;
    if (applySelection.current && ta && !paletteOpen && !state.prompt) {
      applySelection.current = false;
      ta.focus();
      ta.setSelectionRange(state.selection.start, state.selection.end);
    }
    if (!state.effect) return;
    const { filename, mime, body } = exportText(state.effect.format, state.effect.title, state.effect.text);
    const url = URL.createObjectURL(new Blob([body], { type: mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setState((s) => ({ ...s, effect: null }));
  }, [state.effect, state.selection, state.prompt, paletteOpen]);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => setState((s) => ({ ...s, toast: null })), 2400);
    return () => clearTimeout(t);
  }, [state.toast]);

  useEffect(() => {
    setPromptValue(state.prompt === "rename" ? note.title : "");
  }, [state.prompt, note.title]);

  const pos = cursorPosition(note.text, state.selection.start);
  const outline = outlineOf(note.text);
  const lineCount = note.text.split("\n").length;
  const matches = findText ? note.text.split(findText).length - 1 : 0;

  return (
    <div className="d-nl-palette">
      <div className="metrics">
        <p className="muted">Describe an edit in plain English. Try “make the text bigger” or “switch to dark mode”.</p>
        <span className="metrics-cta">
          <button className="btn primary" type="button" onClick={() => setPaletteOpen(true)}>
            Open the palette <kbd>⌘K</kbd>
          </button>
        </span>
      </div>
      {error ? <p className="error">{error}</p> : null}

      <div
        className={`shellwrap ${state.zen ? "zen" : ""} ${state.fullscreen ? "fullscreen" : ""}`}
        data-theme={state.theme}
        style={{ zoom: state.zoom / 100 }}
      >
        {state.fullscreen && (
          <button className="btn edfsout" type="button" onClick={() => run("toggle_fullscreen")}>
            Leave full screen <kbd>Esc</kbd>
          </button>
        )}
        <div className="edwork">
          {state.sidebar && !state.zen && (
            <aside className="edside">
              <p className="edside-title">Notes</p>
              {[...state.notes]
                .sort((a, b) => Number(b.pinned) - Number(a.pinned))
                .map((n) => (
                  <button
                    key={n.id}
                    className={`ednote ${n.id === state.activeTab ? "on" : ""}`}
                    onClick={() => setState((s) => openNote(s, n.id))}
                    type="button"
                  >
                    <span className="edpin">{n.pinned ? "★" : "·"}</span>
                    <span className="ednote-title">{n.title}</span>
                    <span className="edsmall">{wordCount(n.text)}w</span>
                  </button>
                ))}
              <p className="edside-title">Editor settings</p>
              <dl className="edkv">
                <dt>theme</dt>
                <dd>{state.theme.replace("_", " ")}</dd>
                <dt>font</dt>
                <dd>{state.fontSize}px {state.fontFamily}</dd>
                <dt>zoom</dt>
                <dd>{state.zoom}%</dd>
                <dt>wrap</dt>
                <dd>{state.wordWrap ? "on" : "off"}</dd>
                <dt>ligatures</dt>
                <dd>{state.ligatures ? "on" : "off"}</dd>
                <dt>full screen</dt>
                <dd>{state.fullscreen ? "on" : "off"}</dd>
                <dt>spell</dt>
                <dd>{state.spellCheck ? "on" : "off"}</dd>
                <dt>autosave</dt>
                <dd>{state.autosave ? "on" : "off"}</dd>
                <dt>tabs</dt>
                <dd>{state.tabs.length}</dd>
              </dl>
            </aside>
          )}

          <main className="edmain">
            {!state.zen && (
              <div className="edtabs">
                {state.tabs.map((id) => {
                  const n = state.notes.find((x) => x.id === id);
                  return n ? (
                    <button
                      key={id}
                      className={`edtab ${id === state.activeTab ? "on" : ""}`}
                      onClick={() => setState((s) => openNote(s, id))}
                      type="button"
                    >
                      {n.title}
                    </button>
                  ) : null;
                })}
                <span className="edgrow" />
                <button className="edtab ghost" type="button" onClick={() => setPaletteOpen(true)}>
                  ⌘K
                </button>
              </div>
            )}

            {state.prompt && (
              <form
                className="edprompt"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (state.prompt === "find_replace") setState((s) => replaceAll(s, findText, replaceText));
                  else if (state.prompt === "go_to_line") setState((s) => goToLine(s, Number(promptValue) || 1));
                  else if (state.prompt === "rename") setState((s) => renameNote(s, promptValue));
                  else setState((s) => ({ ...s, prompt: null }));
                  applySelection.current = true;
                }}
              >
                {(state.prompt === "find" || state.prompt === "find_replace") && (
                  <>
                    <input className="input" autoFocus placeholder="Find" value={findText} onChange={(e) => setFindText(e.target.value)} />
                    <span className="edsmall">{matches} match{matches === 1 ? "" : "es"}</span>
                  </>
                )}
                {state.prompt === "find_replace" && (
                  <>
                    <input className="input" placeholder="Replace with" value={replaceText} onChange={(e) => setReplaceText(e.target.value)} />
                    <button className="btn" type="submit">Replace all</button>
                  </>
                )}
                {state.prompt === "go_to_line" && (
                  <>
                    <input className="input" autoFocus type="number" min={1} max={lineCount} placeholder={`Line 1–${lineCount}`} value={promptValue} onChange={(e) => setPromptValue(e.target.value)} />
                    <button className="btn" type="submit">Go</button>
                  </>
                )}
                {state.prompt === "rename" && (
                  <>
                    <input className="input" autoFocus placeholder="Note title" value={promptValue} onChange={(e) => setPromptValue(e.target.value)} />
                    <button className="btn" type="submit">Rename</button>
                  </>
                )}
                <button className="btn" type="button" onClick={() => setState((s) => ({ ...s, prompt: null }))}>
                  Close
                </button>
              </form>
            )}

            <div className={`edpanes ${state.preview ? "preview" : ""} ${state.split ? "split" : ""}`}>
              {Array.from({ length: state.split ? 2 : 1 }, (_, i) => (
                <div
                  key={i}
                  className={`edpane font-${state.fontFamily} ${state.typewriter ? "typewriter" : ""}`}
                  style={{ fontSize: `${state.fontSize}px`, fontVariantLigatures: state.ligatures ? "contextual" : "none" }}
                >
                  {state.lineNumbers && (
                    <div className="edgutter" aria-hidden="true">
                      {Array.from({ length: lineCount }, (_, k) => (
                        <div key={k} className={k + 1 === pos.line ? "cur" : ""}>
                          {k + 1}
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    ref={i === 0 ? textareaRef : undefined}
                    className={state.wordWrap ? "" : "nowrap"}
                    value={note.text}
                    spellCheck={state.spellCheck}
                    wrap={state.wordWrap ? "soft" : "off"}
                    aria-label={`${note.title} source`}
                    onChange={(e) => setState((s) => setText(s, e.target.value, { start: e.target.selectionStart, end: e.target.selectionEnd }))}
                    onSelect={(e) => {
                      const t = e.currentTarget;
                      setState((s) => setSelection(s, { start: t.selectionStart, end: t.selectionEnd }));
                    }}
                    // The gutter is the textarea's previous sibling; keep the two scrolled together.
                    onScroll={(e) => {
                      const g = e.currentTarget.previousElementSibling;
                      if (g instanceof HTMLElement && g.classList.contains("edgutter")) g.scrollTop = e.currentTarget.scrollTop;
                    }}
                  />
                  {state.minimap && (
                    <div className="edminimap" aria-hidden="true">
                      {note.text.split("\n").map((l, k) => (
                        <div key={k} style={{ width: `${Math.min(100, l.length * 1.2)}%`, opacity: l.startsWith("#") ? 1 : 0.45 }} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {state.preview && <article className="edpreview" dangerouslySetInnerHTML={{ __html: renderMarkdown(note.text) }} />}
            </div>

            {state.statusBar && (
              <footer className="edstatus">
                <span>Ln {pos.line}, Col {pos.col}</span>
                <span>{state.selection.end > state.selection.start ? `${state.selection.end - state.selection.start} selected` : "no selection"}</span>
                <span>{wordCount(note.text)} words</span>
                <span className="edgrow" />
                <span>{state.autosave ? "autosave" : "manual save"}</span>
                <span>{state.spellCheck ? "spell ✓" : "spell ✗"}</span>
                <span>{state.zoom}%</span>
              </footer>
            )}
          </main>

          {state.outline && !state.zen && (
            <aside className="edoutline">
              <p className="edside-title">Outline</p>
              {outline.length === 0 ? <p className="edsmall">No headings</p> : null}
              {outline.map((h, i) => (
                <button
                  key={i}
                  className="edoutline-row"
                  style={{ paddingLeft: `${10 + (h.level - 1) * 12}px` }}
                  onClick={() => setState((s) => goToLine(s, h.line))}
                  type="button"
                >
                  <span className="edsmall">H{h.level}</span> {h.title}
                </button>
              ))}
            </aside>
          )}
        </div>

        {state.toast ? <p className="edtoast">{state.toast}</p> : null}
        {checking ? <p className="edtoast">Checking whether that discards anything…</p> : null}
      </div>

      <Benchmark />

      {paletteOpen && (
        <Palette
          theme={state.theme}
          onPick={onPick}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {confirm && (
        <div className="pal-backdrop" onMouseDown={() => setConfirm(null)}>
          <div className="pal confirm" onMouseDown={(e) => e.stopPropagation()} role="alertdialog" aria-label="Confirm command">
            <h3>Run “{confirm.command.title}”?</h3>
            <p className="muted">{confirm.command.description}</p>
            <p className="muted mono">
              {confirm.probability === undefined
                ? "This command is flagged destructive in the catalog, so it always asks."
                : `/yes-no put “${DESTRUCTIVE_STATEMENT}” at ${Math.round(confirm.probability * 100)}%, above the ${DESTRUCTIVE_GATE} gate.`}
            </p>
            <div className="confirm-actions">
              <button className="btn" type="button" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                autoFocus
                onClick={() => {
                  run(confirm.command.id, confirm.arg);
                  setConfirm(null);
                }}
              >
                Run it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
