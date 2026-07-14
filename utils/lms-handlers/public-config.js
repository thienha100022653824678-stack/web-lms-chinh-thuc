import { applyCors } from "../cors.js";

export default async function handler(req, res) {
  const cors = applyCors(req, res, {
    mode: "public",
    methods: "GET, OPTIONS",
    allowedHeaders: "Content-Type"
  });
  if (cors.handled) return res.status(cors.status).json(cors.body);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  res.status(200).json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || ""
  });
}
