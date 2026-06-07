# Demo: Kenapa Koneksi PostgreSQL Mahal & Peran PgBouncer

Demo pendukung sharing session. Tiga skenario membuktikan klaim slide secara live,
jalan lokal & reproducible pakai **Bun** + **postgres.js** + **podman-compose**.

## Prasyarat
- [Bun](https://bun.sh) 1.3+
- Podman + podman-compose (di mac: jalankan `podman machine start` dulu)
- `psql` (opsional, buat cek manual)

## Setup
```bash
podman machine start          # kalau VM podman belum jalan
bun install
bun run db:up                 # Postgres (max_connections=20) + PgBouncer
```

Cek siap:
```bash
psql postgres://demo:demo@localhost:5433/demo -tAc "show max_connections"   # 20
psql postgres://demo:demo@localhost:6432/demo_tx -tAc "select 1"            # 1
```

> Catatan: Postgres container dipetakan ke host port **5433** (bukan 5432) supaya
> tidak bentrok dengan PostgreSQL lokal yang mungkin sudah jalan di 5432.

## Jalankan demo (urut sesuai slide)

| Perintah | Skenario | Slide |
|---|---|---|
| `bun run demo:cost`       | Satu koneksi = satu proses OS (RAM per koneksi)    | 5 |
| `bun run demo:exhaustion` | Exhaustion langsung vs PgBouncer yang tetap datar  | 10, 13 |
| `bun run demo:bug`        | Bug prepared statement + fix `prepare:false`       | 2, 16-19 |

Output ketiganya naratif Bahasa Indonesia.

### Apa yang dibuktikan tiap skenario
- **demo:cost** — buka 10 koneksi langsung, tampilkan 10 PID backend + RSS (~MB)
  tiap proses lewat `/proc`. Koneksi = proses fork, bukan sekadar socket.
- **demo:exhaustion** — 30 "pod": mode DIRECT sebagian kena `too many clients`
  (max_connections=20); mode POOLER semua sukses, koneksi nyata ke Postgres tetap
  ~5 (dibatasi `default_pool_size`).
- **demo:bug** — `PREPARE` lalu `EXECUTE` (di-pin ke satu koneksi via `reserve()`):
  - KASUS 1 transaction mode → ❌ `26000 prepared statement does not exist`
  - KASUS 2 session mode → ✅ (koneksi server dipegang sepanjang sesi)
  - KASUS 3 transaction mode + `prepare:false` (query langsung) → ✅ (fix Slide 19)

Knob opsional: `N=20 bun run demo:cost`, `PODS=40 bun run demo:exhaustion`,
`OPS=100 bun run demo:bug`.

## Bersih-bersih
```bash
bun run db:down               # hapus container + volume
```

## Arsitektur
- direct → Postgres langsung (host port **5433**)
- `demo_tx`      → PgBouncer **transaction** mode (port 6432)
- `demo_session` → PgBouncer **session** mode (port 6432)

Satu PgBouncer, dua alias database dengan `pool_mode` di-override per-database
(lihat `pgbouncer/pgbouncer.ini`).

## Catatan akurasi
- `max_connections=20` adalah angka demo biar exhaustion cepat kelihatan, bukan
  rekomendasi produksi.
- postgres.js modern **auto-retry** untuk prepared statement *implisit*, jadi bug
  paling jelas diperlihatkan lewat prepared statement *eksplisit* (`PREPARE`/
  `EXECUTE`) — yang mekanismenya persis dengan Slide 18. Prinsip & rekomendasinya
  (pakai `prepare:false` saat lewat transaction pooler) tetap sama.

## Troubleshooting
- **Cannot connect to Podman** → `podman machine start`.
- **port 5433/6432 sudah dipakai** → ubah mapping port di `compose.yaml` lalu
  sesuaikan URL di `.env` / `src/config.ts`.
- **PgBouncer gagal start** → `podman logs demo-pgbouncer`; pastikan
  `auth_type=plain` cocok dengan isi `userlist.txt`.
- **Image lama ke-cache** → `bun run db:down && podman pull postgres:18 && podman pull edoburu/pgbouncer:latest`.
