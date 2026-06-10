import pdf from 'pdf-parse';
import { chatModel, getChatClient, hasChatClient, safeJsonParse } from './openai.js';
import type { ResumeProfile } from './types.js';

const SECTION_STOP_HEADERS = new Set([
  'SUMMARY',
  'INTERNSHIP EXPERIENCE',
  'EXPERIENCE',
  'WORK EXPERIENCE',
  'PROJECTS',
  'EDUCATION',
  'SKILLS',
  'CERTIFICATIONS',
  'ACHIEVEMENTS & ACTIVITIES',
  'ACHIEVEMENTS',
  'ACTIVITIES',
]);

const SKILL_HINTS = [
  'python', 'java', 'javascript', 'typescript', 'react', 'next.js', 'fastapi', 'flask', 'django',
  'sql', 'postgresql', 'mongodb', 'docker', 'kubernetes', 'aws', 'azure', 'gcp',
  'machine learning', 'deep learning', 'nlp', 'computer vision', 'pandas', 'numpy', 'scikit-learn',
  'tensorflow', 'pytorch', 'rag', 'llm', 'vector database', 'redis', 'microservices',
];

function cleanLine(line: string) {
  return line.replace(/\x7f/g, ' ').replace(/\uf0b7/g, ' ').replace(/•/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedLines(text: string) {
  return text.split('\n').map(cleanLine).filter(Boolean);
}

function sectionLines(lines: string[], name: string) {
  const start = lines.findIndex((line) => line.toUpperCase() === name);
  if (start === -1) return [] as string[];
  const collected: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (SECTION_STOP_HEADERS.has(line.toUpperCase())) break;
    collected.push(line);
  }
  return collected;
}

function looksLikeTitle(line: string) {
  if (!line || line.includes(':')) return false;
  const words = line.split(/\s+/);
  if (words.length < 2 || words.length > 8 || line.length > 80) return false;
  if (line.endsWith('.') || line[0] !== line[0].toUpperCase()) return false;
  if (/\b(202\d|20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(line)) return false;
  const blocked = new Set([
    'built', 'designed', 'implemented', 'selected', 'wrote', 'evaluated', 'generated',
    'trained', 'engineered', 'applied', 'performed', 'assisted', 'collaborated', 'developed',
    'produced', 'served',
  ]);
  if (blocked.has(words[0].toLowerCase())) return false;
  const capitalized = words.filter((word) => /[A-Z]/.test(word)).length;
  return capitalized >= Math.max(2, Math.floor(words.length / 2));
}

function extractProjects(lines: string[]) {
  const projectLines = sectionLines(lines, 'PROJECTS');
  const projects: Array<{ title: string; bullets: string[] }> = [];
  let current: { title: string; bullets: string[] } | null = null;

  for (const line of projectLines) {
    if (looksLikeTitle(line)) {
      if (current && current.bullets.length) projects.push(current);
      current = { title: line, bullets: [] };
      continue;
    }
    if (current) current.bullets.push(line);
  }
  if (current && current.bullets.length) projects.push(current);

  return {
    projects: projects.slice(0, 5).map((project) => `${project.title}: ${project.bullets.slice(0, 3).join(' ').slice(0, 280)}`.trim()),
    projectDetails: projects.slice(0, 5).map((project) => ({
      title: project.title,
      bullets: project.bullets.slice(0, 3),
    })),
  };
}

function fallbackResumeParse(text: string): ResumeProfile {
  const lowered = text.toLowerCase();
  const lines = normalizedLines(text);
  const skills = [...new Set(SKILL_HINTS.filter((skill) => lowered.includes(skill)))].sort();
  const emails = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || [];
  const phones = text.match(/(?:\+?\d[\d\s-]{8,}\d)/g) || [];
  const possibleName = lines.find((line) => {
    const words = line.split(/\s+/);
    return words.length >= 2 && words.length <= 4 && !/(email|phone|resume|linkedin|github|http)/i.test(line);
  });
  const yearsMatch = lowered.match(/(\d+(?:\.\d+)?)\+?\s*(?:years|yrs)/);
  const domainConfig: Array<[string, string[]]> = [
    ['backend', ['api', 'database', 'microservice', 'fastapi', 'django', 'flask']],
    ['ai_ml', ['machine learning', 'deep learning', 'model', 'nlp', 'computer vision', 'rag']],
    ['frontend', ['react', 'next', 'ui', 'frontend']],
    ['cloud_devops', ['docker', 'kubernetes', 'aws', 'ci/cd', 'deployment']],
  ];
  const domains = domainConfig
    .filter(([, keywords]) => keywords.some((keyword: string) => lowered.includes(keyword)))
    .map(([domain]) => domain);

  const { projects, projectDetails } = extractProjects(lines);
  return {
    name: possibleName || null,
    emails: emails.slice(0, 3),
    phones: phones.slice(0, 2),
    skills,
    years_experience: yearsMatch?.[1] || null,
    domains,
    projects,
    project_details: projectDetails,
    experience_highlights: sectionLines(lines, 'INTERNSHIP EXPERIENCE').slice(0, 8),
    skill_categories: Object.fromEntries(
      sectionLines(lines, 'SKILLS')
        .filter((line) => line.includes(':'))
        .map((line) => {
          const [category, values] = line.split(':', 2);
          return [category.trim(), values.split(',').map((item) => item.trim()).filter(Boolean)];
        }),
    ),
    summary: sectionLines(lines, 'SUMMARY').slice(0, 4).join(' ') || 'Fallback extraction used. Add GROQ_API_KEY for richer JSON profile extraction.',
  };
}

export async function extractTextFromUpload(filename: string, bytes: Uint8Array) {
  if (filename.toLowerCase().endsWith('.pdf')) {
    const parsed = await pdf(Buffer.from(bytes));
    return parsed.text.trim();
  }
  return Buffer.from(bytes).toString('utf-8').trim();
}

export async function parseResume(text: string): Promise<ResumeProfile> {
  const fallback = fallbackResumeParse(text);
  if (!hasChatClient()) return fallback;

  const client = getChatClient();
  const prompt = `Extract a structured candidate profile from this resume text.
Return valid JSON only with keys:
name, emails, phones, skills, years_experience, domains, projects, seniority_signal, summary.
- skills: concise normalized technology/concept names
- domains: areas such as backend, ai_ml, data_science, frontend, cloud_devops
- projects: up to 5 short project/domain bullets
- seniority_signal: beginner, intern, junior, mid, senior, or unknown
Resume text:
${text.slice(0, 12000)}`;

  try {
    const response = await client.chat.completions.create({
      model: chatModel(),
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
    });
    const parsed = safeJsonParse<ResumeProfile>(response.choices[0]?.message?.content, fallback);
    return {
      ...fallback,
      ...parsed,
      emails: parsed.emails || fallback.emails,
      phones: parsed.phones || fallback.phones,
      skills: parsed.skills || fallback.skills,
      domains: parsed.domains || fallback.domains,
      projects: parsed.projects || fallback.projects,
      project_details: parsed.project_details || fallback.project_details,
      experience_highlights: parsed.experience_highlights || fallback.experience_highlights,
      skill_categories: parsed.skill_categories || fallback.skill_categories,
      summary: parsed.summary || fallback.summary,
    };
  } catch {
    return fallback;
  }
}
