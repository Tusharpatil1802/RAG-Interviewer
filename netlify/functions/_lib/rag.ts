import { appConfig } from './config.js';
import { HttpError } from './errors.js';
import { embedTexts } from './openai.js';
import { extractTextFromUpload } from './resume.js';
import { listFolder, downloadBuffer } from './storage.js';
import { supabase } from './supabase.js';
import type { ResumeProfile, RetrievedContext } from './types.js';

export const ROLE_DIRECTORIES: Record<string, string> = {
  'AI/ML Engineer': 'AI_ML_Engineer',
  'Backend Engineer': 'Backend_Engineer',
  'Data Science / Applied ML': 'Data_Science_Applied_ML',
};

const ROLE_COLLECTIONS: Record<string, string> = {
  'AI/ML Engineer': 'modeling, data pipelines, evaluation, experimentation, and deployment',
  'Backend Engineer': 'apis, databases, reliability, debugging, and service design',
  'Data Science / Applied ML': 'analysis, experimentation, feature engineering, and model delivery',
};

export function roleDirectoryName(role: string) {
  return ROLE_DIRECTORIES[role] || role.replace(/\//g, '_').trim();
}

function chunkText(text: string, chunkSize = 950, overlap = 160) {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length);
    const chunk = words.slice(start, end).join(' ');
    if (chunk.length > 120) chunks.push(chunk);
    if (end === words.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

export async function ingestKnowledgeBase(role?: string) {
  const roles = role ? [role] : Object.keys(ROLE_DIRECTORIES);
  let total = 0;
  const scannedRoles: string[] = [];

  for (const roleName of roles) {
    const directory = roleDirectoryName(roleName);
    const files = await listFolder(appConfig.knowledgeBaseBucket, directory);
    if (!files.length) continue;
    scannedRoles.push(roleName);

    for (const file of files) {
      if (!/\.(pdf|txt|md)$/i.test(file.name)) continue;
      const storagePath = `${directory}/${file.name}`;
      const bytes = await downloadBuffer(appConfig.knowledgeBaseBucket, storagePath);
      const text = await extractTextFromUpload(file.name, bytes);
      const chunks = chunkText(text);
      if (!chunks.length) continue;
      const embeddings = await embedTexts(chunks);

      const { error: deleteError } = await supabase.from('kb_chunks').delete().eq('role', roleName).eq('source', file.name);
      if (deleteError) {
        throw new HttpError(500, `Failed to clear old chunks for ${file.name}`, deleteError);
      }

      const rows = chunks.map((content, index) => ({
        role: roleName,
        source: file.name,
        storage_path: storagePath,
        chunk_index: index,
        content,
        metadata: {
          source: file.name,
          role: roleName,
          chunk: index,
        },
        embedding: embeddings[index],
      }));

      const { error: insertError } = await supabase.from('kb_chunks').insert(rows);
      if (insertError) {
        throw new HttpError(500, `Failed to store chunks for ${file.name}`, insertError);
      }
      total += rows.length;
    }
  }

  return { chunks_ingested: total, roles_scanned: scannedRoles };
}

export function buildQueries(role: string, resumeProfile: ResumeProfile, lastAnswer?: string) {
  const skills = resumeProfile.skills || [];
  const projects = resumeProfile.projects || [];
  const experience = resumeProfile.years_experience || resumeProfile.seniority_signal || 'entry-level';
  const domains = resumeProfile.domains || [];
  const roleTopic = ROLE_COLLECTIONS[role] || 'practical role-specific engineering concepts';

  const queries: string[] = [];
  if (skills.length) {
    queries.push(`${role} interview concepts for ${skills.slice(0, 5).join(', ')}`);
    queries.push(`practical debugging and design scenarios using ${skills.slice(0, 4).join(', ')}`);
  }
  if (projects.length) {
    queries.push(`${role} concepts related to candidate project: ${projects[0]}`);
  }
  if (domains.length) {
    queries.push(`${role} interview topics covering ${domains.slice(0, 3).join(', ')}`);
  }
  queries.push(`${role} ${experience} interview topics covering ${roleTopic}`);
  if (lastAnswer) {
    queries.push(`follow up question based on candidate answer: ${lastAnswer.slice(0, 300)}`);
  }
  return queries;
}

export async function retrieveContext(role: string, queries: string[], count = 4): Promise<RetrievedContext[]> {
  if (!queries.length) return [];
  const embeddings = await embedTexts(queries);
  const results: RetrievedContext[] = [];

  for (let index = 0; index < queries.length; index += 1) {
    const { data, error } = await supabase.rpc('match_kb_chunks', {
      filter_role: role,
      query_embedding: embeddings[index],
      match_count: count,
    });
    if (error) {
      throw new HttpError(500, 'Failed to retrieve knowledge base context', error);
    }
    for (const row of data || []) {
      results.push({
        text: row.content.slice(0, 1200),
        metadata: row.metadata || { source: row.source, chunk: row.chunk_index, role: row.role },
        similarity: row.similarity,
        query: queries[index],
      });
    }
  }

  const deduped: RetrievedContext[] = [];
  const seen = new Set<string>();
  for (const item of results) {
    const key = `${item.metadata.source ?? 'source'}:${item.metadata.chunk ?? 'chunk'}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
    if (deduped.length >= count) break;
  }
  return deduped;
}
