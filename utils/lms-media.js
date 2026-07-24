const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);
const IMAGE_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "jfif",
  "png",
  "webp",
  "gif",
  "avif",
  "heic",
  "heif",
  "bmp",
  "svg",
  "tif",
  "tiff"
]);

function extractIframeSrc(input) {
  const text = String(input || "").trim();
  const match = text.match(/<iframe[^>]+src=["']([^"']+)["']/i);
  return match?.[1] ? match[1].trim() : text;
}

export function getGoogleDriveFileId(input) {
  const text = extractIframeSrc(String(input || "")).trim();
  let match = text.match(/drive\.google\.com\/file\/d\/([^/?#]+)/);
  if (match) return match[1];
  match = text.match(/[?&]id=([^&#]+)/);
  if (match) return match[1];
  return "";
}

function extensionFromText(value) {
  const text = extractIframeSrc(String(value || "")).replace(/&amp;/g, "&").trim();
  if (!text) return "";

  const plainMatch = text.match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i);
  if (plainMatch) return plainMatch[1].toLowerCase();

  try {
    const parsed = new URL(text);
    const pathMatch = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (pathMatch) return pathMatch[1].toLowerCase();
  } catch {}

  return "";
}

export function classifyMediaType({ url = "", mimeType = "", name = "" } = {}) {
  const mime = String(mimeType || "").toLowerCase().trim();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";

  const ext = extensionFromText(name) || extensionFromText(url);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";

  return "unknown";
}

export async function resolveMainMediaInfo(url, fetchDriveMetadata) {
  const rawUrl = String(url || "").trim();
  if (!rawUrl) {
    return { mainMediaType: "none", mainMediaMimeType: "", mainMediaName: "" };
  }

  const localType = classifyMediaType({ url: rawUrl });
  if (localType !== "unknown") {
    return { mainMediaType: localType, mainMediaMimeType: "", mainMediaName: "" };
  }

  const fileId = getGoogleDriveFileId(rawUrl);
  if (!fileId || typeof fetchDriveMetadata !== "function") {
    return { mainMediaType: "unknown", mainMediaMimeType: "", mainMediaName: "" };
  }

  try {
    let metadata = await fetchDriveMetadata(fileId);
    if (metadata?.mimeType === "application/vnd.google-apps.shortcut" && metadata?.shortcutDetails?.targetId) {
      metadata = await fetchDriveMetadata(metadata.shortcutDetails.targetId);
    }

    const mainMediaType = classifyMediaType({
      url: rawUrl,
      mimeType: metadata?.mimeType || "",
      name: metadata?.name || ""
    });

    return {
      mainMediaType,
      mainMediaMimeType: metadata?.mimeType || "",
      mainMediaName: metadata?.name || ""
    };
  } catch (err) {
    return { mainMediaType: "unknown", mainMediaMimeType: "", mainMediaName: "" };
  }
}
