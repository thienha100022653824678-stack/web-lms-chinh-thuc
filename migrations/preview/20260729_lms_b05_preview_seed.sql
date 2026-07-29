-- Deterministic, idempotent Preview-only synthetic seed.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('lms.preview_guard', true) <> '1'
     OR current_setting('lms.preview_ref', true) <> 'plgrmaktvudjetfkwmyg' THEN
    RAISE EXCEPTION 'PRODUCTION_DATABASE_FORBIDDEN';
  END IF;
END
$guard$;

INSERT INTO public.courses(id,slug,title,subtitle,active,is_published,sort_order,sales_site,learning_course_slug,learning_site,drive_folder_id,raw_data)
VALUES
('41000000-0000-4000-8000-000000000001','preview-yeunauan-course-a','Preview cùng tên','Site yeunauan A',true,true,1,'yeunauan',NULL,'yeunauan','preview-folder-ya','{"studentDisplayTitle":"Bếp Preview A"}'),
('41000000-0000-4000-8000-000000000002','preview-yeunauan-course-b','Preview Yeunauan B','Site yeunauan B',true,true,2,'yeunauan',NULL,'yeunauan','preview-folder-yb','{"studentDisplayTitle":"Bếp Preview B"}'),
('42000000-0000-4000-8000-000000000001','preview-yeubep-course-a','Preview cùng tên','Site yeubep A',true,true,1,'yeubep',NULL,'yeubep','preview-folder-ba','{"studentDisplayTitle":"Yêu Bếp Preview A"}'),
('42000000-0000-4000-8000-000000000002','preview-yeubep-course-b','Preview Yeubep B','Site yeubep B',true,true,2,'yeubep',NULL,'yeubep','preview-folder-bb','{"studentDisplayTitle":"Yêu Bếp Preview B"}'),
('43000000-0000-4000-8000-000000000001','preview-legacy-canonical','Preview Legacy Canonical','Legacy NULL fallback',true,true,3,NULL,NULL,NULL,'preview-folder-legacy','{"studentDisplayTitle":"Legacy Preview"}'),
('43000000-0000-4000-8000-000000000002','preview-legacy-shared-alias','Preview Legacy Shared Alias','Read only alias',true,true,4,'yeubep','preview-legacy-canonical',NULL,NULL,'{}')
ON CONFLICT(slug) DO UPDATE SET
 title=excluded.title,subtitle=excluded.subtitle,active=excluded.active,is_published=excluded.is_published,
 sort_order=excluded.sort_order,sales_site=excluded.sales_site,learning_course_slug=excluded.learning_course_slug,
 learning_site=excluded.learning_site,drive_folder_id=excluded.drive_folder_id,raw_data=excluded.raw_data,updated_at=now();

INSERT INTO public.lessons(id,course_id,course_slug,lesson_no,title,is_section,status,sort_order,video_provider,video_url,thumbnail_url,media_urls,materials,raw_data)
VALUES
('51000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','preview-yeunauan-course-a',1,'Chương Preview Yeunauan',true,'active',1,'fixture',NULL,NULL,NULL,'[]','{}'),
('51000000-0000-4000-8000-000000000002','41000000-0000-4000-8000-000000000001','preview-yeunauan-course-a',2,'Bài Preview Yeunauan',false,'active',2,'fixture','https://media.example.test/yeunauan-main.mp4','https://media.example.test/yeunauan-thumb.webp','https://media.example.test/yeunauan-extra.webp','[{"name":"Tài liệu Preview","url":"https://media.example.test/yeunauan.pdf"}]','{"supplementalMedia":[{"url":"https://media.example.test/yeunauan-extra.webp","caption":"Ảnh phụ Preview"}]}'),
('52000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','preview-yeubep-course-a',1,'Chương Preview Yeubep',true,'active',1,'fixture',NULL,NULL,NULL,'[]','{}'),
('52000000-0000-4000-8000-000000000002','42000000-0000-4000-8000-000000000001','preview-yeubep-course-a',2,'Bài Preview Yeubep',false,'active',2,'fixture','https://media.example.test/yeubep-main.mp4','https://media.example.test/yeubep-thumb.webp','https://media.example.test/yeubep-extra.webp','[{"name":"Tài liệu Preview","url":"https://media.example.test/yeubep.pdf"}]','{"supplementalMedia":[{"url":"https://media.example.test/yeubep-extra.webp","caption":"Ảnh phụ Preview"}]}'),
('53000000-0000-4000-8000-000000000001','43000000-0000-4000-8000-000000000001','preview-legacy-canonical',1,'Bài Legacy Preview',false,'active',1,'fixture','https://media.example.test/legacy.mp4',NULL,NULL,'[]','{}')
ON CONFLICT(course_slug,lesson_no) DO UPDATE SET title=excluded.title,is_section=excluded.is_section,status=excluded.status,
 sort_order=excluded.sort_order,video_provider=excluded.video_provider,video_url=excluded.video_url,
 thumbnail_url=excluded.thumbnail_url,media_urls=excluded.media_urls,materials=excluded.materials,raw_data=excluded.raw_data,updated_at=now();

INSERT INTO public.site_config(key,value)
VALUES
('preview-yeunauan-course-a_studentDisplayTitle','{"val":"Bếp Preview A"}'),
('preview-yeunauan-course-a_subtitle','{"val":"Site yeunauan"}'),
('preview-yeubep-course-a_studentDisplayTitle','{"val":"Yêu Bếp Preview A"}'),
('preview-yeubep-course-a_subtitle','{"val":"Site yeubep"}'),
('preview-legacy-canonical_studentDisplayTitle','{"val":"Legacy Preview"}')
ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now();

INSERT INTO public.students(id,email,full_name,status)
VALUES
('61000000-0000-4000-8000-000000000001','student-a.yeunauan@example.test','Student A Yeunauan','active'),
('62000000-0000-4000-8000-000000000001','student-b.yeubep@example.test','Student B Yeubep','active'),
('63000000-0000-4000-8000-000000000001','student-no-enrollment@example.test','Student No Enrollment','active'),
('64000000-0000-4000-8000-000000000001','student-revoked@example.test','Student Revoked','active'),
('65000000-0000-4000-8000-000000000001','student-shared@example.test','Student Shared','active')
ON CONFLICT(email) DO UPDATE SET full_name=excluded.full_name,status=excluded.status,updated_at=now();

INSERT INTO public.student_enrollments(id,student_id,course_id,course_slug,email,status,normalized_email,source_system)
VALUES
('71000000-0000-4000-8000-000000000001','61000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','preview-yeunauan-course-a','student-a.yeunauan@example.test','active','student-a.yeunauan@example.test','preview'),
('72000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','preview-yeubep-course-a','student-b.yeubep@example.test','active','student-b.yeubep@example.test','preview'),
('74000000-0000-4000-8000-000000000001','64000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','preview-yeunauan-course-a','student-revoked@example.test','inactive','student-revoked@example.test','preview'),
('75000000-0000-4000-8000-000000000001','65000000-0000-4000-8000-000000000001','41000000-0000-4000-8000-000000000001','preview-yeunauan-course-a','student-shared@example.test','active','student-shared@example.test','preview'),
('75000000-0000-4000-8000-000000000002','65000000-0000-4000-8000-000000000001','42000000-0000-4000-8000-000000000001','preview-yeubep-course-a','student-shared@example.test','active','student-shared@example.test','preview')
ON CONFLICT(email,course_slug) DO UPDATE SET student_id=excluded.student_id,course_id=excluded.course_id,status=excluded.status,
 normalized_email=excluded.normalized_email,source_system=excluded.source_system,updated_at=now();

INSERT INTO public.lesson_progress(id,email,course_slug,lesson_id,progress_percent,completed,last_watched_at)
VALUES
('81000000-0000-4000-8000-000000000001','student-a.yeunauan@example.test','preview-yeunauan-course-a','51000000-0000-4000-8000-000000000002',50,false,'2026-07-29T00:00:00Z'),
('82000000-0000-4000-8000-000000000001','student-b.yeubep@example.test','preview-yeubep-course-a','52000000-0000-4000-8000-000000000002',100,true,'2026-07-29T00:00:00Z')
ON CONFLICT(email,lesson_id) DO UPDATE SET course_slug=excluded.course_slug,progress_percent=excluded.progress_percent,
 completed=excluded.completed,last_watched_at=excluded.last_watched_at,updated_at=now();

INSERT INTO public.drive_admin_accounts(id,email,display_name,status)
VALUES('91000000-0000-4000-8000-000000000001','drive-adapter.preview@example.test','Preview dry-run adapter','active')
ON CONFLICT(email) DO UPDATE SET display_name=excluded.display_name,status=excluded.status,updated_at=now();

COMMIT;
