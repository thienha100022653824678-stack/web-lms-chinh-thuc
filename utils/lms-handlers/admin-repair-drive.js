import { getAdminFromRequest, getGoogleDriveClient, resolveCourseFolderTree, saveCourseFolderId, getDriveFileId, getCourseFolderIdOrDiscover } from "../lms.js";
import { supabase } from "../supabase.js";

async function moveDriveFileSafe(drive, fileId, newParentId) {
  try {
    const file = await drive.files.get({
      fileId: fileId,
      fields: "parents, name",
      supportsAllDrives: true
    });
    const parents = file.data.parents || [];
    const name = file.data.name;

    if (parents.includes(newParentId)) {
      return { success: true, name, skipped: true };
    }

    const previousParents = parents.join(",");
    await drive.files.update({
      fileId: fileId,
      addParents: newParentId,
      removeParents: previousParents || undefined,
      fields: "id, parents",
      supportsAllDrives: true
    });

    return { success: true, name, skipped: false };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function makeFilePublicSafe(drive, fileId) {
  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
    return true;
  } catch (err) {
    console.warn(`[repair-drive] Failed to make file ${fileId} public:`, err.message);
    return false;
  }
}

async function restrictFileSharingSafe(drive, fileId) {
  try {
    await drive.files.update({
      fileId,
      requestBody: {
        copyRequiresWriterPermission: true
      },
      supportsAllDrives: true
    });
    return true;
  } catch (err) {
    console.warn(`[repair-drive] Failed to restrict file ${fileId} downloads:`, err.message);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const adminSession = getAdminFromRequest(req);
    if (!adminSession) {
      return res.status(401).json({ success: false, error: "Chưa đăng nhập admin" });
    }

    const { courseSlug } = req.body || {};

    if (!courseSlug) {
      return res.status(400).json({ success: false, error: "Thiếu mã khóa học (courseSlug)" });
    }

    let drive;
    try {
      const clientInfo = await getGoogleDriveClient(supabase);
      drive = clientInfo.drive;
    } catch (driveErr) {
      return res.status(200).json({ success: false, needsOAuth: true, error: driveErr.message || "Chưa kết nối Google Drive" });
    }

    // 1. Fetch Course details
    const { data: course, error: courseErr } = await supabase
      .from("courses")
      .select("*")
      .eq("slug", courseSlug.trim())
      .maybeSingle();

    if (courseErr) throw courseErr;
    if (!course) {
      return res.status(404).json({ success: false, error: `Không tìm thấy khóa học với mã ${courseSlug}` });
    }

    // 2. Fetch Lessons details
    const { data: lessons, error: lessonsErr } = await supabase
      .from("lessons")
      .select("*")
      .eq("course_slug", course.slug)
      .order("lesson_no", { ascending: true });

    if (lessonsErr) throw lessonsErr;

    // 3. Resolve course folders tree
    const resolvedCourseFolders = await resolveCourseFolderTree(drive, {
      course_slug: course.slug,
      course_title: course.title,
      type: "course_folder"
    });

    const courseFolderId = resolvedCourseFolders.courseFolderId;
    await saveCourseFolderId(supabase, course.slug, courseFolderId);

    // Resolve course subfolders
    const heroFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, type: "course_hero" });
    const posterFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, type: "course_poster" });
    const qrFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, type: "course_qr" });

    const movedFiles = [];
    let movedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    // ── Migrate Course Assets ───────────────────────────────────────────────
    
    // a. Hero Image (image_url)
    const heroFileId = getDriveFileId(course.image_url);
    if (heroFileId) {
      const moveRes = await moveDriveFileSafe(drive, heroFileId, heroFolder.targetFolderId);
      if (moveRes.success) {
        if (moveRes.skipped) skippedCount++; else movedCount++;
        await makeFilePublicSafe(drive, heroFileId);
        movedFiles.push({ fileId: heroFileId, name: moveRes.name, type: "course_hero", status: "success", skipped: moveRes.skipped });
      } else {
        errorCount++;
        movedFiles.push({ fileId: heroFileId, name: "Course Hero Image", type: "course_hero", status: "error", error: moveRes.error });
      }
    }

    // b. Poster Image (raw_data.posterImageUrl)
    const posterImageUrl = course.raw_data?.posterImageUrl;
    const posterFileId = getDriveFileId(posterImageUrl);
    if (posterFileId) {
      const moveRes = await moveDriveFileSafe(drive, posterFileId, posterFolder.targetFolderId);
      if (moveRes.success) {
        if (moveRes.skipped) skippedCount++; else movedCount++;
        await makeFilePublicSafe(drive, posterFileId);
        movedFiles.push({ fileId: posterFileId, name: moveRes.name, type: "course_poster", status: "success", skipped: moveRes.skipped });
      } else {
        errorCount++;
        movedFiles.push({ fileId: posterFileId, name: "Course Poster Image", type: "course_poster", status: "error", error: moveRes.error });
      }
    }

    // c. QR Image (raw_data.qrImageUrl)
    const qrImageUrl = course.raw_data?.qrImageUrl;
    const qrFileId = getDriveFileId(qrImageUrl);
    if (qrFileId) {
      const moveRes = await moveDriveFileSafe(drive, qrFileId, qrFolder.targetFolderId);
      if (moveRes.success) {
        if (moveRes.skipped) skippedCount++; else movedCount++;
        await makeFilePublicSafe(drive, qrFileId);
        movedFiles.push({ fileId: qrFileId, name: moveRes.name, type: "course_qr", status: "success", skipped: moveRes.skipped });
      } else {
        errorCount++;
        movedFiles.push({ fileId: qrFileId, name: "Bank QR Image", type: "course_qr", status: "error", error: moveRes.error });
      }
    }

    // ── Migrate Lesson Assets ───────────────────────────────────────────────
    for (const lesson of (lessons || [])) {
      const lNo = lesson.lesson_no;
      const lTitle = lesson.title || "Untitled";

      const mainVideoFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, lesson_no: lNo, lesson_title: lTitle, type: "main_video" });
      const thumbnailFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, lesson_no: lNo, lesson_title: lTitle, type: "lesson_thumbnail" });
      const lessonImageFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, lesson_no: lNo, lesson_title: lTitle, type: "lesson_media_image" });
      const lessonVideoFolder = await resolveCourseFolderTree(drive, { course_slug: course.slug, course_title: course.title, lesson_no: lNo, lesson_title: lTitle, type: "lesson_media_video" });

      // a. Lesson Thumbnail (thumbnail_url)
      const thumbFileId = getDriveFileId(lesson.thumbnail_url);
      if (thumbFileId) {
        const moveRes = await moveDriveFileSafe(drive, thumbFileId, thumbnailFolder.targetFolderId);
        if (moveRes.success) {
          if (moveRes.skipped) skippedCount++; else movedCount++;
          await makeFilePublicSafe(drive, thumbFileId);
          movedFiles.push({ fileId: thumbFileId, name: moveRes.name, type: `lesson_${lNo}_thumbnail`, status: "success", skipped: moveRes.skipped });
        } else {
          errorCount++;
          movedFiles.push({ fileId: thumbFileId, name: `Lesson ${lNo} Thumbnail`, type: `lesson_${lNo}_thumbnail`, status: "error", error: moveRes.error });
        }
      }

      // b. Lesson Main Video (video_url)
      const videoFileId = getDriveFileId(lesson.video_url);
      if (videoFileId) {
        const moveRes = await moveDriveFileSafe(drive, videoFileId, mainVideoFolder.targetFolderId);
        if (moveRes.success) {
          if (moveRes.skipped) skippedCount++; else movedCount++;
          await restrictFileSharingSafe(drive, videoFileId);
          movedFiles.push({ fileId: videoFileId, name: moveRes.name, type: `lesson_${lNo}_main_video`, status: "success", skipped: moveRes.skipped });
        } else {
          errorCount++;
          movedFiles.push({ fileId: videoFileId, name: `Lesson ${lNo} Main Video`, type: `lesson_${lNo}_main_video`, status: "error", error: moveRes.error });
        }
      }

      // c. Lesson Media URLS (media_urls)
      const mediaUrlsStr = lesson.media_urls || "";
      if (mediaUrlsStr.trim()) {
        const lines = mediaUrlsStr.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          const parts = trimmed.split("|");
          if (parts.length >= 3) {
            const type = parts[0].trim(); // image / video
            const title = parts[1].trim();
            const url = parts[2].trim();
            
            const fileId = getDriveFileId(url);
            if (fileId) {
              const targetFolder = type === "video" ? lessonVideoFolder.targetFolderId : lessonImageFolder.targetFolderId;
              const moveRes = await moveDriveFileSafe(drive, fileId, targetFolder);
              if (moveRes.success) {
                if (moveRes.skipped) skippedCount++; else movedCount++;
                if (type === "image") {
                  await makeFilePublicSafe(drive, fileId);
                } else if (type === "video") {
                  await restrictFileSharingSafe(drive, fileId);
                }
                movedFiles.push({ fileId, name: moveRes.name, type: `lesson_${lNo}_media_${type}`, status: "success", skipped: moveRes.skipped });
              } else {
                errorCount++;
                movedFiles.push({ fileId, name: `${title} (${type})`, type: `lesson_${lNo}_media_${type}`, status: "error", error: moveRes.error });
              }
            }
          }
        }
      }
    }

    // 4. Trigger Sync permissions
    let syncedStudentsCount = 0;
    let syncError = null;
    try {
      const { data: enrollments } = await supabase
        .from("student_enrollments")
        .select("email")
        .eq("course_slug", course.slug)
        .eq("status", "active");

      const activeEmails = (enrollments || []).map(e => String(e.email || "").trim().toLowerCase()).filter(Boolean);

      if (activeEmails.length > 0) {
        // Fetch existing permissions
        let existingEmails = new Set();
        try {
          const permList = await drive.permissions.list({
            fileId: courseFolderId,
            fields: "permissions(id, emailAddress, role)",
            supportsAllDrives: true
          });
          (permList.data.permissions || []).forEach(p => {
            if (p.emailAddress) existingEmails.add(p.emailAddress.toLowerCase().trim());
          });
        } catch {}

        for (const email of activeEmails) {
          if (!existingEmails.has(email)) {
            await addDriveFolderPermission(accessToken, courseFolderId, email);
            syncedStudentsCount++;
          }
        }
      }
    } catch (e) {
      syncError = e.message;
    }

    return res.status(200).json({
      success: true,
      report: {
        movedCount,
        skippedCount,
        errorCount,
        syncedStudentsCount,
        syncError
      },
      details: movedFiles
    });

  } catch (err) {
    console.error("[admin-repair-drive] Unexpected error:", err);
    return res.status(500).json({
      success: false,
      error: `Sửa cấu trúc Drive thất bại: ${err.message}`,
      message: err.message
    });
  }
}
