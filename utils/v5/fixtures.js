const channelA = "10000000-0000-4000-8000-000000000001";
const channelB = "10000000-0000-4000-8000-000000000002";
const channelC = "10000000-0000-4000-8000-000000000003";
const topicA = "20000000-0000-4000-8000-000000000001";
const topicB = "20000000-0000-4000-8000-000000000002";

function post(channelId, sequence, overrides = {}) {
  const tail = String(sequence).padStart(12, "0");
  return {
    id: `30000000-0000-4000-8000-${tail}`,
    channel_id: channelId,
    topic_id: overrides.topic_id ?? null,
    post_type: "lesson",
    body_text: `Bài học ${sequence}: nội dung thực hành được chuẩn bị cho LMS V5.`,
    body_json: {},
    sequence_no: sequence,
    status: "published",
    published_at: new Date(Date.UTC(2026, 6, 1, 0, sequence % 60)).toISOString(),
    scheduled_at: null,
    edited_at: sequence % 9 === 0 ? new Date(Date.UTC(2026, 6, 2)).toISOString() : null,
    pinned_at: null,
    author_admin_email: "Giảng viên LMS",
    reply_to_post_id: null,
    created_at: new Date(Date.UTC(2026, 6, 1)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 6, 1)).toISOString(),
    media: [],
    ...overrides
  };
}

const posts = [
  post(channelA, 1, { post_type: "announcement", body_text: "Chào mừng bạn đến lớp học LMS.", pinned_at: "2026-07-01T00:00:00.000Z" }),
  post(channelA, 2, { post_type: "image_album", body_text: "Album thành phẩm mẫu.", media: [
    { id: "40000000-0000-4000-8000-000000000001", position: 0, media_type: "image", provider: "fixture", url: "https://images.unsplash.com/photo-1556910103-1c02745aae4d?auto=format&fit=crop&w=1200&q=80", caption: "Bước chuẩn bị" },
    { id: "40000000-0000-4000-8000-000000000002", position: 1, media_type: "image", provider: "fixture", url: "https://images.unsplash.com/photo-1551218808-94e220e084d2?auto=format&fit=crop&w=1200&q=80", caption: "Thành phẩm" }
  ] }),
  post(channelA, 3, { post_type: "video", body_text: "Video kỹ thuật cơ bản.", media: [{ id: "40000000-0000-4000-8000-000000000003", position: 0, media_type: "video", provider: "fixture", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4", thumbnail_url: "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1200&q=80", caption: "Xem và hoàn thành video" }] }),
  post(channelA, 4, { post_type: "document", body_text: "Tài liệu thực hành.", media: [{ id: "40000000-0000-4000-8000-000000000004", position: 0, media_type: "document", provider: "fixture", url: "/fixtures/lms-v5/sample-handout.txt", file_name: "tai-lieu-thuc-hanh.txt", mime_type: "text/plain", file_size: 128, caption: "Tài liệu mẫu Preview" }] }),
  ...Array.from({ length: 120 }, (_, index) => post(channelC, index + 1, { topic_id: index < 40 ? topicA : topicB })),
  post(channelB, 1, { post_type: "topic_header", body_text: "Chủ đề: Nền tảng", topic_id: topicA }),
  post(channelB, 2, { topic_id: topicA }),
  post(channelB, 3, { post_type: "topic_header", body_text: "Chủ đề: Thực hành", topic_id: topicB }),
  post(channelB, 4, { topic_id: topicB })
];

export function createFixtureState() {
  return {
    channels: [
      { id: channelA, course_slug: "v5-co-ban", display_title: "LMS • Lớp nền tảng", description: "Kênh học tập đơn giản", avatar_url: "", cover_url: "", status: "active", progress_percent: 50 },
      { id: channelB, course_slug: "v5-chuyen-de", display_title: "LMS • Lớp chuyên đề", description: "Kênh có nhiều topic", avatar_url: "", cover_url: "", status: "active", progress_percent: 25 },
      { id: channelC, course_slug: "v5-feed-lon", display_title: "LMS • Phòng thực hành", description: "Fixture hơn 100 bài viết", avatar_url: "", cover_url: "", status: "active", progress_percent: 12 }
    ],
    settings: [
      { course_slug: "v5-co-ban", channel_id: channelA, ui_version: "v5", enabled: true, rollout_percent: 100, settings: {} },
      { course_slug: "v5-chuyen-de", channel_id: channelB, ui_version: "v5", enabled: true, rollout_percent: 100, settings: {} },
      { course_slug: "v5-feed-lon", channel_id: channelC, ui_version: "v5", enabled: true, rollout_percent: 100, settings: {} }
    ],
    topics: [
      { id: topicA, channel_id: channelB, title: "Nền tảng", description: "", sort_order: 1, status: "active" },
      { id: topicB, channel_id: channelB, title: "Thực hành", description: "", sort_order: 2, status: "active" },
      { id: topicA, channel_id: channelC, title: "Nền tảng", description: "", sort_order: 1, status: "active" },
      { id: topicB, channel_id: channelC, title: "Thực hành", description: "", sort_order: 2, status: "active" }
    ],
    posts: structuredClone(posts),
    reads: [],
    readStates: [],
    versions: [],
    audits: [],
    uploads: [],
    idempotency: new Map()
  };
}

export function getFixtureState() {
  if (!globalThis.__LMS_V5_FIXTURE_STATE__) globalThis.__LMS_V5_FIXTURE_STATE__ = createFixtureState();
  return globalThis.__LMS_V5_FIXTURE_STATE__;
}

