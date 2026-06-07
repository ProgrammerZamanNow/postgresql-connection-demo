import postgres from 'postgres'
import { POOLER_TX_URL, POOLER_SESSION_URL, resetSchema, header, info, ok, bad, line } from './config'

const OPS = Number(process.env.OPS ?? 60)

type Result = { success: number; failed: number; firstError: string; present: number }

// Meniru yang dilakukan driver saat prepared statement AKTIF (Slide 18):
// PREPARE di satu transaksi, lalu EXECUTE di transaksi berikutnya.
// Di transaction mode, transaksi ke-2 bisa mendarat di koneksi server lain
// yang tidak punya statement itu → "prepared statement does not exist".
async function preparedWorkload(url: string): Promise<Result> {
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} })
  let success = 0
  let failed = 0
  let firstError = ''
  const tasks = Array.from({ length: OPS }, (_, i) => (async () => {
    const name = `stmt_${i}`
    // reserve(): kunci PREPARE & EXECUTE ke SATU koneksi postgres.js. Di session mode
    // itu berarti satu koneksi server yang sama; di transaction mode pgbouncer tetap
    // bisa kasih server berbeda per transaksi → inilah pemicu bug-nya.
    const conn = await sql.reserve()
    try {
      await conn.unsafe(`PREPARE ${name} AS INSERT INTO notes (body) VALUES ($1) RETURNING id`)
      await conn.unsafe(`EXECUTE ${name}('note-${i}')`)
      success++
    } catch (e: any) {
      failed++
      if (!firstError) firstError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
    } finally {
      conn.release()
    }
  })())
  await Promise.all(tasks)
  const [{ n }] = await sql`select count(*)::int as n from notes`
  await sql.end({ timeout: 5 })
  return { success, failed, firstError, present: n as number }
}

// Fix (Slide 19): tanpa prepared statement sama sekali — driver pakai prepare:false,
// query dikirim langsung tiap kali, jadi tidak bergantung pada koneksi server tertentu.
async function plainWorkload(url: string): Promise<Result> {
  const sql = postgres(url, { max: 5, prepare: false, onnotice: () => {} })
  let success = 0
  let failed = 0
  let firstError = ''
  const tasks = Array.from({ length: OPS }, (_, i) =>
    sql`insert into notes (body) values (${'note-' + i}) returning id`
      .then(() => { success++ })
      .catch((e: any) => {
        failed++
        if (!firstError) firstError = `${e?.code ?? ''} ${e?.message ?? e}`.trim()
      }),
  )
  await Promise.all(tasks)
  const [{ n }] = await sql`select count(*)::int as n from notes`
  await sql.end({ timeout: 5 })
  return { success, failed, firstError, present: n as number }
}

function report(r: Result) {
  if (r.failed > 0) bad(`sukses ${r.success}/${OPS}, gagal ${r.failed} → ${r.firstError}`)
  else ok(`sukses ${r.success}/${OPS}, gagal 0`)
  info(`baris tersimpan: ${r.present}`)
}

header('Skenario 3 — Bug prepared statement & fix satu baris (Slide 2, 17-19)')
info(`Tiap kasus menjalankan ${OPS} operasi paralel ke tabel notes.`)

await resetSchema()
line(); info('KASUS 1 — transaction mode + prepared statement (PREPARE lalu EXECUTE)')
info('   Inilah yang diaktifkan driver secara default. Koneksi gonta-ganti antar transaksi.')
report(await preparedWorkload(POOLER_TX_URL))

await resetSchema()
line(); info('KASUS 2 — session mode + prepared statement yang sama')
info('   Koneksi server dipegang sepanjang sesi → PREPARE & EXECUTE di koneksi yang sama.')
report(await preparedWorkload(POOLER_SESSION_URL))

await resetSchema()
line(); info('KASUS 3 — transaction mode, FIX: tanpa prepared statement')
info('   const sql = postgres(URL, { prepare: false })')
report(await plainWorkload(POOLER_TX_URL))

line()
info('Bug spesifik ke transaction mode + prepared statement (asumsi 1 sesi = 1 koneksi fisik).')
info('Fix: prepare:false, atau session mode bila butuh fitur level-sesi.')
info('Catatan: sebagian driver (mis. postgres.js) auto-retry untuk prepared statement')
info('implisit, tapi prinsip & rekomendasinya tetap sama saat lewat transaction pooler.')
