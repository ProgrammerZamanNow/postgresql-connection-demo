import { POOLER_TX_URL, resetSchema, header, info, line } from './config'
import { plainWorkload, reportWorkload } from './workload'

const OPS = Number(process.env.OPS ?? 60)

header('KASUS 6 — Fix: prepare:false di transaction mode (Slide 19)')
info('   const sql = postgres(URL, { prepare: false })')
info('Tanpa prepared statement, query dikirim langsung → tidak tergantung koneksi server.')
line()

await resetSchema()
reportWorkload(await plainWorkload(POOLER_TX_URL, OPS), OPS)

line()
info('Fix satu baris. Alternatif: pakai session mode bila butuh fitur level-sesi.')
