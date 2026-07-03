# Project Handover: TESTING_CHECKLIST.md

This checklist should be run before executing any major production deployments.

---

## 🔐 1. Authentication & Security

- [ ] **Google Sign-in**: Ensure the Google Sign-in button renders and functions correctly on both desktop and mobile layouts.
- [ ] **Whitelisting (403 Forbidden)**: Attempt to log in with an unauthorized Google account. Verify that the server returns a clear forbidden message instead of throwing server errors.
- [ ] **Session Recovery**: Verify that refreshing the page or navigating back and forth between the catalog and details page does not prompt the user to log in again.
- [ ] **Expired Sessions**: Manually delete the `course_session_token` cookie and verify that the page forces a redirect or triggers the Google Sign-in modal.

---

## 📚 2. Student Portal Course Catalog (`lms.html`)

- [ ] **Accordion Toggle**: Verify that clicking a Chapter Header collapses and expands its child lessons list.
- [ ] **Lesson Counter**: Check the course summary header. The lesson count text must display the total number of real lessons only (excluding Chapter Sections).
- [ ] **Relative Indexing**: Verify that the first lesson under Chapter 1 is labeled `Bài 1`, the first lesson under Chapter 2 is labeled `Bài 1`, etc.
- [ ] **Cộng đồng học viên link**: Check that the community link redirects correctly to the configured URL.

---

## 📽️ 3. Lesson Details (`lesson.html`)

- [ ] **Video Player Visibility**:
  - Load a lesson *with* a video URL. Verify that the video player, thumbnail, and play button render correctly.
  - Load a lesson *without* a video URL. Verify that the player area is completely hidden from the DOM.
- [ ] **Description Card Visibility**:
  - Load a lesson *with* a description. Verify that the description renders.
  - Load a lesson *without* a description (or empty). Verify that the card is completely hidden (no "Chưa có mô tả ngắn." text shown).
- [ ] **Recipe Card Visibility**:
  - Load a lesson *with* a Google Docs recipe link. Verify that the recipe content text downloads and displays.
  - Load a lesson *without* a recipe link. Verify that the recipe card is hidden.
- [ ] **Linkification**: Inspect URLs inside the recipe or description. Verify that they render as clickable text showing the exact URL input, opening in a new browser tab.
- [ ] **Copy & Selection Prevention**:
  - Verify that the print button ("In công thức") is absent.
  - (Once high-priority TODO is implemented) Verify that text select, mouse drag highlight, right-click menu, and touch hold are blocked.

---

## 🧭 4. Navigation & Sidebar Controls

- [ ] **Sidebar Directory**: Confirm that the sidebar shows all chapters and relative lesson numbers consistent with the course catalog page.
- [ ] **Prev/Next Navigation**:
  - Go to the first lesson in the entire course. Verify that the "Bài Trước" button is disabled.
  - Go to a lesson immediately following a Chapter Section. Click "Bài Trước". Verify that the page redirects to the previous lesson, skipping the Chapter Section header record.
  - Go to the last lesson. Verify that the "Bài Tiếp Theo" button is disabled.

---

## 🛠️ 5. Admin CMS (`lms-admin.html`)

- [ ] **Create Section**:
  - Tick "Đây là Chương (Section)". Click "Lưu bài học".
  - Verify that the "Lesson no" input for the next lesson form automatically resets to `1`.
- [ ] **Drag-and-drop Reordering**:
  - Reorder items using the drag handles.
  - Verify that saving does not trigger `duplicate key value violates unique constraint` errors.
  - Reload the page and ensure the new ordering persists.
