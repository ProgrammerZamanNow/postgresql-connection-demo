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

header('KASUS 1 — Satu koneksi PostgreSQL = satu proses OS (Slide 5)')
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
