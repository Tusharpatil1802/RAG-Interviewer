import { appConfig } from './config.js';
import { HttpError } from './errors.js';
import { supabase } from './supabase.js';

export function safeObjectName(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'file';
}

export async function uploadBuffer(bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const { error } = await supabase.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) {
    throw new HttpError(500, `Failed to upload ${path}`, error);
  }
}

export async function downloadBuffer(bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) {
    throw new HttpError(500, `Failed to download ${path}`, error);
  }
  return new Uint8Array(await data.arrayBuffer());
}

export async function listFolder(bucket: string, path: string) {
  const { data, error } = await supabase.storage.from(bucket).list(path, {
    limit: 100,
    offset: 0,
  });
  if (error) {
    throw new HttpError(500, `Failed to list ${bucket}/${path}`, error);
  }
  return data || [];
}

export async function uploadResume(filename: string, bytes: Uint8Array, contentType: string) {
  const objectPath = `candidate-resumes/${Date.now()}-${safeObjectName(filename)}`;
  await uploadBuffer(appConfig.resumeBucket, objectPath, bytes, contentType);
  return objectPath;
}

export async function uploadReport(sessionId: number, filename: string, bytes: Uint8Array) {
  const objectPath = `reports/${sessionId}/${safeObjectName(filename)}`;
  await uploadBuffer(appConfig.reportBucket, objectPath, bytes, 'application/pdf');
  return objectPath;
}
