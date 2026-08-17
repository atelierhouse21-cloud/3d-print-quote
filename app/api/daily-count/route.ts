import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { ACTIVE_STATUSES } from '@/lib/constants'

// 현재 "진행 중"(배송준비 단계 미만) 작업 수를 방식별로 반환 — 혼잡/마감 안내 기준.
// 당일 접수 누적이 아니라, 지금 실제로 밀려 있는 작업량을 셈.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('method, items, status')
    .is('deleted_at', null)
    .in('status', ACTIVE_STATUSES)

  if (error) {
    console.warn('[ACTIVE-COUNT] 조회 오류:', error.message)
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
