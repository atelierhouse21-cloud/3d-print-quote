export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  // 관리자 인증
  const auth = await requireAdmin(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const path = req.nextUrl.searchParams.get('path')
  if (!path) {
    return NextResponse.json({ error: 'path required' }, { status: 400 })
  }

  const supabaseAdmin = getSupabaseAdmin()

  console.log('[DOWNLOAD] 요청 경로:', path)

  // 60분 유효한 서명된 다운로드 URL 생성
  const { data, error } = await supabaseAdmin.storage
    .from('quote-files')
    .createSignedUrl(path, 60 * 60)

  if (error || !data?.signedUrl) {
    console.error('[DOWNLOAD] 서명 URL 생성 실패:', JSON.stringify(error))
    // 서명 URL 실패 시 직접 다운로드 URL 시도
    const { data: pubData } = supabaseAdmin.storage
      .from('quote-files')
      .getPublicUrl(path)
    if (pubData?.publicUrl) {
      console.log('[DOWNLOAD] public URL 사용:', pubData.publicUrl)
      return NextResponse.json({ url: pubData.publicUrl })
    }
    return NextResponse.json({ error: error?.message || 'URL 생성 실패' }, { status: 500 })
  }

  console.log('[DOWNLOAD] 서명 URL 생성 성공')
  return NextResponse.json({ url: data.signedUrl })
}
