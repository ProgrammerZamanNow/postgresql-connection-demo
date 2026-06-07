import postgres from 'postgres'
import { DIRECT_URL, header, info, ok, bad, line, sleep } from './config'

const PODS = Number(process.env.PODS ?? 30)

function classify(e: any): { tooMany: boolean; raw: string } {
  const msg = String(e?.message ?? e)
  const tooMany = e?.code === '53300' ||
    /too many clients|too many connections|remaining connection slots/i.test(msg)
  return { tooMany, raw: `${e?.code ?? ''} ${e?.message ?? e}`.trim() }
}

async function tryDirect(): Promise<{ ok: boolean; tooMany: boolean; raw: string }> {
  const sql = postgres(DIRECT_URL, { max: 1, connect_timeout: 10, idle_timeout: 2 })
  try {
    await sql`select 1`
    await sleep(300) // tahan koneksi sebentar supaya saling rebutan slot
    return { ok: true, tooMany: false, raw: '' }
  } catch (e) {
    const c = classify(e)
    return { ok: false, tooMany: c.tooMany, raw: c.raw }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {})
  }
}

header('KASUS 2 — Koneksi langsung menembus max_connections (Slide 10 & 13)')
info(`Postgres di-set max_connections=20. Simulasikan ${PODS} "pod" konek langsung bersamaan.`)
line()

const res = await Promise.all(Array.from({ length: PODS }, () => tryDirect()))
const okN = res.filter((r) => r.ok).length
const failed = res.filter((r) => !r.ok)
const sample = failed.find((r) => r.raw)?.raw ?? '-'

ok(`sukses: ${okN}`)
bad(`gagal : ${failed.length}  (di antaranya "too many clients": ${failed.filter((r) => r.tooMany).length})`)
info(`contoh error mentah: ${sample}`)
line()
info('Pas autoscaling, makin banyak pod naik justru makin banyak yang gagal connect.')
