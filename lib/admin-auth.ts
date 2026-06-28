import { NextRequest } from 'next/server'
import crypto from 'crypto'

// 메모리 기반 실패 카운터(웜 인스턴스 한정) — 분산 환경에선 완전하지 않지만
// 실패 지연과 함께 무차별 대입을 의미 있게 늦춰줍니다.
const attempts = new Map<string, { count: number; first: number }>()
const WINDOW_MS = 10 * 60 * 1000
const MAX_FAILS = 10

function clientIp(req: NextRequest): string {
  return (req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()) || 'unknown'
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  try { return crypto.timingSafeEqual(ab, bb) } catch { return false }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export type AuthResult = { ok: true } | { ok: false; status: number; error: string }

// 관리자 인증: 비밀번호 상수시간 비교 + 실패 지연 + 시도 횟수 제한
export async function requireAdmin(req: NextRequest): Promise<AuthResult> {
  const ip = clientIp(req)
  const now = Date.now()
  const rec = attempts.get(ip)

  if (rec && now - rec.first < WINDOW_MS && rec.count >= MAX_FAILS) {
    await sleep(800)
    return { ok: false, status: 429, error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.' }
  }

  const pw = req.headers.get('x-admin-password') || ''
  const expected = process.env.ADMIN_PASSWORD || ''

  if (expected && safeEqual(pw, expected)) {
    attempts.delete(ip)
    return { ok: true }
  }

  // 실패: 지연 + 카운트 증가
  await sleep(600)
  const base = rec && now - rec.first < WINDOW_MS ? rec : { count: 0, first: now }
  base.count += 1
  attempts.set(ip, base)
  return { ok: false, status: 401, error: '인증 실패' }
}
