import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { RETENTION_MS } from '@/lib/constants'

// 보유기간 만료 견적 자동 삭제 (Vercel Cron 으로 매일 호출).
// CRON_SECRET 이 설정돼 있으면 해당 토큰이 있는 요청만 허용합니다.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const authH = req.headers.get('authorization') || ''
    if (authH !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabaseAdmin = getSupabaseAdmin()
  const cutoff = new Date(Date.now() - RETENTION_MS).toISOString()

  const { data, error } = await supabaseAdmin
    .from('quotes')
    .select('id, file_path, admin_note')
    .is('deleted_at', null)
    .lt('created_at', cutoff)

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const reason = '개인정보 보관기간 만료로 인한 자동 삭제'
  let deleted = 0
  for (const q of data || []) {
    try {
      if (q.file_path) {
        const { error: rmErr } = await supabaseAdmin.storage.from('quote-files').remove([q.file_path])
        if (rmErr) console.warn('[CRON] 파일 삭제 생략:', rmErr.message)
      }
      const { error: upErr } = await supabaseAdmin
        .from('quotes')
        .update({
          deleted_at: new Date().toISOString(),
          admin_note: [q.admin_note, reason].filter(Boolean).join(' | '),
        })
        .eq('id', q.id)
      if (upErr) { console.warn('[CRON] 삭제 표기 실패:', upErr.message); continue }
      deleted++
    } catch (e: any) {
      console.warn('[CRON] 처리 중 오류:', e?.message)
    }
  }

  console.log('[CRON] 만료 자동 삭제 완료:', deleted, '건')
  return NextResponse.json({ ok: true, deleted })
}
