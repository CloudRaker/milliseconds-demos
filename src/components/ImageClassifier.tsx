import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ImageSquareIcon, ScanIcon } from '@phosphor-icons/react';
import { dm1, getForceLive, getServerForceLive, subscribeLiveMode } from '../lib/dm1';
import { decodeImage } from '../lib/image';
import { trackDemoEvent } from '../lib/demo-events';
import { imageClassifyRequest, parseImageVerdict, type ImageDemoConfig, type ImageSample, type ImageVerdict } from '../lib/image-demo';
import './image-classifier.css';

type Photo = Omit<ImageSample, 'expected' | 'sourceUrl'> & Partial<Pick<ImageSample, 'expected' | 'sourceUrl'>>;
const percent = (value: number) => `${Math.round(value * 100)}%`;

export default function ImageClassifier({ config }: { config: ImageDemoConfig }) {
  const forceLive = useSyncExternalStore(subscribeLiveMode, getForceLive, getServerForceLive);
  const [own, setOwn] = useState<Photo | null>(null);
  const [selectedId, setSelectedId] = useState(config.samples[0]?.id);
  const [results, setResults] = useState(new Map<string, ImageVerdict>());
  const [running, setRunning] = useState<string | null>(null);
  const [status, setStatus] = useState('Choose a photo, then classify it. Supplied examples are free to try.');
  const [error, setError] = useState(false);
  const [reading, setReading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const uploadRevision = useRef(0);
  const file = useRef<HTMLInputElement | null>(null);
  const photos: Photo[] = own ? [own, ...config.samples] : config.samples;
  const selected = photos.find(photo => photo.id === selectedId) ?? photos[0];
  const verdict = selected && results.get(selected.id);
  const scored = config.samples.filter(photo => results.has(photo.id));
  const matched = scored.filter(photo => results.get(photo.id)?.label === photo.expected).length;

  useEffect(() => {
    trackDemoEvent(config.slug, 'sample_viewed');
    return () => { controller.current?.abort(); uploadRevision.current++; };
  }, [config.slug]);

  function cancel() {
    controller.current?.abort(); controller.current = null; setRunning(null);
  }
  function reset() {
    cancel(); uploadRevision.current++; setReading(false); setOwn(null); setResults(new Map());
    setSelectedId(config.samples[0]?.id); setError(false);
    setStatus('Sample set restored. Supplied examples are free to try.');
  }
  async function pick(picked: File | undefined) {
    if (!picked) return;
    cancel();
    const revision = ++uploadRevision.current;
    setReading(true); setError(false); setStatus('Reading your photo…');
    try {
      const decoded = await decodeImage(picked);
      if (uploadRevision.current !== revision) return;
      setOwn({ id: 'your-photo', caption: 'Your photo', alt: `Your uploaded photo, ${decoded.width} by ${decoded.height} pixels`, ...decoded });
      setSelectedId('your-photo');
      setResults(previous => { const next = new Map(previous); next.delete('your-photo'); return next; });
      setStatus('Your photo is ready. Classifying it uses your API key.');
    } catch (cause) {
      if (uploadRevision.current !== revision) return;
      setError(true); setStatus(cause instanceof Error ? cause.message : 'That photo could not be read.');
    } finally {
      if (uploadRevision.current === revision) setReading(false);
    }
  }
  async function run(queue: Photo[]) {
    if (controller.current || reading || !queue.length) return;
    const current = new AbortController(); controller.current = current;
    setError(false); trackDemoEvent(config.slug, 'run_started');
    if (queue.some(photo => photo.id === 'your-photo')) trackDemoEvent(config.slug, 'own_input_run');
    for (const [index, photo] of queue.entries()) {
      if (current.signal.aborted || controller.current !== current) return;
      setRunning(photo.id); setStatus(`Classifying photo ${index + 1} of ${queue.length}…`);
      try {
        const { data } = await dm1('classify', imageClassifyRequest(config, photo.dataUrl), current.signal);
        if (current.signal.aborted || controller.current !== current) return;
        const result = parseImageVerdict(data, config.labels);
        setResults(previous => new Map(previous).set(photo.id, result));
      } catch (cause) {
        if (current.signal.aborted || controller.current !== current) return;
        controller.current = null; setRunning(null); setError(true);
        setStatus(cause instanceof Error ? cause.message : 'That photo could not be classified.');
        trackDemoEvent(config.slug, 'run_failed'); return;
      }
    }
    controller.current = null; setRunning(null);
    setStatus(`${queue.length} photo${queue.length === 1 ? '' : 's'} classified. Select any photo to inspect its label scores.`);
    trackDemoEvent(config.slug, 'run_completed');
  }

  if (!selected) return <p>No sample photos are available.</p>;
  return <div className="image-classifier">
    <div className="ic-toolbar">
      <div><span className="tag">{config.samples.length} real images · {Object.keys(config.labels).length} labels</span><p>{config.intro}</p></div>
      <div className="ic-actions">
        <button className="btn" onClick={() => file.current?.click()}><ImageSquareIcon size={18} aria-hidden="true" />Use my image</button>
        <input ref={file} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" tabIndex={-1} aria-hidden="true" onChange={event => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
        <button className="btn" onClick={reset} disabled={!own && !results.size && !running && !reading && !error}>Reset</button>
        {running ? <button className="btn" onClick={() => { cancel(); setStatus('Stopped. Completed results are kept.'); trackDemoEvent(config.slug, 'run_cancelled'); }}>Stop</button>
          : <button className="btn" disabled={reading} onClick={() => void run(config.samples)}>Classify sample set</button>}
      </div>
    </div>
    <p className={`ic-status${error ? ' is-error' : ''}`} role="status">{status}</p>
    <div className="ic-workbench">
      <figure className="ic-preview">
        <div className="ic-image"><img src={selected.dataUrl} width={selected.width} height={selected.height} alt={selected.alt} /></div>
        <figcaption><span>{selected.caption}</span>{selected.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer">Image source ↗</a>}</figcaption>
      </figure>
      <section className="ic-inspector" aria-label="Selected image classification">
        <div className="ic-annotation"><span className="ic-eyebrow">Dataset annotation</span><strong>{selected.expected ?? 'Your image · no reference label'}</strong><p>{selected.expected ? 'The source label, supplied with the dataset.' : 'Compare the result with what you can see.'}</p></div>
        <div className="ic-result" aria-busy={running === selected.id}>
          <span className="ic-eyebrow">Model result</span>
          {verdict ? <><h2>{verdict.label}</h2><p className="ic-probability">{percent(verdict.probability)} label probability{running === selected.id ? ' · previous result' : ''}</p>
            <ul className="ic-scores">{Object.entries(verdict.scores).sort((a, b) => b[1] - a[1]).map(([label, score]) => <li key={label}><div><span>{label}</span><span>{percent(score)}</span></div><meter min={0} max={1} value={score} aria-label={`${label} probability`} /></li>)}</ul>
          </> : <><h2>{running === selected.id ? 'Reading the image…' : 'What does the model see?'}</h2><p>Run the classifier to see its decision and the probability of each label.</p></>}
        </div>
        <button className="btn primary" disabled={!!running || reading} onClick={() => void run([selected])}><ScanIcon size={18} aria-hidden="true" />{running === selected.id ? 'Classifying…' : 'Classify this image'}</button>
        <p className="ic-key-note">{forceLive || selected.id === 'your-photo' ? 'Your API key · live inference · uses your quota' : 'Free supplied example · no key needed'}</p>
      </section>
    </div>
    <div className="ic-gallery-heading"><h2>Explore the sample set</h2><span>{scored.length ? `${matched} of ${scored.length} results match the dataset label` : 'Select an image to inspect it'}</span></div>
    <ul className="ic-gallery">{photos.map(photo => {
      const result = results.get(photo.id);
      return <li key={photo.id}><button className="ic-tile" aria-pressed={selected.id === photo.id} onClick={() => setSelectedId(photo.id)}>
        <img src={photo.dataUrl} width={photo.width} height={photo.height} alt={photo.alt} loading="lazy" />
        <span className="ic-tile-caption">{photo.caption}</span>
        <span className={`ic-tile-state${result ? ' has-result' : ''}`}><i aria-hidden="true" />{running === photo.id ? 'Classifying…' : result ? `Model: ${result.label}` : 'Not classified'}</span>
      </button></li>;
    })}</ul>
    <div className="ic-context"><section><h2>Where this helps</h2><p>{config.useCase}</p></section><section><h2>Know the limits</h2><p>{config.limitation}</p><p>This small sample illustrates the workflow; label agreement is not a benchmark.</p></section></div>
    <details className="panel ic-details"><summary>Dataset, image credits & request details</summary>
      <p><a href={config.dataset.url} target="_blank" rel="noopener noreferrer">{config.dataset.name}</a> · {config.dataset.author} · <a href={config.dataset.licenseUrl} target="_blank" rel="noopener noreferrer">{config.dataset.license}</a></p>
      <p>{config.dataset.note}</p>
      <p>One image and {Object.keys(config.labels).length} label descriptions per <code>classify</code> request, at <code>{config.detail}</code> detail. Captions and dataset annotations are never sent as input text.</p>
      <p>Your upload must be a JPEG, PNG or WebP of at most 5 MB. It is decoded in your browser before you choose to classify it.</p>
      <ul>{Object.entries(config.labels).map(([label, description]) => <li key={label}><strong>{label}:</strong> {description}</li>)}</ul>
      <p><a href="#sdk-examples">See SDK and CLI examples</a></p>
    </details>
  </div>;
}
