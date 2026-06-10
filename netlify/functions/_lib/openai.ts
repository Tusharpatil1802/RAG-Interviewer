import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import { appConfig } from './config.js';
import { HttpError } from './errors.js';

let cachedChatClient: OpenAI | null = null;
let cachedEmbeddingClient: OpenAI | null = null;

const HASH_EMBEDDING_DIMENSIONS = 1536;

function groqKey() {
  return appConfig.groqApiKey || (appConfig.openaiApiKey.startsWith('gsk_') ? appConfig.openaiApiKey : '');
}

function openAIKey() {
  return appConfig.openaiApiKey.startsWith('gsk_') ? '' : appConfig.openaiApiKey;
}

export function hasOpenAI() {
  return Boolean(openAIKey());
}

export function hasChatClient() {
  return Boolean(groqKey() || openAIKey());
}

export function chatModel() {
  return groqKey() ? appConfig.groqModel : appConfig.openaiModel;
}

export function getChatClient() {
  const groqApiKey = groqKey();
  if (groqApiKey) {
    if (!cachedChatClient) {
      cachedChatClient = new OpenAI({
        apiKey: groqApiKey,
        baseURL: 'https://api.groq.com/openai/v1',
      });
    }
    return cachedChatClient;
  }

  const apiKey = openAIKey();
  if (!apiKey) {
    throw new HttpError(503, 'GROQ_API_KEY or OPENAI_API_KEY is required for hosted LLM flows.');
  }
  if (!cachedChatClient) {
    cachedChatClient = new OpenAI({ apiKey });
  }
  return cachedChatClient;
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
  if (appConfig.embeddingProvider === 'hash') {
    return texts.map((text) => hashEmbedding(text));
  }

  const apiKey = openAIKey();
  if (!apiKey) {
    throw new HttpError(503, 'A real OpenAI API key is required when EMBEDDING_PROVIDER=openai.');
  }
  if (!cachedEmbeddingClient) {
    cachedEmbeddingClient = new OpenAI({ apiKey });
  }
  const client = cachedEmbeddingClient;
  const response = await client.embeddings.create({
    model: appConfig.embeddingModel,
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}

function hashEmbedding(text: string) {
  const vector = new Array<number>(HASH_EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9_#+.-]+/g) || [];

  for (const token of tokens) {
    const digest = createHash('sha256').update(token).digest();
    const index = digest.readUInt32BE(0) % HASH_EMBEDDING_DIMENSIONS;
    const sign = digest[4] % 2 === 0 ? 1 : -1;
    vector[index] += sign;
  }

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / magnitude);
}
