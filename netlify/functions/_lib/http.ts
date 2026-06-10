import { HttpError } from './errors.js';

export function json(data: unknown, init: ResponseInit = {}) {
  return Response.json(data, init);
}

export function text(body: string, init: ResponseInit = {}) {
  return new Response(body, init);
}

export function pathParts(request: Request) {
  const pathname = new URL(request.url).pathname;
  const normalized = pathname
    .replace(/^\/\.netlify\/functions\/api\/?/, '')
    .replace(/^\/api\/?/, '')
    .replace(/^\/+|\/+$/g, '');
  return normalized ? normalized.split('/') : [];
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch (error) {
    throw new HttpError(400, 'Request body must be valid JSON', error);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof HttpError) {
    return json({ detail: error.message, errors: error.details ?? null }, { status: error.status });
  }
  const detail = error instanceof Error ? error.message : 'Unexpected server error';
  return json({ detail }, { status: 500 });
}
