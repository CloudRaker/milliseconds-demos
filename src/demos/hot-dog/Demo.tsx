import { useEffect, useRef, useState } from 'react';
import { ImageSquareIcon, ScanIcon } from '@phosphor-icons/react';
import { trackDemoEvent } from '../../lib/demo-events';
import { dm1 } from '../../lib/dm1';
import { decodeImage, imageTokens } from '../../lib/image';
import { CREDITS } from './credits';
import { SAMPLES } from './samples';
import { agreement, classifyRequest, DETAIL, isHotDog, parseVerdict, type Sample, type Verdict } from './logic';
import './demo.css';

const TOKENS = imageTokens('classify', DETAIL);
const percent = (value: number) => `${Math.round(value * 100)}%`;

export default function Demo() {
  const [own, setOwn] = useState<Sample | null>(null);
  const [results, setResults] = useState(new Map<string, Verdict>());
  const [running, setRunning] = useState<string | null>(null);
  const [failed, setFailed] = useState(new Set<string>());
  const [status, setStatus] = useState('');
  const ctrl = useRef<AbortController | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const cards = own ? [own, ...SAMPLES] : SAMPLES;
  const scored = SAMPLES.filter(sample => results.has(sample.id)).length;

  useEffect(() => { trackDemoEvent('hot-dog', 'sample_viewed'); return () => ctrl.current?.abort(); }, []);

  function clear(message: string) {
    ctrl.current?.abort(); ctrl.current = null; setRunning(null); setResults(new Map()); setFailed(new Set()); setStatus(message);
  }
  async function pick(picked: File | undefined) {
    if (!picked) return;
    try {
      const decoded = await decodeImage(picked);
      ctrl.current?.abort(); ctrl.current = null; setRunning(null);
      setOwn({ id: 'your-photo', caption: 'Your photo', alt: `Uploaded photo, ${decoded.width} by ${decoded.height} pixels`, width: decoded.width, height: decoded.height, dataUrl: decoded.dataUrl });
      setResults(map => { const next = new Map(map); next.delete('your-photo'); return next; });
      setStatus('Photo ready · uses your API key.');
      trackDemoEvent('hot-dog', 'own_input_run');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'That photo could not be read.');
    }
  }
  /** One call per photo. dm1 keeps the page inside the free plan's rate limit. */
  async function run(queue: Sample[]) {
    if (ctrl.current) return;
    const controller = new AbortController(); ctrl.current = controller;
    setFailed(new Set()); setStatus(`Classifying ${queue.length === 1 ? 'one photo' : `${queue.length} photos`}…`);
    trackDemoEvent('hot-dog', 'run_started');
    let stopped = false;
    for (const sample of queue) {
      if (controller.signal.aborted || ctrl.current !== controller) return;
      setRunning(sample.id);
      try {
        const { data } = await dm1('classify', classifyRequest(sample.dataUrl), controller.signal);
        if (controller.signal.aborted || ctrl.current !== controller) return;
        const verdict = parseVerdict(data);
        setResults(map => new Map(map).set(sample.id, verdict));
      } catch (error) {
        if (controller.signal.aborted || ctrl.current !== controller) return;
        setFailed(set => new Set(set).add(sample.id));
        setStatus(error instanceof Error ? error.message : 'That photo could not be classified.');
        trackDemoEvent('hot-dog', 'run_failed');
        stopped = true;
        break;
      }
    }
    ctrl.current = null; setRunning(null);
    if (!stopped) {
      trackDemoEvent('hot-dog', 'run_completed');
      setStatus(`${queue.length === 1 ? 'One photo' : `${queue.length} photos`} classified.`);
    }
  }
  function stop() {
    trackDemoEvent('hot-dog', 'run_cancelled');
    ctrl.current?.abort(); ctrl.current = null; setRunning(null);
    setStatus('Stopped. Results kept.');
  }

  return <div className="hotdog-demo">
    <div className="hd-toolbar">
      <div>
        <span className="tag">14 stock photos</span>
      </div>
      <div className="hd-actions">
        <button className="btn" onClick={() => file.current?.click()}><ImageSquareIcon size={18} aria-hidden="true" />Use my image</button>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
        <button className="btn" onClick={() => { setOwn(null); clear('Grid reset.'); }} disabled={!own && !results.size && !running}>Reset</button>
        {running
          ? <button className="btn" onClick={stop}>Stop</button>
          : <button className="btn primary" onClick={() => void run(cards)}><ScanIcon size={18} aria-hidden="true" />Classify sample</button>}
      </div>
    </div>
    <p role="status" className="hd-status" hidden={!status}>{status}</p>
    <p className="hd-rule">
      {TOKENS.toLocaleString()} tokens / photo · $0.04 / 1,000 photos
      {scored > 0 && <> · {agreement(results, SAMPLES)}/{scored} match the captions</>}
    </p>
    <ul className="hd-grid">
      {cards.map(sample => {
        const verdict = results.get(sample.id);
        const hot = verdict ? isHotDog(verdict) : null;
        return <li key={sample.id} className={`hd-card${running === sample.id ? ' is-running' : ''}`}>
          <div className="hd-photo"><img src={sample.dataUrl} alt={sample.alt} width={sample.width} height={sample.height} loading="lazy" /></div>
          <div className="hd-verdict">
            {verdict
              ? <><span className={hot ? 'hd-badge is-hot' : 'hd-badge'}>{hot ? 'Hot dog' : 'Not hot dog'}</span><span className="hd-probability">{percent(verdict.scores['hot dog'])} hot dog</span></>
              : <span className="hd-badge is-idle">{running === sample.id ? 'Classifying…' : failed.has(sample.id) ? 'Failed' : 'Not classified'}</span>}
          </div>
          <p className="hd-caption">{sample.caption}{sample.edge && <span className="hd-edge" title="People disagree about this one too">debatable</span>}</p>
        </li>;
      })}
    </ul>
    <details className="panel"><summary>Workflow notes</summary>
      <p>One photo, two labels, <code>low</code> detail. A hot-dog probability of 50% or more means hot dog. Cost uses $0.04 per million input tokens.</p>
      <p>Captions are human labels. Corn dogs and bratwursts are debatable.</p>
      <p>Photos are processed in memory, never written to disk and never logged. Send one photo of at most 5 MB, as JPEG, PNG or WebP. Image URLs are not accepted.</p>
      <p><a href="#sdk-examples">See SDK and CLI examples</a></p>
    </details>
    <details className="panel hd-credits"><summary>Photo credits</summary>
      <ul>
        {CREDITS.map(credit => <li key={credit.id}>
          <a href={credit.page} target="_blank" rel="noopener noreferrer">{credit.title}</a> · {credit.author} · {credit.licenseUrl ? <a href={credit.licenseUrl} target="_blank" rel="noopener noreferrer">{credit.license}</a> : credit.license}
        </li>)}
      </ul>
      <p className="muted">Every photo comes from Wikimedia Commons, downscaled to a 512 px longest edge and re-encoded as JPEG.</p>
    </details>
  </div>;
}
