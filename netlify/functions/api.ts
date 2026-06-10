import { appConfig } from './_lib/config.js';
import { HttpError } from './_lib/errors.js';
import { errorResponse, json, pathParts, readJson, text } from './_lib/http.js';
import { evaluateAnswer, generateQuestion, summarizeSession } from './_lib/llm.js';
import { ingestKnowledgeBase, buildQueries, retrieveContext } from './_lib/rag.js';
import { parseResume, extractTextFromUpload } from './_lib/resume.js';
import { buildSessionReport, reportFilename } from './_lib/report.js';
import { uploadResume, uploadReport } from './_lib/storage.js';
import { getSupabase } from './_lib/supabase.js';
import type { InterviewSessionRow, InterviewTurnRow, RetrievedContext, ResumeProfile } from './_lib/types.js';

async function getSession(sessionId: number): Promise<InterviewSessionRow> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('interview_sessions').select('*').eq('id', sessionId).single();
  if (error || !data) throw new HttpError(404, 'Session not found', error);
  return data as InterviewSessionRow;
}

async function getTurns(sessionId: number): Promise<InterviewTurnRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('interview_turns').select('*').eq('session_id', sessionId).order('id');
  if (error) throw new HttpError(500, 'Failed to load interview turns', error);
  return (data || []) as InterviewTurnRow[];
}

async function createTurn(sessionId: number, question: string, retrievedContext: RetrievedContext[]) {
  const supabase = getSupabase();
  const { error } = await supabase.from('interview_turns').insert({
    session_id: sessionId,
    question,
    retrieved_context: retrievedContext,
  });
  if (error) throw new HttpError(500, 'Failed to create interview turn', error);
}

async function startInterview(request: Request) {
  const form = await request.formData();
  const role = String(form.get('role') || '').trim();
  const resume = form.get('resume');
  if (!role) throw new HttpError(400, 'Role is required');
  if (!(resume instanceof File)) throw new HttpError(400, 'Resume upload is required');
  if (!/\.(pdf|txt)$/i.test(resume.name)) throw new HttpError(400, 'Upload a PDF or TXT resume');

  const bytes = new Uint8Array(await resume.arrayBuffer());
  const resumeText = await extractTextFromUpload(resume.name, bytes);
  if (resumeText.length < 50) throw new HttpError(400, 'Could not extract enough resume text');

  const profile = await parseResume(resumeText);
  const resumeObjectPath = await uploadResume(resume.name, bytes, resume.type || 'application/octet-stream');
  const supabase = getSupabase();

  const { data: sessionData, error: sessionError } = await supabase.from('interview_sessions').insert({
    role,
    candidate_name: profile.name || null,
    resume_object_path: resumeObjectPath,
    extracted_profile: profile,
  }).select('*').single();
  if (sessionError || !sessionData) throw new HttpError(500, 'Failed to create interview session', sessionError);

  const context = await retrieveContext(role, buildQueries(role, profile), 5).catch(() => []);
  const question = await generateQuestion(role, profile, context, [], 1);
  await createTurn(sessionData.id, question, context);

  return json({
    session_id: sessionData.id,
    profile,
    question,
    context_sources: context.map((item) => item.metadata),
    max_turns: appConfig.maxTurns,
    created_at: sessionData.created_at,
  });
}

async function submitAnswer(sessionId: number, request: Request) {
  const session = await getSession(sessionId);
  const turns = await getTurns(sessionId);
  const currentTurn = [...turns].reverse().find((turn) => !turn.answer);
  if (!currentTurn) throw new HttpError(400, 'No pending question');

  const body = await readJson<{ answer?: string }>(request);
  const answer = String(body.answer || '').trim();
  if (answer.length < 10) throw new HttpError(400, 'Answer is too short');

  const evaluation = await evaluateAnswer(currentTurn.question, answer, currentTurn.retrieved_context || []);
  const supabase = getSupabase();
  const { error: updateError } = await supabase.from('interview_turns').update({
    answer,
    evaluation,
  }).eq('id', currentTurn.id);
  if (updateError) throw new HttpError(500, 'Failed to save answer evaluation', updateError);

  const refreshedTurns = await getTurns(sessionId);
  const completedTurns = refreshedTurns.filter((turn) => turn.answer);
  let nextQuestion: string | null = null;
  let nextContext: RetrievedContext[] = [];

  if (completedTurns.length < appConfig.maxTurns) {
    nextContext = await retrieveContext(session.role, buildQueries(session.role, session.extracted_profile as ResumeProfile, answer), 5).catch(() => []);
    nextQuestion = await generateQuestion(
      session.role,
      session.extracted_profile as ResumeProfile,
      nextContext,
      refreshedTurns.map((turn) => turn.question),
      completedTurns.length + 1,
      answer,
    );
    await createTurn(sessionId, nextQuestion, nextContext);
  } else {
    const summary = await summarizeSession(session.role, session.extracted_profile as ResumeProfile, refreshedTurns.map((turn) => (
      turn.id === currentTurn.id ? { ...turn, answer, evaluation } : turn
    )));
    const { error: summaryError } = await supabase.from('interview_sessions').update({ summary }).eq('id', sessionId);
    if (summaryError) throw new HttpError(500, 'Failed to save interview summary', summaryError);
  }

  return json({
    evaluation,
    next_question: nextQuestion,
    context_sources: nextContext.map((item) => item.metadata),
    done: completedTurns.length >= appConfig.maxTurns,
    completed_turns: completedTurns.length,
    max_turns: appConfig.maxTurns,
  });
}

async function getSessionSummary(sessionId: number) {
  const session = await getSession(sessionId);
  const turns = await getTurns(sessionId);
  return json({
    session_id: session.id,
    role: session.role,
    profile: session.extracted_profile,
    created_at: session.created_at,
    completed_turns: turns.filter((turn) => turn.answer).length,
    max_turns: appConfig.maxTurns,
    turns: turns.map((turn) => ({
      question: turn.question,
      answer: turn.answer,
      evaluation: turn.evaluation,
      created_at: turn.created_at,
      context_sources: (turn.retrieved_context || []).map((item) => item.metadata),
    })),
    summary: session.summary,
  });
}

async function resetSession(sessionId: number) {
  const session = await getSession(sessionId);
  const supabase = getSupabase();
  const { error: deleteError } = await supabase.from('interview_turns').delete().eq('session_id', sessionId);
  if (deleteError) throw new HttpError(500, 'Failed to clear interview turns', deleteError);
  const { error: summaryError } = await supabase.from('interview_sessions').update({ summary: null }).eq('id', sessionId);
  if (summaryError) throw new HttpError(500, 'Failed to reset interview summary', summaryError);

  const context = await retrieveContext(session.role, buildQueries(session.role, session.extracted_profile as ResumeProfile), 5).catch(() => []);
  const question = await generateQuestion(session.role, session.extracted_profile as ResumeProfile, context, [], 1);
  await createTurn(sessionId, question, context);

  return json({
    session_id: sessionId,
    question,
    context_sources: context.map((item) => item.metadata),
    message: 'Interview reset with a fresh first question.',
  });
}

async function downloadReport(sessionId: number) {
  const session = await getSession(sessionId);
  const turns = await getTurns(sessionId);
  if (!turns.some((turn) => turn.answer)) {
    throw new HttpError(400, 'Complete at least one interview turn before downloading a report');
  }

  const pdfBytes = await buildSessionReport(session, turns, appConfig.maxTurns);
  const filename = reportFilename(session);
  const objectPath = await uploadReport(sessionId, filename, new Uint8Array(pdfBytes));
  const supabase = getSupabase();
  await supabase.from('interview_sessions').update({ report_object_path: objectPath }).eq('id', sessionId);

  return new Response(new Uint8Array(pdfBytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

export default async (request: Request) => {
  try {
    const [resource, maybeId, action] = pathParts(request);
    if (!resource) {
      return json({
        message: 'RoleRAG Netlify API is running',
        health: '/api/health',
      });
    }

    if (resource === 'health' && request.method === 'GET') {
      return json({ status: 'ok' });
    }

    if (resource === 'kb' && maybeId === 'ingest' && request.method === 'POST') {
      const role = new URL(request.url).searchParams.get('role') || undefined;
      return json(await ingestKnowledgeBase(role));
    }

    if (resource === 'interviews' && maybeId === 'start' && request.method === 'POST') {
      return startInterview(request);
    }

    if (resource === 'interviews' && maybeId) {
      const sessionId = Number(maybeId);
      if (!Number.isInteger(sessionId)) throw new HttpError(400, 'Session id must be numeric');

      if (!action && request.method === 'GET') {
        return getSessionSummary(sessionId);
      }
      if (action === 'answer' && request.method === 'POST') {
        return submitAnswer(sessionId, request);
      }
      if (action === 'reset' && request.method === 'POST') {
        return resetSession(sessionId);
      }
      if (action === 'report.pdf' && request.method === 'GET') {
        return downloadReport(sessionId);
      }
    }

    return text('Not Found', { status: 404 });
  } catch (error) {
    return errorResponse(error);
  }
};
