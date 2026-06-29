import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// 공개 진행상황 조회: 고객 확인 번호(tracking_code)로 최소 정보만 반환.
// 개인정보·업로드 파일은 절대 노출하지 않습니다.
export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get('code') || '').trim().toUpperCase()
  if (!code || code.length < 6) {
    return NextResponse.json({ error: '확인 번호를 입력해 주세요.' }, { status: 400 })
  }

  const supabaseAdmin = getSupabaseAdmin()
  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('quote_no, status, stage_times, created_at, final_days, shipping_company, tracking_number, deleted_at')
    .eq('tracking_code', code)
    .maybeSingle()

  if (error) {
    console.warn('[TRACK] 조회 오류(tracking_code 컬럼 누락 가능):', error.message)
    return NextResponse.json({ error: '조회 기능을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.' }, { status: 500 })
  }
  if (!data || data.deleted_at) {
    return NextResponse.json({ error: '해당 확인 번호의 견적을 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({
    quote_no: data.quote_no,
    status: data.status,
    stage_times: data.stage_times || {},
    created_at: data.created_at,
    final_days: data.final_days ?? null,
    shipping_company: data.shipping_company ?? null,
    tracking_number: data.tracking_number ?? null,
  })
}
