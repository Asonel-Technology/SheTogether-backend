import OpenAI from 'openai';
import { env } from '../config/env.js';
import { ApiError, unavailable } from '../utils/errors.js';

export const EMBEDDING_DIMENSIONS = 1536; // must match vector(1536) in the schema
let client;

/** OpenAI is only ever called from the backend; the key never reaches the browser. */
export function openai() {
  if (!env.OPENAI_API_KEY) throw unavailable('AI provider is not configured', 'AI_NOT_CONFIGURED');
  client ??= new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 25_000, maxRetries: 2 });
  return client;
}

export async function embed(texts) {
  const out = [];
  try {
    for (let i = 0; i < texts.length; i += 64) {
      const res = await openai().embeddings.create({ model: env.OPENAI_EMBEDDING_MODEL, input: texts.slice(i, i + 64), dimensions: EMBEDDING_DIMENSIONS });
      out.push(...res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw unavailable('Embedding service is temporarily unavailable', 'AI_UNAVAILABLE');
  }
  return out;
}

export const vectorLiteral = (v) => `[${v.join(',')}]`;
