import OpenAI from 'openai';
import { appConfig } from './config.js';
import { HttpError } from './errors.js';

let cachedClient: OpenAI | null = null;

export function hasOpenAI() {
  return Boolean(appConfig.openaiApiKey);
}

export function getOpenAIClient() {
  if (!appConfig.openaiApiKey) {
    throw new HttpError(503, 'OPENAI_API_KEY is required for hosted embeddings and advanced LLM flows.');
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: appConfig.openaiApiKey });
  }
  return cachedClient;
}

export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

export async function embedTexts(texts: string[]) {
  if (!texts.length) return [] as number[][];
  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: appConfig.embeddingModel,
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}
