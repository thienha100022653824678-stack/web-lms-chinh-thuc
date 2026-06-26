import adminAuthHandler from "../../utils/lms-handlers/admin-auth.js";
import adminDriveAuthHandler from "../../utils/lms-handlers/admin-drive-auth.js";
import adminCoursesHandler from "../../utils/lms-handlers/admin-courses.js";
import adminLessonsHandler from "../../utils/lms-handlers/admin-lessons.js";
import adminStudentsHandler from "../../utils/lms-handlers/admin-students.js";
import adminEnrollmentsHandler from "../../utils/lms-handlers/admin-enrollments.js";
import adminUploadImageHandler from "../../utils/lms-handlers/admin-upload-image.js";
import adminUploadRecipeHandler from "../../utils/lms-handlers/admin-upload-recipe.js";
import adminBulkEnrollHandler from "../../utils/lms-handlers/admin-bulk-enroll.js";

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4.5mb",
    },
  },
};

export default async function handler(req, res) {
  const { endpoint } = req.query || {};

  if (endpoint === "auth") {
    return adminAuthHandler(req, res);
  }
  if (endpoint === "drive-auth") {
    return adminDriveAuthHandler(req, res);
  }
  if (endpoint === "courses") {
    return adminCoursesHandler(req, res);
  }
  if (endpoint === "lessons") {
    return adminLessonsHandler(req, res);
  }
  if (endpoint === "students") {
    return adminStudentsHandler(req, res);
  }
  if (endpoint === "enrollments") {
    return adminEnrollmentsHandler(req, res);
  }
  if (endpoint === "upload-image") {
    return adminUploadImageHandler(req, res);
  }
  if (endpoint === "upload-recipe") {
    return adminUploadRecipeHandler(req, res);
  }
  if (endpoint === "bulk-enroll") {
    return adminBulkEnrollHandler(req, res);
  }

  return res.status(404).json({ success: false, error: "LMS Admin Endpoint not found" });
}
