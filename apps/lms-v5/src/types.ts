export type Media = {
  id: string; position: number; media_type: "image" | "video" | "audio" | "document";
  url: string; thumbnail_url?: string; file_name?: string; mime_type?: string;
  file_size?: number; caption?: string; status?: "ready" | "uploading" | "failed";
};
export type Post = {
  id: string; channel_id: string; topic_id: string | null; post_type: string;
  body_text: string; sequence_no: number; status: string; published_at: string | null;
  edited_at?: string | null; pinned_at?: string | null; author_admin_email: string;
  media: Media[];
};
export type Topic = { id: string; channel_id: string; title: string; sort_order: number };
export type Channel = {
  id: string; course_slug: string; display_title: string; description: string;
  progress_percent: number; unread_count: number; latest_post?: Partial<Post>;
};

