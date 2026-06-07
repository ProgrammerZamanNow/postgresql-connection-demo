# Demo: Kenapa Koneksi PostgreSQL Mahal & Peran PgBouncer

Tanggal: 2026-06-07
Status: Disetujui (menunggu review spec)

## Tujuan

Demo pendukung sharing session `sharing-session-postgresql-pgbouncer.md`. Memberi
**bukti hidup** untuk tiga klaim inti slide, dijalankan live di laptop secara
offline dan reproducible.

Sumber materi: `/Users/khannedy/Downloads/sharing-session-postgresql-pgbouncer.md`

## Stack & Tooling

- **Runtime**: Bun 1.3.x (bukan npm/node).
- **DB client**: `postgres` (postgres.js) — supaya kode identik dengan slide
  (`postgres(URL, { prepare: false })`).
- **Orkestrasi**: `podman-compose` (alias `docker` = podman). Butuh
  `podman machine start` lebih dulu.
- **Output**: naratif Bahasa Indonesia, mengikuti tone slide.

## Arsitektur Infra (compose.yaml)

Dua service:

1. **postgres** — image `postgres:18`.
   - `command: -c max_connections=20` (sengaja kecil supaya exhaustion cepat
     terlihat saat live demo).
   - Buat database `demo`, user `demo`/`demo`.
2. **pgbouncer** — image `edoburu/pgbouncer` (config via file yang di-mount).
   - **Satu** instance, dua entri `[databases]` yang menunjuk ke DB `demo` yang
     sama, dengan `pool_mode` di-override per-database:
     - `demo_tx`  → `pool_mode=transaction`
     - `demo_session` → `pool_mode=session`
   - `default_pool_size=5`, `max_client_conn=500`.
   - Listen port `6432`.

### File config PgBouncer

- `pgbouncer/pgbouncer.ini` — `[databases]` (dua alias), `[pgbouncer]`
  (auth_type, pool sizes, listen).
- `pgbouncer/userlist.txt` — kredensial `"demo" "demo"` (md5/plain sesuai
  auth_type yang dipilih; gunakan `auth_type = plain` atau md5 hash).

### Connection string (src/config.ts)

| Nama env            | Target                          | Kegunaan                    |
|---------------------|---------------------------------|-----------------------------|
| `DIRECT_URL`        | `localhost:5432/demo`           | Koneksi langsung ke Postgres |
| `POOLER_TX_URL`     | `localhost:6432/demo_tx`        | PgBouncer transaction mode  |
| `POOLER_SESSION_URL`| `localhost:6432/demo_session`   | PgBouncer session mode      |

`config.ts` juga menyimpan util cetak naratif (header skenario, garis pemisah,
penanda ✅/❌) supaya output konsisten dan enak dilihat saat presentasi.

## Struktur Project

```
postgresql-connection-demo/
├── compose.yaml
├── pgbouncer/
│   ├── pgbouncer.ini
│   └── userlist.txt
├── src/
│   ├── config.ts              # URL koneksi + util cetak naratif + seed schema
│   ├── 01-connection-cost.ts  # Skenario 1
│   ├── 02-exhaustion.ts       # Skenario 2
│   └── 03-prepared-bug.ts     # Skenario 3
├── package.json               # bun scripts
├── .env.example
├── .gitignore
└── README.md
```

## Skenario

### Skenario 1 — Cost koneksi = proses OS (Slide 5)

Tujuan: buktikan satu koneksi Postgres = satu proses OS ber-RAM ~MB, bukan
sekadar socket.

Langkah (`src/01-connection-cost.ts`):
1. Buka N (mis. 10) koneksi langsung ke `DIRECT_URL`, masing-masing klien
   `postgres(..., { max: 1 })` agar 1 koneksi nyata per klien, dan tahan tetap
   terbuka (jalankan `SELECT pg_backend_pid()`).
2. Query `pg_stat_activity` → tampilkan jumlah backend + daftar `pid`.
3. Jalankan `podman exec <postgres> ps -o pid,rss,cmd -C postgres` (via
   `Bun.spawn`) → tampilkan tiap backend process + RSS, dan total RAM.
4. Narasi: "10 koneksi = 10 proses = ~X MB. `max_connections` default cuma 100."

Output diharapkan: jumlah proses postgres backend ≈ jumlah koneksi yang dibuka,
masing-masing punya RSS terukur.

### Skenario 2 — Exhaustion & penyelamatan oleh pooler (Slide 10, 13)

Tujuan: tunjukkan koneksi langsung menembus `max_connections` (error), sedangkan
lewat pooler tidak (ngantri, koneksi nyata tetap datar).

Langkah (`src/02-exhaustion.ts`):
1. **Mode DIRECT**: simulasi "pod" — buka ~30 koneksi paralel ke `DIRECT_URL`
   (di atas `max_connections=20`). Hitung sukses vs gagal. Sebagian gagal dengan
   `FATAL: sorry, too many clients already` (SQLSTATE 53300). Cetak ringkasan.
2. **Mode POOLER (transaction)**: buka ~30 koneksi paralel ke `POOLER_TX_URL`,
   masing-masing jalankan query singkat. Semua sukses. Query `pg_stat_activity`
   → koneksi nyata ke Postgres tetap ≈ `default_pool_size` (5).
3. Cetak perbandingan berdampingan: DIRECT (sebagian ❌) vs POOLER (semua ✅,
   koneksi backend datar).

Output diharapkan: DIRECT punya kegagalan 53300; POOLER nol kegagalan dengan
backend Postgres ≈5.

### Skenario 3 — Bug prepared statement + fix (Slide 2, 17-19), bandingkan mode

Tujuan: reproduksi bug pembuka cerita dan tunjukkan fix satu baris, sekaligus
membuktikan bug hanya muncul di transaction mode.

Schema: tabel `notes(id serial primary key, body text)` (di-seed di awal).

Tiga kasus, dijalankan berurutan dengan output jelas:
1. **Transaction mode + `prepare: true` (default)** via `POOLER_TX_URL`:
   jalankan workload (loop INSERT ... RETURNING + SELECT, paralel) yang memaksa
   koneksi server gonta-ganti antar transaksi → muncul error
   `prepared statement "..." does not exist` / kegagalan. Tandai ❌.
   - Usaha tambahan (best-effort, tidak di-over-claim): tunjukkan kasus di mana
     `RETURNING` sempat mengembalikan baris padahal commit gagal → data tidak
     ada saat di-SELECT ulang (silent loss). Jika tidak stabil, cukup tunjukkan
     error eksplisitnya.
2. **Session mode + `prepare: true`** via `POOLER_SESSION_URL`: workload sama →
   lancar ✅. Membuktikan bug spesifik ke transaction mode (Slide 16).
3. **Transaction mode + `prepare: false`** via `POOLER_TX_URL`: workload sama →
   lancar ✅. Fix satu baris: `postgres(URL, { prepare: false })` (Slide 19).

Output diharapkan: kasus 1 ❌ (error prepared statement), kasus 2 & 3 ✅.

## Bun Scripts (package.json)

- `db:up`    → `podman-compose up -d`
- `db:down`  → `podman-compose down -v`
- `db:logs`  → `podman-compose logs -f`
- `demo:cost`       → `bun run src/01-connection-cost.ts`
- `demo:exhaustion` → `bun run src/02-exhaustion.ts`
- `demo:bug`        → `bun run src/03-prepared-bug.ts`

## README

Urutan demo mengikuti alur slide:
1. Prasyarat: `podman machine start`, lalu `bun install`.
2. `bun run db:up` (+ cara cek pgbouncer siap).
3. Jalankan `demo:cost` → `demo:exhaustion` → `demo:bug`, masing-masing
   dipetakan ke nomor slide terkait.
4. `bun run db:down` untuk bersih-bersih.
5. Bagian troubleshooting (podman machine mati, port bentrok, image pull).

## Strategi Verifikasi

Ini project demo (bukan library berlogika), jadi verifikasi = menjalankan tiap
skenario terhadap container asli dan mengamati output yang diharapkan di atas:
- Skenario 1: jumlah proses backend ≈ jumlah koneksi, RSS terukur.
- Skenario 2: DIRECT ada error 53300; POOLER nol error, backend ≈5.
- Skenario 3: kasus 1 error prepared statement; kasus 2 & 3 sukses.

Setiap skenario dijalankan saat build sebelum diklaim selesai.

## Hal yang Sengaja TIDAK Dikerjakan (YAGNI)

- Tidak pakai Supabase/cloud (offline & reproducible diutamakan).
- Tidak ada skenario benchmark throughput/latency.
- Tidak ada UI/web — murni CLI naratif.

## Risiko & Kejujuran

- Repro *silent data loss* yang persis bergantung timing; deliverable yang
  dijamin adalah error prepared-statement yang muncul di transaction mode dan
  hilang di session mode / `prepare:false`. Versi silent-loss bersifat
  best-effort dan tidak akan di-over-claim jika tidak stabil.
- `max_connections=20` adalah nilai demo, bukan rekomendasi produksi.
