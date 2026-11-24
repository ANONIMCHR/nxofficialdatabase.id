import { createClient } from "@libsql/client";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const databaseUrl = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
if (!databaseUrl || !authToken) {
  throw new Error("Turso belum dikonfigurasi. Isi TURSO_DATABASE_URL dan TURSO_AUTH_TOKEN di environment.");
}
export const db = createClient({
  url: databaseUrl,
  authToken
});

export const ready = (async () => {
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS staff (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('super_owner','owner','reseller')))` },
    { sql: `CREATE TABLE IF NOT EXISTS license_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key_code TEXT NOT NULL UNIQUE, user_name TEXT NOT NULL, product TEXT NOT NULL, expired_at TEXT, is_lifetime INTEGER DEFAULT 0, is_muted INTEGER DEFAULT 0, muted_by TEXT, muted_by_role TEXT, created_by TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP)` },
    { sql: `CREATE TABLE IF NOT EXISTS activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, staff_username TEXT NOT NULL, staff_role TEXT NOT NULL, action TEXT NOT NULL, target TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` },
    { sql: `CREATE TABLE IF NOT EXISTS system_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)` },
    { sql: `INSERT OR IGNORE INTO system_state(id,revision) VALUES(1,0)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_license_keys_product ON license_keys(product)` },
    { sql: `CREATE INDEX IF NOT EXISTS idx_license_keys_created ON license_keys(created_at)` }
  ], "write");
  const logColumns = await db.execute("PRAGMA table_info(activity_logs)");
  const columnNames = new Set(logColumns.rows.map(column => column.name));
  if (!columnNames.has("staff_username")) {
    if (!columnNames.has("actor_username") || !columnNames.has("actor_role")) {
      throw new Error("Struktur activity_logs tidak dikenali; data tidak diubah.");
    }
    const tableResult = await db.execute("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = new Set(tableResult.rows.map(row => row.name));
    let legacyTable = "activity_logs_legacy";
    let suffix = 1;
    // Keep older backups intact when multiple schema versions are present.
    while (tableNames.has(legacyTable)) legacyTable = `activity_logs_legacy_${suffix++}`;
    await db.execute(`ALTER TABLE activity_logs RENAME TO "${legacyTable}"`);
    await db.execute("CREATE TABLE activity_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, staff_id INTEGER, staff_username TEXT NOT NULL, staff_role TEXT NOT NULL, action TEXT NOT NULL, target TEXT, details TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)");
    await db.execute(`INSERT OR IGNORE INTO activity_logs(id,staff_username,staff_role,action,details,created_at) SELECT id,actor_username,actor_role,action,detail,COALESCE(created_at,CURRENT_TIMESTAMP) FROM "${legacyTable}"`);
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_activity_logs_created_app ON activity_logs(created_at)");
  // Import rows from the previous panel schema once, while preserving existing keys.
  const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='licenses'");
  if (tables.rows.length) {
    await db.execute(`INSERT OR IGNORE INTO license_keys(key_code,user_name,product,expired_at,is_lifetime,is_muted,muted_by,created_by,created_at)
      SELECT license_key,username,product,expired_at,is_lifetime,CASE WHEN status='MUTED' THEN 1 ELSE 0 END,
      CAST(muted_by AS TEXT),CAST(created_by AS TEXT),created_at FROM licenses`);
  }
})();
await ready;
const COOKIE = "nx_session";
const secret = process.env.SESSION_SECRET;
if (process.env.VERCEL && (!secret || secret.length < 32)) {
  console.warn("SESSION_SECRET must be at least 32 characters in production.");
}
function sign(value) {
  if (!secret || secret.length < 32) throw new Error("SESSION_SECRET belum dikonfigurasi dengan benar.");
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}
export function setSession(res, staff) {
  const payload = Buffer.from(JSON.stringify({ id: staff.id, username: staff.username, role: staff.role, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=28800`);
}
export function clearSession(res) {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly${secure}; SameSite=Lax; Path=/; Max-Age=0`);
}
export function getSession(req) {
  const raw = req.headers.cookie || "";
  const token = raw.split(";").map(v => v.trim()).find(v => v.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}
export function requireSession(req, res) {
  const session = getSession(req);
  if (!session) { res.status(401).json({ error: "Silakan login kembali." }); return null; }
  return session;
}
export function requireRole(session, roles, res) {
  if (!roles.includes(session.role)) { res.status(403).json({ error: "Akses ditolak." }); return false; }
  return true;
}
export async function audit(session, action, target = "", details = "") {
  await db.batch([
    { sql: "INSERT INTO activity_logs(staff_id,staff_username,staff_role,action,target,details) VALUES(?,?,?,?,?,?)", args: [session.id, session.username, session.role, action, String(target), String(details)] },
    { sql: "UPDATE system_state SET revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1", args: [] }
  ], "write");
}
export async function bootstrapOwner() {
  await ready;
  const username = process.env.BOOTSTRAP_OWNER_USERNAME;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD;
  if (!username || !password) return;
  const existing = await db.execute("SELECT id FROM staff WHERE role='super_owner' LIMIT 1");
  if (existing.rows.length) return;
  if (password.length < 12) throw new Error("BOOTSTRAP_OWNER_PASSWORD minimal 12 karakter.");
  const hash = await bcrypt.hash(password, 12);
  await db.execute({ sql: "INSERT INTO staff(username,password,role) VALUES(?,?, 'super_owner')", args: [username, hash] });
}
export { bcrypt };
