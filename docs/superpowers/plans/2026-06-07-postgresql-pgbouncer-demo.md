# Demo PostgreSQL Connection Cost & PgBouncer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, reproducible CLI demo (Bun + postgres.js + podman-compose) that proves three slide claims: (1) a PostgreSQL connection is an OS process, (2) scale-out exhausts `max_connections` while PgBouncer keeps it flat, (3) prepared statements break in transaction pooling and `prepare:false` fixes it.

**Architecture:** `podman-compose` runs Postgres (`max_connections=20`) + one PgBouncer exposing two database aliases with per-database `pool_mode` (`demo_tx`=transaction, `demo_session`=session). Three Bun TypeScript scripts connect via direct/transaction/session URLs and print Indonesian narrative output. Verification = running each scenario against the real containers and observing expected output (this is a demo, not a logic library, so "the test" is the live run).

**Tech Stack:** Bun 1.3, `postgres` (postgres.js) ^3.4, `postgres:18` image, `edoburu/pgbouncer` image, podman-compose.

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | Bun scripts (`db:up/down/logs`, `demo:cost/exhaustion/bug`), dep `postgres` |
| `.env.example` | Connection URLs + container name |
| `compose.yaml` | postgres + pgbouncer services, explicit container names |
| `pgbouncer/pgbouncer.ini` | two `[databases]` aliases w/ per-db pool_mode |
| `pgbouncer/userlist.txt` | `"demo" "demo"` (auth_type=plain) |
| `src/config.ts` | URLs, narrative print utils, `sleep`, `countBackends`, `resetSchema` |
| `src/01-connection-cost.ts` | Scenario 1 |
| `src/02-exhaustion.ts` | Scenario 2 |
| `src/03-prepared-bug.ts` | Scenario 3 |
| `README.md` | run order mapped to slides + troubleshooting |

---

## Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `.env.example`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "postgresql-connection-demo",
  "private": true,
  "type": "module",
  "scripts": {
    "db:up": "podman-compose up -d",
    "db:down": "podman-compose down -v",
    "db:logs": "podman-compose logs -f",
    "demo:cost": "bun run src/01-connection-cost.ts",
    "demo:exhaustion": "bun run src/02-exhaustion.ts",
    "demo:bug": "bun run src/03-prepared-bug.ts"
  },
  "dependencies": {
    "postgres": "^3.4.5"
  }
}
```

- [ ] **Step 2: Write `.env.example`**

```
DIRECT_URL=postgres://demo:demo@localhost:5432/demo
POOLER_TX_URL=postgres://demo:demo@localhost:6432/demo_tx
POOLER_SESSION_URL=postgres://demo:demo@localhost:6432/demo_session
POSTGRES_CONTAINER=demo-postgres
```

- [ ] **Step 3: Install dependency**

Run: `bun install`
Expected: creates `node_modules/` and `bun.lockb`, installs `postgres`.

- [ ] **Step 4: Commit**

```bash
git add package.json .env.example bun.lockb
git commit -m "chore: scaffold bun project with postgres.js"
```

---

## Task 2: Infra — Postgres + PgBouncer via podman-compose

**Files:**
- Create: `compose.yaml`
- Create: `pgbouncer/pgbouncer.ini`
- Create: `pgbouncer/userlist.txt`

- [ ] **Step 1: Write `compose.yaml`**

```yaml
services:
  postgres:
    image: postgres:18
    container_name: demo-postgres
    environment:
      POSTGRES_USER: demo
      POSTGRES_PASSWORD: demo
      POSTGRES_DB: demo
    command: ["postgres", "-c", "max_connections=20"]
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U demo -d demo"]
      interval: 2s
      timeout: 3s
      retries: 30

  pgbouncer:
    image: edoburu/pgbouncer:latest
    container_name: demo-pgbouncer
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./pgbouncer/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro,z
      - ./pgbouncer/userlist.txt:/etc/pgbouncer/userlist.txt:ro,z
    ports:
      - "6432:6432"
```

- [ ] **Step 2: Write `pgbouncer/pgbouncer.ini`**

```ini
[databases]
demo_tx = host=postgres port=5432 dbname=demo pool_mode=transaction
demo_session = host=postgres port=5432 dbname=demo pool_mode=session

[pgbouncer]
listen_addr = 0.0.0.0
listen_port = 6432
auth_type = plain
auth_file = /etc/pgbouncer/userlist.txt
pool_mode = transaction
default_pool_size = 5
max_client_conn = 500
admin_users = demo
ignore_startup_parameters = extra_float_digits,options,search_path
```

- [ ] **Step 3: Write `pgbouncer/userlist.txt`**

```
"demo" "demo"
```

- [ ] **Step 4: Start the Podman machine (host prerequisite)**

Run: `podman machine start`
Expected: machine reports running (skip if already up — `podman machine list` shows `Currently running`).

- [ ] **Step 5: Bring up the stack**

Run: `bun run db:up`
Expected: both `demo-postgres` and `demo-pgbouncer` created and started.

- [ ] **Step 6: Verify Postgres is reachable and max_connections is 20**

Run: `psql postgres://demo:demo@localhost:5432/demo -tAc "show max_connections"`
Expected: `20`

- [ ] **Step 7: Verify BOTH pooler aliases work**

Run:
```bash
psql postgres://demo:demo@localhost:6432/demo_tx -tAc "select 1"
psql postgres://demo:demo@localhost:6432/demo_session -tAc "select 1"
```
Expected: each prints `1`.

If the pooler fails to authenticate or start, check `podman logs demo-pgbouncer`. Common fixes: ensure `auth_type = plain` matches the plaintext `userlist.txt`; if the edoburu entrypoint ignores the mounted ini, add `command: ["/usr/bin/pgbouncer", "/etc/pgbouncer/pgbouncer.ini"]` to the pgbouncer service, or switch image to `bitnami/pgbouncer` with the same mounted files.

- [ ] **Step 8: Commit**

```bash
git add compose.yaml pgbouncer/
git commit -m "feat: postgres + pgbouncer (tx & session aliases) via podman-compose"
```

---

## Task 3: Shared config & helpers

**Files:**
- Create: `src/config.ts`

- [ ] **Step 1: Write `src/config.ts`**

```ts
import postgres from 'postgres'

export const DIRECT_URL =
  process.env.DIRECT_URL ?? 'postgres://demo:demo@localhost:5432/demo'
export const POOLER_TX_URL =
  process.env.POOLER_TX_URL ?? 'postgres://demo:demo@localhost:6432/demo_tx'
export const POOLER_SESSION_URL =
  process.env.POOLER_SESSION_URL ?? 'postgres://demo:demo@localhost:6432/demo_session'

export const POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER ?? 'demo-postgres'

const BAR = '─'.repeat(64)
export function header(title: string) {
  console.log('\n' + BAR)
  console.log('  ' + title)
  console.log(BAR)
}
export function line(msg = '') { console.log(msg) }
export function ok(msg: string) { console.log('  ✅ ' + msg) }
export function bad(msg: string) { console.log('  ❌ ' + msg) }
export function info(msg: string) { console.log('  •  ' + msg) }

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Count live client backends on the demo database, observed directly on Postgres.
export async function countBackends(): Promise<number> {
  const sql = postgres(DIRECT_URL, { max: 1 })
  try {
    const rows = await sql`
      select count(*)::int as n
      from pg_stat_activity
      where datname = 'demo' and backend_type = 'client backend'
    `
    return rows[0].n as number
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// Ensure the notes table exists and is empty.
export async function resetSchema(): Promise<void> {
  const sql = postgres(DIRECT_URL, { max: 1 })
  try {
    await sql`create table if not exists notes (id serial primary key, body text)`
    await sql`truncate notes restart identity`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
```

- [ ] **Step 2: Smoke-test the config module**

Run: `bun -e "import('./src/config.ts').then(async m => { console.log(await m.countBackends()) })"`
Expected: prints a small integer (e.g. `1`), no connection error.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts
git commit -m "feat: shared config, narrative utils, db helpers"
```

---

## Task 4: Scenario 1 — connection = OS process

**Files:**
- Create: `src/01-connection-cost.ts`

- [ ] **Step 1: Write `src/01-connection-cost.ts`**

```ts
import postgres from 'postgres'
import { DIRECT_URL, POSTGRES_CONTAINER, header, info, line, ok } from './config'

const N = Number(process.env.N ?? 10)

async function rssKbForPid(pid: number): Promise<number | null> {
  const proc = Bun.spawn([
    'podman', 'exec', POSTGRES_CONTAINER, 'sh', '-c',
    `grep VmRSS /proc/${pid}/status`,
  ])
  const out = await new Response(proc.stdout).text()
  await proc.exited
  const m = out.match(/VmRSS:\s+(\d+)\s+kB/)
  return m ? Number(m[1]) : null
}

header('Skenario 1 — Satu koneksi PostgreSQL = satu proses OS (Slide 5)')
info(`Membuka ${N} koneksi langsung ke Postgres dan menahannya tetap terbuka...`)

const clients: ReturnType<typeof postgres>[] = []
const pids: number[] = []
for (let i = 0; i < N; i++) {
  const sql = postgres(DIRECT_URL, { max: 1 })
  const [{ pid }] = await sql`select pg_backend_pid() as pid`
  clients.push(sql)
  pids.push(pid as number)
}
ok(`${N} koneksi terbuka. PID backend: ${pids.join(', ')}`)

line()
info('Tiap PID di atas adalah PROSES OS terpisah di dalam container Postgres.')
info('Cek pemakaian RAM (VmRSS) tiap proses lewat /proc:')
line()

let totalKb = 0
for (const pid of pids) {
  const kb = await rssKbForPid(pid)
  if (kb != null) {
    totalKb += kb
    console.log(`     pid ${pid}  →  ${(kb / 1024).toFixed(1)} MB`)
  } else {
    console.log(`     pid ${pid}  →  (tidak terbaca)`)
  }
}
line()
ok(`Total RAM ${N} koneksi ≈ ${(totalKb / 1024).toFixed(1)} MB`)
info('Bandingkan: max_connections default Postgres cuma 100.')
info('Koneksi = proses penuh hasil fork, bukan sekadar socket → itulah mahalnya.')

for (const sql of clients) await sql.end({ timeout: 5 })
```

- [ ] **Step 2: Run the scenario**

Run: `bun run demo:cost`
Expected: prints `10 koneksi terbuka` with 10 PIDs, then 10 lines each `pid <n> → <x> MB`, then a total in MB. If RSS shows `(tidak terbaca)`, `/proc` parse failed — verify `podman exec demo-postgres cat /proc/1/status` works and adjust the regex.

- [ ] **Step 3: Commit**

```bash
git add src/01-connection-cost.ts
git commit -m "feat: scenario 1 - connection is an OS process"
```

---

## Task 5: Scenario 2 — exhaustion vs pooler

**Files:**
- Create: `src/02-exhaustion.ts`

- [ ] **Step 1: Write `src/02-exhaustion.ts`**

```ts
import postgres from 'postgres'
import { DIRECT_URL, POOLER_TX_URL, countBackends, header, info, ok, bad, line, sleep } from './config'

const PODS = Number(process.env.PODS ?? 30)

function isTooManyClients(e: any): boolean {
  const msg = String(e?.message ?? e)
  return e?.code === '53300' ||
    /too many clients|too many connections|remaining connection slots/i.test(msg)
}

async function tryDirect(): Promise<{ ok: boolean; tooMany: boolean }> {
  const sql = postgres(DIRECT_URL, { max: 1, connect_timeout: 10, idle_timeout: 2 })
  try {
    await sql`select 1`
    await sleep(300) // tahan koneksi sebentar supaya saling rebutan slot
    return { ok: true, tooMany: false }
  } catch (e) {
    return { ok: false, tooMany: isTooManyClients(e) }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

header('Skenario 2 — Exhaustion vs PgBouncer (Slide 10 & 13)')
info(`Postgres di-set max_connections=20. Simulasikan ${PODS} "pod" konek bersamaan.`)

line()
info(`MODE DIRECT — ${PODS} koneksi langsung ke Postgres (5432):`)
const direct = await Promise.all(Array.from({ length: PODS }, () => tryDirect()))
const dOk = direct.filter((r) => r.ok).length
const dTooMany = direct.filter((r) => r.tooMany).length
ok(`sukses: ${dOk}`)
bad(`gagal : ${direct.length - dOk}  (di antaranya "too many clients": ${dTooMany})`)

line()
info(`MODE POOLER — ${PODS} koneksi lewat PgBouncer transaction mode (6432):`)
const pooled = Array.from({ length: PODS }, () => {
  const sql = postgres(POOLER_TX_URL, { max: 1, connect_timeout: 10 })
  return sql`select pg_sleep(0.4)`
    .then(() => ({ ok: true }))
    .catch((e: any) => ({ ok: false, err: String(e?.message ?? e) }))
    .finally(() => { void sql.end({ timeout: 5 }).catch(() => {}) })
})
await sleep(200)
const liveBackends = await countBackends()
const pooledResults = await Promise.all(pooled)
const pOk = pooledResults.filter((r) => r.ok).length
ok(`sukses: ${pOk}`)
if (pOk < PODS) bad(`gagal : ${PODS - pOk}`)
ok(`koneksi NYATA ke Postgres saat ${PODS} pod aktif: ~${liveBackends} (dibatasi default_pool_size=5)`)

line()
info('Penskalaan aplikasi (jumlah pod) dipisahkan dari jumlah koneksi database.')
```

- [ ] **Step 2: Run the scenario**

Run: `bun run demo:exhaustion`
Expected: DIRECT shows several failures with `too many clients` > 0; POOLER shows `sukses: 30` (or all) and `koneksi NYATA ... ~5` to ~6. If DIRECT shows zero failures, raise `PODS` (e.g. `PODS=40 bun run demo:exhaustion`) or increase the `sleep` hold; if POOLER shows failures, check `podman logs demo-pgbouncer`.

- [ ] **Step 3: Commit**

```bash
git add src/02-exhaustion.ts
git commit -m "feat: scenario 2 - connection exhaustion vs pooler"
```

---

## Task 6: Scenario 3 — prepared statement bug & fix

**Files:**
- Create: `src/03-prepared-bug.ts`

- [ ] **Step 1: Write `src/03-prepared-bug.ts`**

```ts
import postgres from 'postgres'
import { POOLER_TX_URL, POOLER_SESSION_URL, resetSchema, header, info, ok, bad, line } from './config'

const OPS = Number(process.env.OPS ?? 50)

type Result = {
  success: number; failed: number; firstError: string; present: number; returned: number
}

async function runWorkload(url: string, prepare: boolean): Promise<Result> {
  const sql = postgres(url, { max: 5, prepare })
  let success = 0
  let failed = 0
  let firstError = ''
  const returnedIds: number[] = []
  const tasks = Array.from({ length: OPS }, (_, i) =>
    sql`insert into notes (body) values (${'note-' + i}) returning id`
      .then((rows) => { success++; returnedIds.push(rows[0].id as number) })
      .catch((e: any) => {
        failed++
        if (!firstError) firstError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
      }),
  )
  await Promise.all(tasks)
  const [{ n }] = await sql`select count(*)::int as n from notes`
  await sql.end({ timeout: 5 })
  return { success, failed, firstError, present: n as number, returned: returnedIds.length }
}

function report(r: Result) {
  if (r.failed > 0) bad(`sukses ${r.success}/${OPS}, gagal ${r.failed} → ${r.firstError}`)
  else ok(`sukses ${r.success}/${OPS}, gagal 0`)
  if (r.returned !== r.present) {
    bad(`SILENT LOSS: RETURNING balikin ${r.returned} baris, tersimpan cuma ${r.present}`)
  } else {
    info(`baris tersimpan: ${r.present}`)
  }
}

header('Skenario 3 — Bug prepared statement & fix satu baris (Slide 2, 17-19)')
info(`Tiap kasus menjalankan ${OPS} INSERT ... RETURNING paralel ke tabel notes.`)

await resetSchema()
line(); info('KASUS 1 — transaction mode + prepare:true (DEFAULT → kondisi bug)')
report(await runWorkload(POOLER_TX_URL, true))

await resetSchema()
line(); info('KASUS 2 — session mode + prepare:true')
report(await runWorkload(POOLER_SESSION_URL, true))

await resetSchema()
line(); info('KASUS 3 — transaction mode + prepare:FALSE  ← fix satu baris')
info('   const sql = postgres(URL, { prepare: false })')
report(await runWorkload(POOLER_TX_URL, false))

line()
info('Bug spesifik ke transaction mode + prepared statement.')
info('Fix: prepare:false (atau session mode bila butuh fitur level-sesi).')
```

- [ ] **Step 2: Run the scenario**

Run: `bun run demo:bug`
Expected: KASUS 1 reports `gagal > 0` with an error code such as `26000` (prepared statement does not exist) or `42P05` (already exists); KASUS 2 and KASUS 3 report `gagal 0`. If KASUS 1 does NOT fail, increase concurrency/contention: `OPS=100 bun run demo:bug`, and confirm `default_pool_size=5` in `pgbouncer.ini` (smaller pool = more server-connection churn = more reliable repro). The SILENT LOSS line is best-effort — report it only if observed; do not force it.

- [ ] **Step 3: Commit**

```bash
git add src/03-prepared-bug.ts
git commit -m "feat: scenario 3 - prepared statement bug and prepare:false fix"
```

---

## Task 7: README & full run-through

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# Demo: Kenapa Koneksi PostgreSQL Mahal & Peran PgBouncer

Demo pendukung sharing session. Tiga skenario membuktikan klaim slide secara live.

## Prasyarat
- [Bun](https://bun.sh) 1.3+
- Podman + podman-compose (di mac: `podman machine start` dulu)
- `psql` (opsional, buat cek manual)

## Setup
```bash
podman machine start          # kalau belum jalan
bun install
bun run db:up                 # Postgres (max_connections=20) + PgBouncer
```

Cek siap:
```bash
psql postgres://demo:demo@localhost:5432/demo -tAc "show max_connections"   # 20
psql postgres://demo:demo@localhost:6432/demo_tx -tAc "select 1"            # 1
```

## Jalankan demo (urut sesuai slide)
| Perintah | Skenario | Slide |
|---|---|---|
| `bun run demo:cost`       | Koneksi = 1 proses OS (RAM per koneksi) | 5 |
| `bun run demo:exhaustion` | Exhaustion langsung vs PgBouncer datar   | 10, 13 |
| `bun run demo:bug`        | Bug prepared statement + fix `prepare:false` | 2, 16-19 |

Knob opsional: `N=20 bun run demo:cost`, `PODS=40 bun run demo:exhaustion`, `OPS=100 bun run demo:bug`.

## Bersih-bersih
```bash
bun run db:down               # hapus container + volume
```

## Arsitektur
- `demo_tx`  → PgBouncer transaction mode (port 6432)
- `demo_session` → PgBouncer session mode (port 6432)
- direct → Postgres (port 5432)

## Troubleshooting
- **Cannot connect to Podman** → `podman machine start`.
- **port 5432/6432 sudah dipakai** → matikan Postgres/pooler lokal atau ubah mapping port di `compose.yaml`.
- **PgBouncer gagal start** → `podman logs demo-pgbouncer`; pastikan `auth_type=plain` cocok dengan `userlist.txt`.
- **Image lama ke-cache** → `podman-compose down -v && podman pull postgres:18 && podman pull edoburu/pgbouncer:latest`.
````

- [ ] **Step 2: Full clean run-through (verification)**

Run:
```bash
bun run db:down
bun run db:up
bun run demo:cost
bun run demo:exhaustion
bun run demo:bug
```
Expected: all three scenarios print their expected output (see Tasks 4-6). This is the end-to-end verification of the whole demo.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with run order mapped to slides"
```

---

## Self-Review Notes

- **Spec coverage:** Scenario 1 → Task 4; Scenario 2 → Task 5; Scenario 3 (3-way mode compare) → Task 6; infra w/ tx+session aliases → Task 2; config/URLs/utils → Task 3; README+verification → Task 7. All spec sections covered.
- **Type consistency:** `Result` type and `runWorkload`/`report`/`countBackends`/`resetSchema`/`sleep` signatures are consistent across tasks. Narrative util names (`header/line/ok/bad/info`) identical everywhere.
- **No placeholders:** every code/command step shows full content and expected output.
- **Honesty:** silent-loss is explicitly best-effort in Task 6; `max_connections=20` is a demo value.
