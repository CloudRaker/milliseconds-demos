import { useEffect, useRef, useState } from 'react';
import { ArrowCounterClockwiseIcon, ArrowRightIcon, CheckCircleIcon, DownloadSimpleIcon, MagnifyingGlassIcon, PlusIcon, TagIcon, WarningCircleIcon, XIcon } from '@phosphor-icons/react';
import { dm1 } from '../../lib/dm1';
import { trackDemoEvent } from '../../lib/demo-events';
import { categoryRequest, attributesRequest, csv, exportRecords, FIELDS, parseBatch, PATHS, REQUIRED, type Field, type RecordResult } from './logic';
import { SAMPLE, PREVIEW } from './fixtures';
import './demo.css';

export default function Demo() {
  const [sources, setSources] = useState(SAMPLE);
  const [results, setResults] = useState<RecordResult[] | null>(PREVIEW);
  const [preview, setPreview] = useState(true);
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<'all' | 'review'>('all');
  const [focusField, setFocusField] = useState<Field | null>(null);
  const [status, setStatus] = useState('Sample preview · four fictional listings, no API calls.');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const controller = useRef<AbortController | null>(null);
  const current = results?.[selected];
  const matched = focusField ? current?.attributes[focusField] : null;
  const reviewCount = results?.filter(row => row.issues.length).length ?? 0;
  useEffect(() => { trackDemoEvent('catalog-studio', 'sample_viewed'); return () => controller.current?.abort(); }, []);

  function changeSources(next: string[]) {
    controller.current?.abort(); controller.current = null;
    setRunning(false); setSources(next); setResults(null); setPreview(false); setFocusField(null); setFilter('all'); setError('');
    setStatus('Input changed · structure the catalog to build fresh records.');
  }
  function reset() {
    controller.current?.abort(); controller.current = null;
    setSources(SAMPLE); setResults(PREVIEW); setPreview(true); setSelected(0); setFocusField(null); setFilter('all'); setRunning(false); setError('');
    setStatus('Sample preview · four fictional listings, no API calls.'); trackDemoEvent('catalog-studio', 'sample_viewed');
  }
  async function run() {
    if (controller.current) return;
    if (sources.some(text => !text.trim())) { setError('Each listing needs a description. Fill or remove the empty listing.'); return; }
    const ctrl = new AbortController(); controller.current = ctrl;
    setRunning(true); setPreview(false); setResults(null); setFocusField(null); setFilter('all'); setError(''); setStatus(`Categorizing ${sources.length} listings…`);
    trackDemoEvent('catalog-studio', 'run_started');
    if (JSON.stringify(sources) !== JSON.stringify(SAMPLE)) trackDemoEvent('catalog-studio', 'own_input_run');
    try {
      const categories = await dm1('classify', categoryRequest(sources), ctrl.signal);
      if (controller.current !== ctrl) return;
      setStatus('Reading stated attributes and checking required fields…');
      const attributes = await dm1('extract', attributesRequest(sources), ctrl.signal);
      if (controller.current !== ctrl) return;
      const records = parseBatch(sources, categories.data, attributes.data);
      setResults(records);
      const review = records.filter(record => record.issues.length).length;
      setStatus(`Model draft · ${records.length} listings structured. ${review} ${review === 1 ? 'listing needs' : 'listings need'} attention. Nothing published.`);
      trackDemoEvent('catalog-studio', 'run_completed');
    } catch (error) {
      if (controller.current !== ctrl) return;
      setError(error instanceof Error ? error.message : 'The request failed. Try structuring the catalog again.');
      setStatus('Run failed · no completed records. Your descriptions are preserved.');
      trackDemoEvent('catalog-studio', 'run_failed');
    } finally {
      if (controller.current === ctrl) { controller.current = null; setRunning(false); }
    }
  }
  function cancel() {
    controller.current?.abort(); controller.current = null; setRunning(false); setResults(null);
    setStatus('Stopped · no completed records. Structure catalog to retry.'); trackDemoEvent('catalog-studio', 'run_cancelled');
  }
  function download(format: 'csv' | 'json') {
    if (!results) return;
    const rows = exportRecords(sources, results, preview);
    const blob = new Blob([format === 'csv' ? csv(rows) : JSON.stringify(rows, null, 2)], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `catalog-draft.${format}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    trackDemoEvent('catalog-studio', 'exported');
  }
  const visible = sources.map((source, index) => ({ source, index })).filter(({ index }) => filter === 'all' || results?.[index].issues.length);
  return <div className="catalog-studio">
    <div className="catalog-toolbar">
      <div><span className="panel-title">Listing workbench</span><h2>From copy to catalog.</h2><p>Keep the facts. Find the gaps. Export a draft.</p></div>
      <div className="catalog-actions"><button className="btn" onClick={reset} disabled={running}><ArrowCounterClockwiseIcon size={16} aria-hidden="true" /> Reset sample</button>{running ? <button className="btn" onClick={cancel}><XIcon size={16} aria-hidden="true" /> Stop</button> : <button className="btn primary" onClick={run}>Structure catalog <ArrowRightIcon size={17} aria-hidden="true" /></button>}</div>
    </div>
    <p className="catalog-status" role="status">{status}</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="catalog-summary"><span><b>{sources.length}</b> source listings</span><span><b>{results ? results.length - reviewCount : '—'}</b> required fields present</span><span><b>{results ? reviewCount : '—'}</b> need attention</span><span className="tag">{preview ? 'Sample preview' : results ? 'Model draft' : running ? 'Processing' : 'Unprocessed'}</span></div>
    <div className="catalog-board">
      <section className="catalog-list" aria-label="Catalog listings">
        <div className="catalog-list-head"><div className="catalog-tabs"><button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All listings</button><button aria-pressed={filter === 'review'} onClick={() => setFilter('review')} disabled={!results}>Needs attention {results ? `(${reviewCount})` : ''}</button></div><button className="catalog-add" aria-label="Add listing" disabled={sources.length >= 8 || running} onClick={() => { changeSources([...sources, '']); setSelected(sources.length); }}><PlusIcon size={18} aria-hidden="true" /></button></div>
        <div className="catalog-rows">{visible.map(({ source, index }) => {
          const record = results?.[index];
          return <button key={index} className={`catalog-row ${selected === index ? 'selected' : ''}`} aria-pressed={selected === index} onClick={() => { setSelected(index); setFocusField(null); }}>
            <span className="catalog-row-index">{String(index + 1).padStart(2, '0')}</span><span className="catalog-row-main"><strong>{source.split(/[.\n]/)[0].slice(0, 90) || 'New listing'}</strong><span>{record ? PATHS[record.category] : running ? 'Processing…' : 'Awaiting run'}</span><small>{record ? record.issues.length ? record.issues[0] + (record.issues.length > 1 ? ` +${record.issues.length - 1}` : '') : 'Required fields present' : 'Edit the source, then structure the catalog'}</small></span>{record ? record.issues.length ? <WarningCircleIcon className="catalog-warning" size={20} aria-label="Needs attention" /> : <CheckCircleIcon size={20} className="catalog-check" aria-label="Required fields present" /> : <TagIcon size={20} aria-hidden="true" />}
          </button>;
        })}{!visible.length && <p className="catalog-empty">No listings need attention. All required fields are present; review drafts before publishing.</p>}</div>
        <p className="catalog-list-note">Up to 8 listings · clothing, furniture & audio</p>
      </section>
      <section className="catalog-inspector" aria-label="Selected listing">
        <div className="catalog-inspector-head"><div><p className="panel-title">Listing {String(selected + 1).padStart(2, '0')}</p><h3>{current ? PATHS[current.category] : 'Build a structured record'}</h3></div>{sources.length > 1 && <button className="catalog-remove" disabled={running} onClick={() => { changeSources(sources.filter((_, index) => index !== selected)); setSelected(Math.max(0, selected - 1)); }}>Remove</button>}</div>
        <label className="catalog-label" htmlFor="catalog-description">Original description</label>
        <textarea id="catalog-description" className="textarea" value={sources[selected]} maxLength={20000} readOnly={running} onChange={event => changeSources(sources.map((source, index) => index === selected ? event.target.value : source))} />
        <div className="catalog-source-meta"><span>Editable source · facts are never filled from assumptions</span><span>{sources[selected].length.toLocaleString()} / 20,000</span></div>
        {current ? <>
          <div className="catalog-attribute-heading"><h4>Extracted attributes</h4><span>{preview ? 'Curated sample values' : 'Click a value to inspect its wording'}</span></div>
          <div className="catalog-attributes">{(Object.keys(FIELDS) as Field[]).filter(field => REQUIRED[current.category].includes(field) || current.attributes[field]).map(field => {
            const attribute = current.attributes[field];
            return <div key={field} className="catalog-attribute"><span>{field}{REQUIRED[current.category].includes(field) && <small>Required</small>}</span>{attribute ? <button aria-pressed={focusField === field} onClick={() => { setFocusField(field); trackDemoEvent('catalog-studio', 'evidence_opened'); }}><span>{attribute.value}{attribute.normalized && <small>Normalized: {attribute.normalized}</small>}</span><MagnifyingGlassIcon size={15} aria-hidden="true" /></button> : <span className="catalog-missing">Not stated</span>}</div>;
          })}</div>
          {matched && <div className="catalog-evidence"><p className="panel-title">Source wording · {focusField}</p><p>{sources[selected].slice(0, matched.start)}<mark>{sources[selected].slice(matched.start, matched.end)}</mark>{sources[selected].slice(matched.end)}</p><small>Exact wording located in this description. Check that it belongs to this attribute.</small></div>}
          {current.issues.length > 0 ? <div className="catalog-review"><h4><WarningCircleIcon size={18} aria-hidden="true" /> Needs attention</h4><ul>{current.issues.map(issue => <li key={issue}>{issue}</li>)}</ul><p>Add the missing facts to the source, then run again.</p></div> : <p className="catalog-ready"><CheckCircleIcon size={17} aria-hidden="true" /> Required fields are present. Review the draft before publishing.</p>}
          {!preview && <p className="catalog-confidence">Category score: {Math.round(current.probability * 100)}% of this label set. This is not an accuracy estimate. Scores below 75% go to review.</p>}
        </> : <div className="catalog-empty"><TagIcon size={24} aria-hidden="true" /><h4>{running ? 'Building this catalog…' : 'Your source is ready for a fresh run.'}</h4><p>Category, stated attributes and missing details will appear here. Previous results are cleared when a description changes.</p></div>}
      </section>
    </div>
    <div className="catalog-export"><p><strong>Take the draft with you.</strong><span> Originals, attributes and review notes. {preview ? 'Exports are labelled sample preview.' : 'No store connection or publishing.'}</span></p><div><button className="btn" disabled={!results || running} onClick={() => download('csv')}><DownloadSimpleIcon size={16} aria-hidden="true" /> Draft CSV</button><button className="btn" disabled={!results || running} onClick={() => download('json')}>Draft JSON</button></div></div>
    <details className="catalog-build"><summary>Workflow notes</summary><p>Two batch requests. Your application owns required-field checks, source matching and the review queue.</p><p><a href="#sdk-examples">See SDK and CLI examples</a></p></details>
  </div>;
}
