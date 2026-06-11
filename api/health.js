import { methodNotAllowed } from "./_lib.js";

export default function handler(req, res) {
  if (req.method !== "GET") return methodNotAllowed(res, ["GET"]);
  res.status(200).json({ ok: true, time: new Date().toISOString() });
}
