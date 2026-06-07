import { POOLER_SESSION_URL, resetSchema, header, info, line } from './config'
import { preparedWorkload, reportWorkload } from './workload'

const OPS = Number(process.env.OPS ?? 60)

header('KASUS 5 — Prepared statement di SESSION mode → aman (Slide 16)')
info('Workload sama persis dengan KASUS 4, cuma beda pool_mode.')
info('Koneksi server dipegang sepanjang sesi → PREPARE & EXECUTE di koneksi yang sama.')
line()

await resetSchema()
reportWorkload(await preparedWorkload(POOLER_SESSION_URL, OPS), OPS)

line()
info('Bukti: bug-nya spesifik ke transaction mode, bukan ke prepared statement-nya.')
