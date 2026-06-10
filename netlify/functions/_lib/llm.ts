import { appConfig } from './config.js';
import { chatModel, getChatClient, hasChatClient, safeJsonParse } from './openai.js';
import type { EvaluationResult, RetrievedContext, ResumeProfile, InterviewTurnRow } from './types.js';

function experienceLabel(profile: ResumeProfile) {
  if (profile.years_experience) return `${profile.years_experience} years of experience`;
  if (profile.seniority_signal && profile.seniority_signal !== 'unknown') return profile.seniority_signal;
  return 'Fresher / Entry-level';
}

function contextSnippets(context: RetrievedContext[]) {
  if (!context.length) return 'No retrieved knowledge base context was available.';
  return context.slice(0, 3).map((item) => {
    const source = String(item.metadata.source || 'knowledge base');
    return `Source: ${source}\n${String(item.text || '').replace(/\s+/g, ' ').slice(0, 420)}`;
  }).join('\n\n');
}

function fallbackQuestion(
  role: string,
  profile: ResumeProfile,
  previousQuestions: string[],
  turnNumber: number,
  lastAnswer: string | undefined,
  context: RetrievedContext[],
) {
  const skills = profile.skills || [];
  const projects = profile.projects || [];
  const skill = skills[Math.min(turnNumber - 1, Math.max(skills.length - 1, 0))] || 'machine learning';
  const project = projects[Math.min(turnNumber - 1, Math.max(projects.length - 1, 0))] || 'one of your projects';
  const source = context[0]?.metadata?.source ? ` The current context came from ${String(context[0].metadata.source)}.` : '';
  const candidates = [
    `In your ${project}, what was the hardest technical decision you made while using ${skill}, and how did it affect quality or reliability?`,
    `Suppose a feature built with ${skill} works in development but becomes unreliable in production. How would you debug it step by step?`,
    `What signals, tests, or monitoring would you add to catch failures early in a system that depends on ${skill}?${source}`,
  ];
  const used = new Set(previousQuestions.map((question) => question.trim().toLowerCase()));
  return candidates.find((candidate) => !used.has(candidate.trim().toLowerCase()))
    || `Let us go deeper on ${lastAnswer ? 'your last answer' : skill}. Describe one failure mode you would expect and how you would fix it.`;
}

export async function generateQuestion(
  role: string,
  profile: ResumeProfile,
  context: RetrievedContext[],
  previousQuestions: string[],
  turnNumber: number,
  lastAnswer?: string,
) {
  if (!hasChatClient()) {
    return fallbackQuestion(role, profile, previousQuestions, turnNumber, lastAnswer, context);
  }

  const client = getChatClient();
  const prompt = `You are a senior technical interviewer.

Generate exactly ONE interview question for this candidate.

Candidate role:
${role}

Candidate experience level:
${experienceLabel(profile)}

Candidate resume skills:
${JSON.stringify(profile.skills || [])}

Candidate projects:
${JSON.stringify(profile.projects || [])}

Resume highlights:
${String(profile.summary || '').slice(0, 1800)}

Retrieved knowledge base context:
${contextSnippets(context).slice(0, 1800)}

Previous questions already asked:
${JSON.stringify(previousQuestions)}

Candidate's latest answer:
${lastAnswer || 'No answer yet.'}

Current turn number:
${turnNumber}

Rules:
1. The question MUST explicitly mention at least one resume skill or project.
2. The question MUST match the candidate experience level.
3. Do NOT ask a generic question.
4. Do NOT repeat previous questions.
5. Ask a practical design, debugging, or scenario-based question.
6. Keep the question under 70 words.

Return only the question.`;

  try {
    const response = await client.chat.completions.create({
      model: chatModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });
    return response.choices[0]?.message?.content?.trim() || fallbackQuestion(role, profile, previousQuestions, turnNumber, lastAnswer, context);
  } catch {
    return fallbackQuestion(role, profile, previousQuestions, turnNumber, lastAnswer, context);
  }
}

function invalidAnswerEvaluation(answer: string): EvaluationResult | null {
  const normalized = answer.replace(/\s+/g, ' ').trim();
  const lowered = normalized.toLowerCase();
  const words = normalized.match(/[a-zA-Z][a-zA-Z0-9+#.-]*/g) || [];
  const alphaChars = normalized.match(/[a-zA-Z]/g) || [];
  const vowelCount = (normalized.match(/[aeiouAEIOU]/g) || []).length;
  const vowelRatio = vowelCount / Math.max(alphaChars.length, 1);

  if (normalized.length < 20 || words.length < 4) {
    const isSingleRandomToken = words.length <= 1 && normalized.length >= 10;
    const looksLikeGibberish = isSingleRandomToken || (alphaChars.length >= 10 && vowelRatio < 0.22);
    if (looksLikeGibberish) {
      return {
        score: 0,
        strengths: ['Not answered properly.'],
        gaps: [
          'The answer appears to be random text or gibberish.',
          'It does not address the question or provide any deployable technical reasoning.',
          'A valid answer must explain concrete architecture, trade-offs, risks, and implementation steps.',
        ],
        follow_up: 'Ask the candidate to answer again from scratch with a structured technical response.',
        grounded_notes: 'Invalid answer quality gate triggered before LLM evaluation.',
      };
    }
    return {
      score: 0,
      strengths: ['Not answered properly.'],
      gaps: [
        'The response does not contain enough technical detail to assess the candidate.',
        'It does not directly answer the interview question.',
        'It needs a clear explanation, concrete examples, and trade-offs.',
      ],
      follow_up: 'Ask for a complete answer with architecture, reasoning, and operational details.',
      grounded_notes: 'Short answer quality gate triggered before LLM evaluation.',
    };
  }

  const acknowledgementOnly = new Set([
    'yes', 'no', 'maybe', 'ok', 'okay', 'sure', 'idk', 'dont know', "don't know",
    'i dont know', "i don't know", 'not sure', 'no idea',
  ]);
  if (acknowledgementOnly.has(lowered)) {
    return {
      score: 0,
      strengths: ['Not answered properly.'],
      gaps: [
        'The response does not attempt the requested design or reasoning.',
        'It gives no evidence of knowledge related to the question.',
        'It should include a structured explanation and concrete implementation details.',
      ],
      follow_up: 'Ask the candidate to walk through the answer step by step instead of giving a short acknowledgement.',
      grounded_notes: 'Non-answer quality gate triggered before LLM evaluation.',
    };
  }

  return null;
}

function fallbackEvaluation(answer: string, context: RetrievedContext[]): EvaluationResult {
  const invalid = invalidAnswerEvaluation(answer);
  if (invalid) return invalid;

  const lowered = answer.toLowerCase();
  const words = answer.split(/\s+/).filter(Boolean).length;
  let score = 2;
  const strengths: string[] = [];
  const gaps: string[] = [];

  if (words >= 35) {
    score += 2;
    strengths.push('Gave a reasonably detailed explanation instead of a one-line answer.');
  } else {
    gaps.push('Add more implementation detail so the interviewer can judge depth.');
  }
  if (/(for example|for instance|i used|we used|in my project|in production)/.test(lowered)) {
    score += 2;
    strengths.push('Grounded the answer in a concrete example or project.');
  } else {
    gaps.push('Tie the answer to a real project, example, or incident.');
  }
  if (/(trade-off|tradeoff|latency|accuracy|cost|performance|scalability|maintainability)/.test(lowered)) {
    score += 2;
    strengths.push('Discussed trade-offs or production constraints.');
  } else {
    gaps.push('Call out trade-offs such as latency, accuracy, cost, or maintainability.');
  }
  if (/(debug|log|metric|monitor|test|rollback|failure|alert)/.test(lowered)) {
    score += 2;
    strengths.push('Included a practical debugging, testing, or monitoring angle.');
  } else {
    gaps.push('Explain how you would test, monitor, or debug the solution.');
  }
  if (context.length) {
    score += 1;
    strengths.push('The answer can be reviewed against retrieved interview context.');
  }
  return {
    score: Math.max(2, Math.min(10, score)),
    strengths: strengths.length ? strengths : ['Answer captured and tied to the current interview turn.'],
    gaps: gaps.length ? gaps : ['Add a little more specificity to show implementation depth.'],
    follow_up: 'Ask for one concrete failure mode and the exact signals they would inspect first.',
    grounded_notes: contextSnippets(context).slice(0, 300),
  };
}

export async function evaluateAnswer(question: string, answer: string, context: RetrievedContext[]): Promise<EvaluationResult> {
  const invalid = invalidAnswerEvaluation(answer);
  if (invalid) return invalid;

  if (!hasChatClient()) return fallbackEvaluation(answer, context);

  const client = getChatClient();
  const prompt = `Evaluate the candidate answer as JSON with keys score, strengths, gaps, follow_up.
Question: ${question}
Answer: ${answer}
Reference context: ${context.map((item) => item.text.slice(0, 600)).join('\n')}
Score out of 10. Be strict, fair, and specific.
Do not sugarcoat and do not invent strengths.
If the answer is gibberish, random characters, a non-answer, or does not address the question, score 0 or 1.
If there are no real strengths, set strengths to ["None: ..."] and explain why.
Strengths and gaps must be arrays of strings.`;

  try {
    const response = await client.chat.completions.create({
      model: chatModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
    const parsed = safeJsonParse<EvaluationResult>(response.choices[0]?.message?.content, fallbackEvaluation(answer, context));
    parsed.score = Math.max(0, Math.min(10, Number(parsed.score) || 0));
    return parsed;
  } catch {
    return fallbackEvaluation(answer, context);
  }
}

export async function summarizeSession(role: string, profile: ResumeProfile, turns: InterviewTurnRow[]) {
  const completed = turns.filter((turn) => turn.answer);
  if (!completed.length) return 'No interview turns were completed.';

  const scores = completed
    .map((turn) => Number(turn.evaluation?.score))
    .filter((score) => Number.isFinite(score));
  const average = scores.length ? (scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(1) : null;

  if (!hasChatClient()) {
    const strengths = completed.flatMap((turn) => turn.evaluation?.strengths || []).slice(0, 6);
    const gaps = completed.flatMap((turn) => turn.evaluation?.gaps || []).slice(0, 6);
    return [
      `Interview summary for ${profile.name || 'candidate'} targeting ${role}.`,
      `Completed turns: ${completed.length} / ${appConfig.maxTurns}.`,
      average ? `Average score: ${average}/10.` : 'Average score: unavailable.',
      `Strength signals: ${strengths.join('; ') || 'answers were recorded for each completed turn.'}`,
      `Improvement areas: ${gaps.join('; ') || 'add more evidence, trade-offs, and implementation details.'}`,
    ].join('\n');
  }

  const client = getChatClient();
  const transcript = completed.map((turn) => ({
    question: turn.question,
    answer: turn.answer,
    evaluation: turn.evaluation,
    sources: (turn.retrieved_context || []).map((item) => item.metadata.source),
  }));
  const prompt = `Write a concise final interview summary with these headings:
1. Overall signal
2. Strengths
3. Gaps / risks
4. Suggested follow-up
5. Hiring recommendation

Role: ${role}
Candidate profile: ${JSON.stringify(profile)}
Average score: ${average}
Transcript and per-turn evaluations: ${JSON.stringify(transcript)}

Base every claim on the transcript and evaluations. Do not invent credentials.`;

  try {
    const response = await client.chat.completions.create({
      model: chatModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.25,
    });
    return response.choices[0]?.message?.content?.trim() || 'Summary unavailable.';
  } catch {
    return `Interview completed for ${profile.name || 'candidate'} targeting ${role}. Average score: ${average || 'unavailable'}/10.`;
  }
}
