import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { channels as fixtureChannels, posts as fixturePosts, topics as fixtureTopics } from "./fixtures";
import type { Channel, Media, Post, Topic } from "./types";
import "./styles.css";

const isAdmin = location.pathname.includes("admin");
const previewFixture = import.meta.env.VITE_V5_PREVIEW_FIXTURES === "1" || import.meta.env.MODE === "preview-fixture" || location.hostname === "localhost";

function Icon({ children, label, onClick, active = false }: { children: React.ReactNode; label: string; onClick?: () => void; active?: boolean }) {
  return <button className={`icon-button ${active ? "active" : ""}`} aria-label={label} title={label} onClick={onClick}>{children}</button>;
}

function Avatar({ title }: { title: string }) {
  return <div className="avatar" aria-hidden="true">{title.split(/\s+/).slice(-2).map((x) => x[0]).join("").toUpperCase()}</div>;
}

function MediaGrid({ media, onOpen }: { media: Media[]; onOpen: (item: Media) => void }) {
  if (!media.length) return null;
  if (media[0].media_type === "video") return <figure className="video-wrap"><video controls preload="metadata" poster={media[0].thumbnail_url}><source src={media[0].url} /></video><figcaption>{media[0].caption}</figcaption></figure>;
  if (media[0].media_type === "document") return <a className="document-card" href={media[0].url} target="_blank" rel="noreferrer"><span className="doc-icon">DOC</span><span><b>{media[0].file_name}</b><small>{media[0].caption} · {media[0].file_size || 0} B</small></span></a>;
  return <div className={`media-grid count-${Math.min(media.length, 4)}`}>{media.map((item) => <button key={item.id} onClick={() => onOpen(item)} aria-label={`Mở ảnh: ${item.caption || "không có chú thích"}`}><img src={item.url} loading="lazy" alt={item.caption || "Ảnh bài học"} /><span>{item.caption}</span></button>)}</div>;
}

function PostCard({ post, unread, admin, onAction }: { post: Post; unread?: boolean; admin?: boolean; onAction?: (action: string, post: Post) => void }) {
  const [complete, setComplete] = useState(false);
  const [lightbox, setLightbox] = useState<Media | null>(null);
  return <article className={`post-card ${unread ? "first-unread" : ""}`} id={`post-${post.id}`} tabIndex={0} aria-label={`Bài số ${post.sequence_no}`}>
    {unread && <div className="unread-line"><span>Bài chưa đọc</span></div>}
    <header><Avatar title={post.author_admin_email} /><div><b>{post.author_admin_email}</b><small>{new Date(post.published_at || Date.now()).toLocaleString("vi-VN")} {post.edited_at ? "· đã sửa" : ""}</small></div>{post.pinned_at && <span className="pin">Đã ghim</span>}</header>
    <p className="post-copy">{post.body_text}</p>
    <MediaGrid media={post.media} onOpen={setLightbox} />
    <footer><span>#{post.sequence_no}</span>{admin ? <div className="post-actions">{["Sửa", "Ghim", "Nhân bản", "Xóa mềm"].map((a) => <button key={a} onClick={() => onAction?.(a, post)}>{a}</button>)}</div> : <button className={complete ? "complete done" : "complete"} onClick={() => setComplete(!complete)}>{complete ? "Đã hoàn thành" : "Đánh dấu hoàn thành"}</button>}</footer>
    {lightbox && <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}><button aria-label="Đóng">×</button><img src={lightbox.url} alt={lightbox.caption || "Ảnh toàn màn hình"} /><p>{lightbox.caption}</p></div>}
  </article>;
}

function StudentApp() {
  const [selected, setSelected] = useState<Channel | null>(null);
  const [search, setSearch] = useState("");
  const [topic, setTopic] = useState("");
  const [count, setCount] = useState(24);
  const [newBanner, setNewBanner] = useState(false);
  const [restored, setRestored] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channels = fixtureChannels;
  const visiblePosts = useMemo(() => {
    if (!selected) return [];
    return fixturePosts.filter((post) => post.channel_id === selected.id && (!topic || post.topic_id === topic) && (!search || post.body_text.toLocaleLowerCase("vi").includes(search.toLocaleLowerCase("vi")))).sort((a, b) => a.sequence_no - b.sequence_no).slice(-count);
  }, [selected, topic, search, count]);
  const channelTopics = fixtureTopics.filter((item) => item.channel_id === selected?.id);

  useEffect(() => {
    if (!selected || !scrollRef.current) return;
    const key = `lms-v5-scroll:${selected.course_slug}`;
    const saved = Number(sessionStorage.getItem(key) || 0);
    requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = saved || scrollRef.current.scrollHeight; setRestored(true); });
    const timer = window.setTimeout(() => setNewBanner(true), 5000);
    return () => clearTimeout(timer);
  }, [selected]);

  if (!selected) return <div className="app-shell single"><aside className="channel-list"><div className="brand"><span className="brand-mark">L</span><div><b>LMS V5</b><small>Kênh học tập</small></div></div><label className="search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm lớp học" aria-label="Tìm lớp học" /></label><div className="preview-badge">PREVIEW · DỮ LIỆU FIXTURE</div>{channels.filter((c) => c.display_title.toLowerCase().includes(search.toLowerCase())).map((channel) => <button className="channel-row" key={channel.id} onClick={() => { setSelected(channel); setSearch(""); }}><Avatar title={channel.display_title} /><span><b>{channel.display_title}</b><small>{channel.description}</small><i><em style={{ width: `${channel.progress_percent}%` }} /></i></span><time>{channel.unread_count}</time></button>)}</aside></div>;

  return <main className="app-shell">
    <section className="feed-panel">
      <nav className="topbar"><Icon label="Quay lại" onClick={() => setSelected(null)}>‹</Icon><Avatar title={selected.display_title} /><div className="channel-title"><b>{selected.display_title}</b><small>{selected.description}</small></div><Icon label="Tìm kiếm" onClick={() => document.getElementById("feed-search")?.focus()}>⌕</Icon><Icon label="Tài liệu">▤</Icon></nav>
      <div className="filterbar"><input id="feed-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm trong kênh…" aria-label="Tìm trong kênh" /><select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Lọc chủ đề"><option value="">Tất cả chủ đề</option>{channelTopics.map((t) => <option key={`${t.channel_id}-${t.id}`} value={t.id}>{t.title}</option>)}</select><span>{selected.progress_percent}% hoàn thành</span></div>
      {newBanner && <button className="new-banner" onClick={() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); setNewBanner(false); }}>Có bài mới · bấm để xem</button>}
      <div className="feed-scroll" ref={scrollRef} onScroll={(e) => sessionStorage.setItem(`lms-v5-scroll:${selected.course_slug}`, String(e.currentTarget.scrollTop))}>
        {visiblePosts.length >= count && <button className="load-older" onClick={() => setCount((n) => n + 24)}>Tải bài cũ hơn</button>}
        <div className="date-separator"><span>Tháng 7, 2026</span></div>
        {visiblePosts.map((post, index) => <PostCard key={post.id} post={post} unread={index === Math.max(0, visiblePosts.length - selected.unread_count)} />)}
        {!visiblePosts.length && <div className="empty">Không có bài phù hợp.</div>}
      </div>
      <button className="jump-bottom" aria-label="Nhảy xuống cuối" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })}>↓</button>
      {!restored && <div className="loading">Đang khôi phục vị trí…</div>}
    </section>
  </main>;
}

function AdminApp() {
  const [allPosts, setAllPosts] = useState<Post[]>(fixturePosts.map((post) => ({ ...post, media: [...post.media] })));
  const [channel, setChannel] = useState(fixtureChannels[0]);
  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [body, setBody] = useState("");
  const [postType, setPostType] = useState("lesson");
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<Media[]>([]);
  const [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const feed = allPosts.filter((post) => post.channel_id === channel.id).sort((a, b) => a.sequence_no - b.sequence_no);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((current) => [...current, ...Array.from(list).slice(0, 20 - current.length).map((file, i) => ({ id: `upload-${Date.now()}-${i}`, position: current.length + i, media_type: file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : "document", url: URL.createObjectURL(file), file_name: file.name, file_size: file.size, caption: "", status: "ready" as const }))]);
  }
  function save(status: "draft" | "published" | "scheduled") {
    if (!body.trim() && !files.length) return setNotice("Hãy nhập nội dung hoặc thêm tệp.");
    const post: Post = { id: crypto.randomUUID(), channel_id: channel.id, topic_id: topic || null, post_type: files.length > 1 ? "image_album" : postType, body_text: body.trim(), sequence_no: Math.max(0, ...feed.map((p) => p.sequence_no)) + 1, status, published_at: status === "published" ? new Date().toISOString() : null, author_admin_email: "Quản trị LMS", media: files };
    setAllPosts((rows) => [...rows, post]); setBody(""); setFiles([]); setNotice(status === "published" ? "Đã đăng bài trong fixture Preview." : status === "scheduled" ? "Đã lên lịch trong fixture Preview." : "Đã lưu nháp trong fixture Preview.");
  }
  function action(name: string, post: Post) {
    if (name === "Ghim") setAllPosts((rows) => rows.map((row) => row.id === post.id ? { ...row, pinned_at: row.pinned_at ? null : new Date().toISOString() } : row));
    if (name === "Nhân bản") setAllPosts((rows) => [...rows, { ...post, id: crypto.randomUUID(), status: "draft", sequence_no: Math.max(...feed.map((p) => p.sequence_no)) + 1 }]);
    if (name === "Xóa mềm") setAllPosts((rows) => rows.map((row) => row.id === post.id ? { ...row, status: "deleted" } : row));
    if (name === "Sửa") { setSelectedPost(post); setBody(post.body_text); }
  }

  return <main className="admin-shell">
    <aside className="admin-channels"><div className="brand"><span className="brand-mark">L</span><div><b>LMS V5 Admin</b><small>Không phải Telegram</small></div></div><div className="preview-badge">PREVIEW · KHÔNG GHI PRODUCTION</div>{fixtureChannels.map((item) => <button key={item.id} className={item.id === channel.id ? "channel-row selected" : "channel-row"} onClick={() => setChannel(item)}><Avatar title={item.display_title} /><span><b>{item.display_title}</b><small>{item.description}</small></span></button>)}</aside>
    <section className="admin-feed"><nav className="topbar"><Avatar title={channel.display_title} /><div className="channel-title"><b>{channel.display_title}</b><small>{feed.length} bài · fixture</small></div><Icon label="Tìm">⌕</Icon></nav><div className="feed-scroll admin-scroll">{feed.filter((p) => p.status !== "deleted").map((post) => <PostCard key={post.id} post={post} admin onAction={action} />)}</div>
      <div className="composer" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}><div className="composer-tools"><label className="attach" aria-label="Đính kèm tệp">＋<input type="file" multiple onChange={(e) => addFiles(e.target.files)} /></label><select value={postType} onChange={(e) => setPostType(e.target.value)} aria-label="Loại bài"><option value="lesson">Bài học</option><option value="announcement">Thông báo</option><option value="text">Văn bản</option></select><select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Chủ đề"><option value="">Không topic</option>{fixtureTopics.filter((t) => t.channel_id === channel.id).map((t) => <option key={`${t.channel_id}-${t.id}`} value={t.id}>{t.title}</option>)}</select></div><textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Viết bài cho kênh…" aria-label="Nội dung bài viết" />
        {!!files.length && <div className="upload-strip">{files.map((file, i) => <div key={file.id}>{file.media_type === "image" ? <img src={file.url} alt="" /> : <span className="doc-icon">{file.media_type}</span>}<input value={file.caption} onChange={(e) => setFiles((rows) => rows.map((r, x) => x === i ? { ...r, caption: e.target.value } : r))} placeholder="Chú thích" aria-label={`Chú thích tệp ${i + 1}`} /><button aria-label={`Hủy tệp ${i + 1}`} onClick={() => setFiles((rows) => rows.filter((_, x) => x !== i))}>×</button></div>)}</div>}
        {notice && <div className="notice" role="status">{notice}</div>}<div className="composer-actions"><button onClick={() => setPreview(true)}>Xem trước</button><button onClick={() => save("draft")}>Lưu nháp</button><button onClick={() => save("scheduled")}>Lên lịch</button><button className="primary" onClick={() => save("published")}>Đăng ngay</button></div></div>
    </section>
    <aside className="inspector"><h2>Thông tin</h2>{selectedPost ? <><b>Bài #{selectedPost.sequence_no}</b><p>Trạng thái: {selectedPost.status}</p><button>Lịch sử phiên bản</button><button>Nhật ký thao tác</button><button>Xem như học viên</button></> : <><b>{channel.display_title}</b><p>{channel.description}</p><dl><dt>Tiến độ</dt><dd>{channel.progress_percent}%</dd><dt>Feature flag</dt><dd>Fixture Preview</dd></dl></>}</aside>
    {preview && <div className="preview-modal" role="dialog" aria-modal="true"><div><h2>Xem trước giao diện học viên</h2><PostCard post={{ id: "preview", channel_id: channel.id, topic_id: topic || null, post_type: postType, body_text: body, sequence_no: feed.length + 1, status: "draft", published_at: new Date().toISOString(), author_admin_email: "Quản trị LMS", media: files }} /><button onClick={() => setPreview(false)}>Đóng xem trước</button></div></div>}
  </main>;
}

function App() {
  if (!previewFixture) return <div className="fatal"><h1>LMS V5 đang tắt</h1><p>Khóa học này tiếp tục dùng giao diện B05.</p><a href="/lms.html">Mở LMS B05</a></div>;
  return isAdmin ? <AdminApp /> : <StudentApp />;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
