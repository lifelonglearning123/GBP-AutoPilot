import OpenAI from 'openai';

/**
 * OpenAI is the default (gpt-5.5). OpenRouter is used only if OPENROUTER_API_KEY is set and
 * OPENAI_API_KEY is not, so the same code can run on a cheaper model when needed.
 */
type Provider = { name: string; baseURL?: string; apiKey: string; model: string; extra?: Record<string, unknown> };

function resolve(): Provider | null {
  const oa = process.env.OPENAI_API_KEY?.trim();
  if (oa && !oa.startsWith('sk-...')) {
    return { name: 'openai', apiKey: oa, model: process.env.OPENAI_MODEL?.trim() || 'gpt-5.5' };
  }
  const or = process.env.OPENROUTER_API_KEY?.trim();
  if (or) {
    return {
      name: 'openrouter',
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: or,
      model: process.env.LLM_MODEL?.trim() || 'moonshotai/kimi-k2.6',
      // Kimi burns tens of thousands of hidden reasoning tokens per call unless told not to.
      extra: { provider: { sort: 'throughput' }, reasoning: { enabled: false } },
    };
  }
  return null;
}

export function hasLLM() { return resolve() !== null; }
export function llmInfo() { const p = resolve(); return p ? { provider: p.name, model: p.model } : { provider: null, model: null }; }

let cached: { key: string; client: OpenAI } | null = null;
function client(p: Provider): OpenAI {
  const key = `${p.baseURL ?? ''}|${p.apiKey}`;
  if (cached?.key !== key) cached = { key, client: new OpenAI({ apiKey: p.apiKey, baseURL: p.baseURL }) };
  return cached.client;
}

/** Ask for a JSON object and parse it. The system prompt should describe the shape. */
export async function json<T = any>(system: string, user: string): Promise<T> {
  const p = resolve();
  if (!p) throw new Error('No LLM configured. Set OPENAI_API_KEY in .env.local.');
  const res = await client(p).chat.completions.create({
    model: p.model,
    messages: [
      { role: 'system', content: system + '\n\nRespond with a single JSON object and nothing else.' },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
    ...(p.extra ?? {}),
  } as any);
  const raw = res.choices[0]?.message?.content ?? '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned) as T; }
  catch { throw new Error(`LLM returned non-JSON: ${cleaned.slice(0, 200)}`); }
}

export async function text(system: string, user: string): Promise<string> {
  const p = resolve();
  if (!p) throw new Error('No LLM configured. Set OPENAI_API_KEY in .env.local.');
  const res = await client(p).chat.completions.create({
    model: p.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    ...(p.extra ?? {}),
  } as any);
  return (res.choices[0]?.message?.content ?? '').trim();
}
