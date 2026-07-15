// utils/v3-handlers/public-config.js
// V3 Phase 5 (⑥) — edge-runtime-safe read-only handler.
//
// Returns the public Google client id (same shape as the V1 public-config
// handler). No Node-only imports in the hot path (no googleapis/cloudinary/fs),
// so this route can run on the Vercel Edge Runtime for low latency.

import { applyCors } from "../cors.js";

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "public",
    methods: "GET, OPTIONS",
    allowedHeaders: "Content-Type",
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
  });
}

// Declare edge runtime for this route's cold start. Other V3 read routes can
// opt in once their hot path is Node-dep-free.
export const runtime = "edge";
