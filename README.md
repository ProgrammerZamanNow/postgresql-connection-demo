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

## Jalankan demo (6 kasus, urut sesuai slide)

| Perintah | Kasus | Hasil | Slide |
|---|---|---|---|
| `bun run kasus:1` | Satu koneksi = satu proses OS (RAM per koneksi) | 10 proses ~16 MB | 5 |
| `bun run kasus:2` | Koneksi langsung menembus `max_connections` | ❌ `53300 too many clients` | 10, 13 |
| `bun run kasus:3` | Lewat PgBouncer → koneksi nyata tetap datar | ✅ semua lolos, backend ~5 | 13 |
| `bun run kasus:4` | Prepared statement di **transaction** mode | ❌ `26000 does not exist` | 18 |
| `bun run kasus:5` | Prepared statement di **session** mode | ✅ sukses | 16 |
| `bun run kasus:6` | Fix: `prepare:false` di transaction mode | ✅ sukses | 19 |

Output naratif Bahasa Indonesia. Tiap kasus berdiri sendiri (perintah terpisah).

### Apa yang dibuktikan tiap kasus
- **kasus:1** — buka 10 koneksi langsung, tampilkan 10 PID backend + RSS (~MB) tiap
  proses lewat `/proc`. Koneksi = proses fork, bukan sekadar socket.
- **kasus:2** — 30 "pod" konek langsung; sebagian kena `too many clients`
  (`max_connections=20`). Pesan error mentahnya ditampilkan.
- **kasus:3** — 30 "pod" yang sama lewat PgBouncer: semua lolos (ngantri, bukan
  error), koneksi nyata ke Postgres tetap ~5 (dibatasi `default_pool_size`).
- **kasus:4** — `PREPARE` lalu `EXECUTE` (di-pin ke satu koneksi via `reserve()`)
  di transaction mode → ❌ `26000 prepared statement does not exist`.
- **kasus:5** — workload sama di session mode → ✅ (koneksi server dipegang
  sepanjang sesi). Bukti: bug spesifik ke transaction mode.
- **kasus:6** — transaction mode + `prepare:false` (query langsung) → ✅ fix Slide 19.

Knob opsional: `N=20 bun run kasus:1`, `PODS=40 bun run kasus:2`,
`OPS=100 bun run kasus:4`.

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
