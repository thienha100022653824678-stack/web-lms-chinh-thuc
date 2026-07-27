import type { Channel, Post, Topic } from "./types";

export const channels: Channel[] = [
  { id: "c1", course_slug: "v5-co-ban", display_title: "LMS • Lớp nền tảng", description: "Kênh học tập đơn giản", progress_percent: 50, unread_count: 2 },
  { id: "c2", course_slug: "v5-chuyen-de", display_title: "LMS • Lớp chuyên đề", description: "Nội dung theo chủ đề", progress_percent: 25, unread_count: 4 },
  { id: "c3", course_slug: "v5-feed-lon", display_title: "LMS • Phòng thực hành", description: "Fixture hơn 100 bài viết", progress_percent: 12, unread_count: 96 }
];
export const topics: Topic[] = [
  { id: "t1", channel_id: "c2", title: "Nền tảng", sort_order: 1 },
  { id: "t2", channel_id: "c2", title: "Thực hành", sort_order: 2 },
  { id: "t1", channel_id: "c3", title: "Nền tảng", sort_order: 1 },
  { id: "t2", channel_id: "c3", title: "Thực hành", sort_order: 2 }
];
const base = (channel: string, n: number): Post => ({
  id: `${channel}-p-${n}`, channel_id: channel, topic_id: n % 2 ? "t1" : "t2",
  post_type: "lesson", body_text: `Bài học ${n}: nội dung thực hành và ghi chú dành riêng cho học viên LMS.`,
  sequence_no: n, status: "published", published_at: new Date(Date.UTC(2026, 6, 1, 8, n % 60)).toISOString(),
  edited_at: n % 11 === 0 ? new Date(Date.UTC(2026, 6, 2)).toISOString() : null,
  pinned_at: n === 1 ? new Date(Date.UTC(2026, 6, 1)).toISOString() : null,
  author_admin_email: "Giảng viên LMS", media: []
});
export const posts: Post[] = [
  { ...base("c1", 1), post_type: "announcement", body_text: "Chào mừng bạn đến kênh học tập. Hãy đọc bài ghim trước khi bắt đầu.", pinned_at: "2026-07-01T00:00:00Z" },
  { ...base("c1", 2), post_type: "image_album", body_text: "Album thành phẩm mẫu.", media: [
    { id: "m1", position: 0, media_type: "image", url: "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=80", caption: "Chuẩn bị nguyên liệu" },
    { id: "m2", position: 1, media_type: "image", url: "https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=1200&q=80", caption: "Thành phẩm hoàn chỉnh" }
  ] },
  { ...base("c1", 3), post_type: "video", body_text: "Video kỹ thuật cơ bản.", media: [{ id: "m3", position: 0, media_type: "video", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", caption: "Video fixture dùng kiểm tra player" }] },
  { ...base("c1", 4), post_type: "document", body_text: "Tài liệu thực hành.", media: [{ id: "m4", position: 0, media_type: "document", url: "/fixtures/lms-v5/sample-handout.txt", file_name: "tai-lieu-thuc-hanh.txt", mime_type: "text/plain", file_size: 128, caption: "Tài liệu Preview" }] },
  ...Array.from({ length: 4 }, (_, i) => base("c2", i + 1)),
  ...Array.from({ length: 120 }, (_, i) => base("c3", i + 1))
];

