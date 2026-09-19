import registry from '../generated/examples.json';
import type { StockExample, ExampleRoute } from './example-contract';

export const SDK_LANGUAGES = [
  { id: 'typescript', label: 'TypeScript', syntax: 'typescript', install: 'npm install @cloudraker/milliseconds', docs: 'https://docs.milliseconds.ai/sdks/typescript' },
  { id: 'python', label: 'Python', syntax: 'python', install: 'pip install cloudraker-milliseconds', docs: 'https://docs.milliseconds.ai/sdks/python' },
  { id: 'cli', label: 'dm1 CLI', syntax: 'bash', install: 'npm install -g @cloudraker/milliseconds', docs: 'https://docs.milliseconds.ai/sdks/dm1' },
] as const;

const methods: Record<ExampleRoute, [string, string, string[]]> = {
  classify: ['classify', 'classify', ['labels']],
  'classify-tree': ['classifyTree', 'classify_tree', ['tree']],
  'yes-no': ['yesNo', 'yes_no', ['statements']],
  rate: ['rate', 'rate', ['scale']],
  answer: ['answer', 'answer', ['questions']],
  extract: ['extract', 'extract', ['schema']],
  entities: ['entities', 'entities', ['types']],
  verify: ['verify', 'verify', ['field', 'value']],
};
const json = (value: unknown) => JSON.stringify(value, null, 2);
function python(value: unknown, level = 0): string {
  if (value === null) return 'None';
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value !== 'object') return JSON.stringify(value);
  const array = Array.isArray(value);
  const entries = array ? value.map(v => python(v, level + 1)) : Object.entries(value as Record<string, unknown>).map(([k, v]) => `${JSON.stringify(k)}: ${python(v, level + 1)}`);
  return (array ? '[' : '{') + (entries.length ? '\n' + entries.map(v => '  '.repeat(level + 1) + v).join(',\n') + '\n' + '  '.repeat(level) : '') + (array ? ']' : '}');
}

/** Build-only samples: exact stock inputs, public SDK methods, no browser demo imports or credentials. */
export function sdkCode(example: Pick<StockExample, 'route' | 'body'>) {
  const { route, body } = example;
  const [tsMethod, pyMethod, fields] = methods[route];
  const input = body.text ?? body.texts;
  const args = [input, ...fields.map(field => body[field] ?? body[field.slice(0, -1)])];
  if (args.some(arg => arg === undefined)) throw new Error(`Incomplete SDK example: ${route}`);
  const hints = Object.fromEntries(['when_true', 'when_false'].filter(k => body[k] !== undefined).map(k => [k, body[k]]));
  const tsArgs = [...args.map(json), ...(Object.keys(hints).length ? [json(hints)] : [])];
  const pyArgs = [...args.map(arg => python(arg)), ...Object.entries(hints).map(([k, v]) => `${k}=${python(v)}`)];
  return {
    typescript: `import { DecisionMachine } from "@cloudraker/milliseconds";\n\n// Run on your server; reads MS_API_KEY from the environment.\nconst dm = new DecisionMachine();\n\nconst { result, usage } = await dm.${tsMethod}(\n${tsArgs.map(arg => arg.split('\n').map(line => '  ' + line).join('\n')).join(',\n')}\n).withUsage();\n\nconsole.log(result);\nconsole.log({ inputTokens: usage.inputTokens, modelMs: usage.inferenceMs });`,
    python: `from milliseconds import DecisionMachine\n\n# Reads MS_API_KEY from the environment.\ndm = DecisionMachine()\n\nresult = dm.${pyMethod}(\n${pyArgs.map(arg => arg.split('\n').map(line => '    ' + line).join('\n')).join(',\n')}\n)\n\nprint(result)`,
    cli: `# Reads MS_API_KEY. JSON on stdin supplies the complete request.\ndm1 ${route} --json --usage <<'DM1_REQUEST'\n${json(body)}\nDM1_REQUEST`,
  };
}

export function samplesForDemo(slug: string, routes: string[]) {
  const entries = Object.values(registry) as StockExample[];
  return routes.map(route => {
    const entry = entries.find(e => e.demo === slug && e.route === route);
    if (!entry) throw new Error(`Missing SDK sample: ${slug}/${route}`);
    return { route, code: sdkCode(entry) };
  });
}
