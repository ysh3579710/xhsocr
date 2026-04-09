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
  task_type: string;
  title?: string | null;
  display_title?: string | null;
  batch_id?: number | null;
  folder_name: string;
  book_id?: number | null;
  book_name?: string | null;
  prompt_id?: number | null;
  prompt_name?: string | null;
  llm_model: string;
  download_count: number;
  status: string;
  error_message?: string | null;
  retry_count: number;
  featured_note_id?: number | null;
  is_featured?: boolean;
  created_at: string;
};

export type TaskDetail = Task & {
  images: Array<{ id: number; file_name: string; sort_index: number; file_path: string }>;
  original_note_text?: string | null;
  matched_book_segments?: {
    keywords?: string[];
    top_segments?: Array<{ segment_index: number; score: number; content: string }>;
  } | null;
  extracted_title?: string | null;
  extracted_points_text?: string | null;
  full_output?: string | null;
};

export type Batch = {
  id: number;
  batch_name: string;
  batch_type: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  status: string;
  created_at: string;
};

export type PromptItem = {
  id: number;
  track: string;
  name: string;
  content: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
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

export type FeaturedNote = {
  id: number;
  source_task_type?: string | null;
  source_task_id?: number | null;
  title: string;
  full_text: string;
  is_manual: boolean;
  structured_title?: string | null;
  structured_points_text?: string | null;
  structured_outline?: string | null;
  created_at: string;
  updated_at: string;
};
