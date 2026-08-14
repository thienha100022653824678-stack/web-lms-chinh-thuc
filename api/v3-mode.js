import { getV3PresentationSnapshot } from "../utils/v3-presentation-controller.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, effectiveMode: "v1", error: "method_not_allowed" });
  }
  try {
    const state = await getV3PresentationSnapshot();
    return res.status(200).json({
      success: true,
      configuredMode: state.configuredMode,
      effectiveMode: state.effectiveMode,
      globalKillSwitch: state.globalKillSwitch,
      v3KillSwitch: state.v3KillSwitch,
      ok: state.ok,
      source: state.source
    });
  } catch {
    return res.status(200).json({
      success: false,
      configuredMode: "v1",
      effectiveMode: "v1",
      globalKillSwitch: false,
      v3KillSwitch: true,
      ok: false,
      source: "fail_safe"
    });
  }
}
