import { useEffect, useRef, useState } from 'react';
import { ImageSquareIcon, ScanIcon } from '@phosphor-icons/react';
import { trackDemoEvent } from '../../lib/demo-events';
import { dm1 } from '../../lib/dm1';
import { DETAIL_EDGE, decodeImage, imageTokens, type Detail } from '../../lib/image';
import { RECEIPT } from './receipt';
import { extractionRequest, parseReceipt, rect, type Row, type Size } from './logic';
import './demo.css';

const STOCK: Size = { width: RECEIPT.width, height: RECEIPT.height };

export default function Demo() {
  const [image, setImage] = useState(RECEIPT.dataUrl);
  const [size, setSize] = useState<Size>(STOCK);
  const [alt, setAlt] = useState(RECEIPT.alt);
  const [detail, setDetail] = useState<Detail>('medium');
  const [rows, setRows] = useState<Row[]>([]);
  const [raw, setRaw] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Extract the stock receipt for free, or supply your own image with your key.');
  const ctrl = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const own = image !== RECEIPT.dataUrl;

  useEffect(() => { trackDemoEvent('receipt-boxes', 'sample_viewed'); return () => ctrl.current?.abort(); }, []);

  function clear(message: string) {
    ctrl.current?.abort(); ctrl.current = null; setRunning(false); setRows([]); setRaw(null); setSelected(null); setStatus(message);
  }
  async function pick(file: File | undefined) {
    if (!file) return;
    try {
      const decoded = await decodeImage(file);
      clear('Image ready. Extracting your own image uses your API key.');
      setImage(decoded.dataUrl); setSize({ width: decoded.width, height: decoded.height });
      setAlt(`Uploaded image, ${decoded.width} by ${decoded.height} pixels`);
      trackDemoEvent('receipt-boxes', 'own_input_run');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That image could not be read.');
    }
  }
  function reset() {
    clear('Stock receipt restored. Extracting it at medium detail is free.');
    setImage(RECEIPT.dataUrl); setSize(STOCK); setAlt(RECEIPT.alt); setDetail('medium');
  }
  async function run() {
    if (ctrl.current) return;
    const controller = new AbortController(); ctrl.current = controller; setRunning(true);
    setRows([]); setRaw(null); setSelected(null); setStatus('Reading the image…');
    trackDemoEvent('receipt-boxes', 'run_started');
    try {
      const { data } = await dm1('extract', extractionRequest(image, detail), controller.signal);
      if (controller.signal.aborted || ctrl.current !== controller) return;
      const parsed = parseReceipt(data, size);
      setRows(parsed.rows); setRaw(data);
      setStatus(`${parsed.rows.length} values read, ${parsed.boxed} with a box. Check every value against the image before you use it.`);
      trackDemoEvent('receipt-boxes', 'run_completed');
    } catch (error) {
      if (controller.signal.aborted || ctrl.current !== controller) return;
      trackDemoEvent('receipt-boxes', 'run_failed');
      setStatus(error instanceof Error ? error.message : 'The extraction failed. Try again.');
    } finally { if (ctrl.current === controller) { ctrl.current = null; setRunning(false); } }
  }
  function stop() {
    trackDemoEvent('receipt-boxes', 'run_cancelled');
    clear('Stopped. Nothing was extracted from this image.');
  }

  const boxes = rows.filter(row => row.box);
  return <div className="receipt-demo">
    <div className="rb-toolbar">
      <div><span className="tag">{own ? 'Your image' : 'Stock receipt'}</span><p>One image, one extract call. Every value carries the box it was read from.</p></div>
      <div className="rb-actions">
        <label htmlFor="rb-detail">Detail
          <select id="rb-detail" className="input" value={detail} onChange={event => { setDetail(event.target.value as Detail); clear('Detail changed. Extract again to see the new result.'); }}>
            {(Object.keys(DETAIL_EDGE) as Detail[]).map(level => <option key={level} value={level}>{level} · {DETAIL_EDGE[level]} px · {imageTokens('extract', level).toLocaleString()} tokens</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => file.current?.click()}><ImageSquareIcon size={18} aria-hidden="true" />Use my image</button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
        <button className="btn" onClick={reset} disabled={!own && detail === 'medium' && !rows.length}>Reset sample</button>
        {running
          ? <button className="btn" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={() => void run()}><ScanIcon size={18} aria-hidden="true" />Extract receipt</button>}
      </div>
    </div>
    <p role="status" className="rb-status">{status}</p>
    <div className="rb-workbench">
      <section className="panel" aria-labelledby="rb-image-heading">
        <div className="rb-section-head"><h2 id="rb-image-heading">Image</h2><span className="muted">{size.width} × {size.height} px · {own ? 'your file' : 'fictional receipt'}</span></div>
        <div className="rb-image">
          <img src={image} alt={alt} />
          {boxes.map(row => <span key={row.path} className={`rb-box ${selected === row.path ? 'is-selected' : ''}`} style={rect(row.box!, size)} />)}
        </div>
        <p className="rb-footnote">Boxes are the model’s own coordinates in this image’s pixels. They locate a reading; they do not prove it is correct.</p>
      </section>
      <section className="panel" aria-labelledby="rb-record-heading">
        <div className="rb-section-head"><h2 id="rb-record-heading">Extracted record</h2><span className="muted">{rows.length ? `${boxes.length}/${rows.length} boxed` : 'Not extracted'}</span></div>
        {rows.length === 0
          ? <p className="muted">Extract the receipt to fill this record. The stock receipt at medium detail runs free; your own image and the other detail tiers use your key.</p>
          : <div className="rb-rows">{rows.map(row => <button className="rb-row" key={row.path} aria-pressed={selected === row.path} onClick={() => { setSelected(current => current === row.path ? null : row.path); trackDemoEvent('receipt-boxes', 'evidence_opened'); }}>
              <b>{row.label}</b>
              <span className="rb-value">{row.value || '—'}</span>
              <small>{row.box ? row.box.join(', ') : 'no box'}</small>
            </button>)}</div>}
        {raw != null && <details className="rb-raw"><summary>API response</summary><pre>{JSON.stringify(raw, null, 2)}</pre></details>}
      </section>
    </div>
    <details className="panel"><summary>Workflow notes</summary>
      <p>One <code>extract</code> call sends the image and a JSON Schema. The response holds <code>data</code> and <code>boxes</code>, a map from each dotted field path to <code>[x1, y1, x2, y2]</code> in the uploaded image’s pixels. Line items use paths such as <code>items[2].price</code>. A field the model did not locate has no entry.</p>
      <p>Detail selects the longest edge the model reads: {Object.entries(DETAIL_EDGE).map(([level, edge]) => `${level} ${edge} px`).join(', ')}. Billed input tokens per image on extract are {(Object.keys(DETAIL_EDGE) as Detail[]).map(level => `${level} ${imageTokens('extract', level).toLocaleString()}`).join(', ')} (provisional), plus the text of the request. The base64 is never counted as characters.</p>
      <p>Images are processed in memory, never written to disk and never logged. Send one image of at most 5 MB, as JPEG, PNG or WebP. Image URLs are not accepted.</p>
      <p><a href="#sdk-examples">See SDK and CLI examples</a></p>
    </details>
  </div>;
}
