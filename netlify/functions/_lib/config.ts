export const appConfig = {
  maxTurns: Number(process.env.MAX_TURNS || 5),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
  embeddingProvider: process.env.EMBEDDING_PROVIDER || 'hash',
  embeddingModel: process.env.EMBEDDING_MODEL || 'hash-embedding-1536',
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  resumeBucket: process.env.SUPABASE_RESUME_BUCKET || 'resumes',
  reportBucket: process.env.SUPABASE_REPORT_BUCKET || 'reports',
  knowledgeBaseBucket: process.env.SUPABASE_KB_BUCKET || 'kb-docs',
};

export function assertConfigured(keys: string[]): void {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
