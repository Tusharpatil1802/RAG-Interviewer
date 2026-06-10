export const appConfig = {
  maxTurns: Number(process.env.MAX_TURNS || 5),
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
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
