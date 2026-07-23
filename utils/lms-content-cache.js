const RECIPE_TTL_MS = 60_000;
const RECIPE_CACHE_MAX = 200;

const recipeTextCache = new Map();
const recipeTextInflight = new Map();

function normalizeKey(value) {
  return String(value || "").trim();
}

function getFreshRecipeEntry(key, now) {
  const entry = recipeTextCache.get(key);
  if (!entry) return null;
  if (now - entry.fetchedAt > RECIPE_TTL_MS) {
    recipeTextCache.delete(key);
    return null;
  }
  return entry;
}

function setRecipeEntry(key, text, now) {
  if (!key || !text) return;
  if (recipeTextCache.size >= RECIPE_CACHE_MAX) {
    const oldest = recipeTextCache.keys().next().value;
    if (oldest) recipeTextCache.delete(oldest);
  }
  recipeTextCache.set(key, { text, fetchedAt: now });
}

// Both course-data and lesson handlers are bundled into api/lms/portal.
// Sharing this module lets the click-to-lesson request reuse recipe content
// that the authenticated course-data request fetched moments earlier.
// Authorization is still checked by each handler before this cache is read.
export async function getOrLoadLmsRecipeText(recipeUrl, loader, {
  now = Date.now()
} = {}) {
  const key = normalizeKey(recipeUrl);
  if (!key) return "";
  if (typeof loader !== "function") throw new TypeError("loader must be a function");

  const cached = getFreshRecipeEntry(key, now);
  if (cached) return cached.text;

  const inflight = recipeTextInflight.get(key);
  if (inflight) return inflight;

  const loadPromise = Promise.resolve()
    .then(loader)
    .then((value) => {
      const text = String(value || "");
      setRecipeEntry(key, text, Date.now());
      return text;
    })
    .finally(() => {
      if (recipeTextInflight.get(key) === loadPromise) {
        recipeTextInflight.delete(key);
      }
    });

  recipeTextInflight.set(key, loadPromise);
  return loadPromise;
}

export function resetLmsContentCacheForTests() {
  recipeTextCache.clear();
  recipeTextInflight.clear();
}
