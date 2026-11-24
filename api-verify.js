import { db } from "./db.js";
import crypto from "node:crypto";
export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ valid: false, error: "Method not allowed" });
  const secret = process.env.CUSTOM_API_SECRET;
  const supplied = req.headers['x-api-key'];
  if (!secret || typeof supplied !== 'string' || supplied.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) return res.status(401).json({ valid: false, error: "Unauthorized" });
  const key = String(req.method === 'GET' ? req.query?.key : req.body?.key || '').trim().toUpperCase();
  const panel = String(req.method === 'GET' ? req.query?.panel : req.body?.panel || '').trim().toUpperCase();
  if (!key || !panel) return res.status(400).json({ valid: false, error: "Key dan panel wajib diisi." });
  try {
    const r = await db.execute({ sql: "SELECT key_code AS license_key,product,is_muted,is_lifetime,expired_at FROM license_keys WHERE key_code=? AND product=?", args: [key, panel] });
    const row = r.rows[0];
    const expired = row && !row.is_lifetime && (!row.expired_at || new Date(row.expired_at).getTime() <= Date.now());
    const status = !row ? "NOT_FOUND" : row.is_muted ? "MUTED" : expired ? "EXPIRED" : "ACTIVE";
    const valid = !!row && status === 'ACTIVE';
    return res.status(200).json({ valid, status, product: row?.product || null, expiresAt: row?.expired_at || null });
  } catch (e) { console.error(e); return res.status(500).json({ valid: false, error: "Verification unavailable" }); }
}
