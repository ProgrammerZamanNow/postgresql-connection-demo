import { POOLER_TX_URL, resetSchema, header, info, line } from './config'
import { preparedWorkload, reportWorkload } from './workload'

const OPS = Number(process.env.OPS ?? 60)

header('KASUS 4 — Prepared statement di TRANSACTION mode → bug (Slide 18)')
info('PREPARE di satu transaksi, EXECUTE di transaksi berikutnya.')
info('Koneksi server gonta-ganti antar transaksi → statement-nya hilang.')
line()

await resetSchema()
reportWorkload(await preparedWorkload(POOLER_TX_URL, OPS), OPS)

line()
info('Error: prepared statement does not exist (SQLSTATE 26000).')
info('Inilah akar bug pembuka: asumsi "1 sesi = 1 koneksi fisik" yang rusak.')
