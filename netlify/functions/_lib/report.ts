import PDFDocument from 'pdfkit';
import type { InterviewSessionRow, InterviewTurnRow } from './types.js';

function text(value: unknown) {
  if (value == null) return '-';
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '-';
  return String(value).trim() || '-';
}

function averageScore(turns: InterviewTurnRow[]) {
  const scores = turns
    .map((turn) => Number(turn.evaluation?.score))
    .filter((score) => Number.isFinite(score));
  if (!scores.length) return '-';
  return `${(scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1)} / 10`;
}

export function reportFilename(session: InterviewSessionRow) {
  const raw = session.candidate_name || session.extracted_profile?.name || `session-${session.id}`;
  const slug = raw.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || `session-${session.id}`;
  return `${slug}-interview-report.pdf`;
}

export async function buildSessionReport(session: InterviewSessionRow, turns: InterviewTurnRow[], maxTurns: number) {
  const completedTurns = turns.filter((turn) => turn.answer);
  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ margin: 48, size: 'A4' });

  doc.on('data', (chunk: Buffer | Uint8Array) => chunks.push(Buffer.from(chunk)));
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(22).text('RoleRAG Interview Report', { underline: false });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Candidate-focused interview summary for the role ${session.role}.`);
  doc.moveDown();

  doc.fontSize(13).text('Session Metadata');
  doc.fontSize(10)
    .text(`Candidate: ${text(session.extracted_profile?.name || session.candidate_name)}`)
    .text(`Role: ${text(session.role)}`)
    .text(`Created: ${text(session.created_at)}`)
    .text(`Completed Turns: ${completedTurns.length} / ${maxTurns}`)
    .text(`Average Score: ${averageScore(completedTurns)}`);
  doc.moveDown();

  doc.fontSize(13).text('Extracted Candidate Profile');
  doc.fontSize(10)
    .text(`Skills: ${text(session.extracted_profile?.skills)}`)
    .text(`Experience: ${text(session.extracted_profile?.years_experience || session.extracted_profile?.seniority_signal)}`)
    .text(`Projects: ${text(session.extracted_profile?.projects)}`)
    .text(`Summary: ${text(session.extracted_profile?.summary)}`);
  doc.moveDown();

  doc.fontSize(13).text('Final Interview Summary');
  doc.fontSize(10).text(text(session.summary));
  doc.moveDown();

  doc.fontSize(13).text('Turn-by-Turn Results');
  for (const [index, turn] of completedTurns.entries()) {
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Turn ${index + 1}`);
    doc.fontSize(10)
      .text(`Question: ${text(turn.question)}`)
      .text(`Answer: ${text(turn.answer)}`)
      .text(`Score: ${text(turn.evaluation?.score)}`)
      .text(`Strengths: ${text(turn.evaluation?.strengths)}`)
      .text(`Gaps: ${text(turn.evaluation?.gaps)}`)
      .text(`Suggested Follow-up: ${text(turn.evaluation?.follow_up)}`)
      .text(`Grounding Sources: ${text(turn.retrieved_context.map((item) => item.metadata.source))}`);
  }

  doc.end();
  return done;
}
