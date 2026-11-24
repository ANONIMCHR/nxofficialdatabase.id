# NX PANEL — Turso Edition

Dashboard license/reseller berbasis HTML + Tailwind CDN + Vanilla JS, Vercel Functions, dan Turso (libSQL). Tema UI monochrome dark. Sinkronisasi dashboard memakai polling revision setiap 3 detik.

## Isi fitur

- Login staff dengan password hash bcrypt dan session cookie HttpOnly.
- Role `super_owner`, `owner`, `reseller` diperiksa di API.
- Generate license, custom key, durasi, lifetime, mute/unmute, extend, delete.
- Leaderboard, pencarian, filter, KPI, product breakdown.
- Manajemen staff dan audit log untuk owner/super owner.
- Revision polling untuk mendeteksi perubahan dari browser/staff lain.
- Endpoint verifikasi eksternal `GET/POST /api/verify` memakai header `x-api-key`.

## 1. Siapkan Turso

Install Turso CLI sesuai panduan resmi: https://docs.turso.tech/cli/installation. Jika kamu sudah punya database, pakai URL database itu dan buat token baru untuk database yang sama; jangan membuat database lain.

Perintah berikut hanya untuk membuat database baru:

```bash
turso auth login
turso db create nx-panel
turso db show nx-panel --url
turso db tokens create nx-panel
```

Simpan URL dan token yang dihasilkan. Jangan masukkan token ke file frontend atau commit ke Git.
Jika token pernah dibagikan atau ditempel di chat, revoke token tersebut di Turso lalu buat token baru sebelum digunakan.

## 2. Tabel database

Saat endpoint API pertama kali diakses, aplikasi membuat tabel `staff`, `license_keys`, `activity_logs`, dan `system_state` bila belum ada. Data license dari tabel `licenses` versi panel lama akan disalin secara aman ke `license_keys`. Tabel log lama juga akan dilengkapi kolom baru. Kamu juga bisa menjalankan `database.sql` secara manual pada database Turso yang sama.

Kolom `password` menyimpan hash bcrypt. Jika akun lama berisi password teks biasa, login pertamanya akan mengubah nilai itu menjadi hash bcrypt.

Bisa memakai Turso shell:

```bash
turso db shell nx-panel
```

Lalu paste seluruh isi `database.sql` dan tekan Enter. Alternatifnya, buka database di Turso web console dan jalankan SQL di SQL editor bila tersedia pada akunmu.

## 3. Konfigurasi lokal

Butuh Node.js 20 atau lebih baru dan Git. Di folder proyek:

```bash
npm install
```

Salin `.env.example` menjadi `.env` (Windows PowerShell):

```powershell
Copy-Item .env.example .env
```

Isi `.env` dengan kredensial Turso dan secret acak. Contoh membuat secret di PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Atur nilai berikut di `.env`:

```env
TURSO_DATABASE_URL=libsql://nama-database-nama-org.turso.io
TURSO_AUTH_TOKEN=token_dari_turso
SESSION_SECRET=hasil_secret_acak_minimal_32_karakter
BOOTSTRAP_OWNER_USERNAME=admin
BOOTSTRAP_OWNER_PASSWORD=password_unik_minimal_12_karakter
CUSTOM_API_SECRET=secret_verifikasi_acak
```

`BOOTSTRAP_OWNER_USERNAME` dan `BOOTSTRAP_OWNER_PASSWORD` hanya dipakai untuk membuat super owner pertama kali. Saat login pertama, aplikasi membuat akun bila belum ada super owner. Setelah berhasil login, hapus kedua nilai bootstrap dari environment dan jangan memakai password contoh.

Jalankan server lokal (halaman dan endpoint `/api`):

```bash
npm run dev
```

Buka http://127.0.0.1:3000. Server lokal memuat `.env` secara otomatis dan tidak membutuhkan login Vercel. Jika kredensial Turso belum diisi, endpoint API akan menjelaskan variabel yang kurang.

## 4. Deploy ke Vercel

1. Buat repository Git dan push seluruh folder proyek.
2. Import repository di https://vercel.com/new.
3. Di Project Settings → Environment Variables, tambahkan:
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `SESSION_SECRET`
   - `BOOTSTRAP_OWNER_USERNAME`
   - `BOOTSTRAP_OWNER_PASSWORD`
   - `CUSTOM_API_SECRET` (dibutuhkan endpoint `/api/verify`)
4. Deploy project.
5. Login memakai bootstrap super owner.
6. Setelah login pertama berhasil, hapus `BOOTSTRAP_OWNER_PASSWORD` dan `BOOTSTRAP_OWNER_USERNAME` dari environment Vercel lalu redeploy. Akun super owner tersimpan di database.

## 5. API ringkas

- `POST /api/auth` — login `{ action:"login", username, password }` atau logout `{ action:"logout" }`.
- `GET /api/auth` — status session.
- `GET /api/status` — revision untuk live sync (harus login).
- `GET /api/keys` — daftar license (harus login).
- `POST /api/keys` — generate license (harus login).
- `PATCH /api/keys` — mute/unmute/extend (harus login; extend khusus owner).
- `DELETE /api/keys?id=ID` — hapus license (harus login).
- `GET/POST /api/staff` — list/tambah staff (owner/super owner).
- `DELETE /api/staff?id=ID` — hapus staff sesuai RBAC.
- `GET /api/logs` — audit logs (owner/super owner).
- `POST /api/global` — global mute/unmute (owner/super owner).
- `GET/POST /api/verify` — verifikasi license dengan header `x-api-key: CUSTOM_API_SECRET` dan parameter `key`, `panel`.

Contoh verify:

```bash
curl -H "x-api-key: YOUR_CUSTOM_API_SECRET" \
  "https://your-domain.vercel.app/api/verify?key=NX-ABCD-EFGH-JKLM&panel=PANEL%20V1"
```

## 6. Catatan real-time dan keamanan

Turso adalah database SQLite-compatible/libSQL dan bukan Supabase Realtime. UI ini mengecek `system_state.revision` setiap 3 detik, lalu mengambil ulang data bila revision berubah. Ini mendekati real-time, bukan push subscription instan. Untuk skala besar, pertimbangkan SSE/WebSocket melalui layanan realtime terpisah.

- API server-side yang menyimpan token Turso; frontend tidak pernah menerima token.
- Cookie session ditandatangani HMAC, HttpOnly, Secure, SameSite=Lax, masa berlaku 8 jam.
- Semua query menggunakan parameter binding.
- Aksi penting ditulis ke `activity_logs` dan menaikkan revision.
- Untuk produksi, gunakan HTTPS, secret unik, backup database, rate limiting login di edge/WAF, dan audit akses.
- Endpoint verify memerlukan `CUSTOM_API_SECRET` server-side. Jangan mengirimkannya dari browser publik.

## 7. Keterbatasan versi awal

UI sudah mencakup dashboard, CRUD utama, staff, logs, dan polling. Fitur extend memakai input browser sederhana. Sistem ini belum menyediakan password reset, MFA, pagination server-side, rate limiting bawaan, atau SSE. Tambahkan sebelum penggunaan skala besar/produksi dengan kebutuhan compliance.
