export type Book = {
  id: number;
  title: string;
  author?: string | null;
  file_path: string;
  segment_count: number;
  created_at: string;
};

export type Task = {
  id: number;
  batch_id?: number | null;
  folder_name: string;
  book_id: number;
  llm_model: string;
  status: string;
  error_message?: string | null;
  retry_count: number;
  created_at: string;
};

export type TaskDetail = Task & {
  images: Array<{ id: number; file_name: string; sort_index: number; file_path: string }>;
  original_note_text?: string | null;
  matched_book_segments?: {
    keywords?: string[];
    top_segments?: Array<{ segment_index: number; score: number; content: string }>;
  } | null;
  rewritten_note?: string | null;
  intro_text?: string | null;
  fixed_tags_text?: string | null;
  random_tags_text?: string | null;
  full_output?: string | null;
};

export type Batch = {
  id: number;
  batch_name: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  status: string;
  created_at: string;
};

export type PromptTemplate = {
  id: number;
  prompt_type: string;
  name: string;
  active_version_id?: number | null;
  active_version_no?: number | null;
  created_at: string;
};

export type PromptVersion = {
  id: number;
  template_id: number;
  version_no: number;
  content: string;
  is_active: boolean;
  created_at: string;
};

export type TaskCreateResponse = {
  batch_id?: number | null;
  task_ids: number[];
  total_count: number;
};

export type Tag = {
  id: number;
  tag_text: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type FixedTagsConfig = {
  fixed_tags: string[];
};

export type LLMModelConfig = {
  active_model: string;
  supported_models: string[];
};
