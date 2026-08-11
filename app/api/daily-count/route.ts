import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// 오늘(한국시간) 방식별 접수 건수 — 혼잡 안내용. 항상 최신값 반환.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  // 한국시간(UTC+9) 자정 = UTC 기준 시각 계산
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 3600 * 1000)
  const y = kst.getUTCFullYear(), m = kst.getUTCMonth(), d = kst.getUTCDate()
  const startUtc = new Date(Date.UTC(y, m, d, 0, 0, 0) - 9 * 3600 * 1000)

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('method, items')
    .is('deleted_at', null)
    .gte('created_at', startUtc.toISOString())

  if (error) {
    console.warn('[DAILY-COUNT] 조회 오류:', error.message)
    return NextResponse.json({ counts: {} }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // 견적서 1건 기준: 한 견적서에 어떤 방식이 하나라도 포함되면 그 방식 +1
  const counts: Record<string, number> = {}
  for (const q of data || []) {
    const methods = new Set<string>()
    if (q.method) methods.add(String(q.method))
    if (Array.isArray(q.items)) for (const it of q.items) if (it?.method) methods.add(String(it.method))
    methods.forEach(mm => { counts[mm] = (counts[mm] || 0) + 1 })
  }

  return NextResponse.json({ counts }, { headers: { 'Cache-Control': 'no-store' } })
}
