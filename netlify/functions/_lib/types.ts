export type ResumeProfile = {
  name?: string | null;
  emails?: string[];
  phones?: string[];
  skills?: string[];
  years_experience?: string | null;
  domains?: string[];
  projects?: string[];
  project_details?: Array<{ title: string; bullets: string[] }>;
  experience_highlights?: string[];
  skill_categories?: Record<string, string[]>;
  seniority_signal?: string | null;
  summary?: string | null;
};

export type RetrievedContext = {
  text: string;
  metadata: Record<string, unknown>;
  similarity?: number;
  query?: string;
};

export type EvaluationResult = {
  score: number;
  strengths: string[];
  gaps: string[];
  follow_up: string;
  grounded_notes?: string;
};

export type InterviewTurnRow = {
  id: number;
  session_id: number;
  question: string;
  answer: string | null;
  retrieved_context: RetrievedContext[];
  evaluation: EvaluationResult | null;
  created_at: string;
};

export type InterviewSessionRow = {
  id: number;
  role: string;
  candidate_name: string | null;
  resume_object_path: string | null;
  report_object_path: string | null;
  extracted_profile: ResumeProfile;
  summary: string | null;
  created_at: string;
};
