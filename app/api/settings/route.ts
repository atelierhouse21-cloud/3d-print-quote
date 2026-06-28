export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getSupabaseAdmin } from '@/lib/supabase'

// GET: 설정 조회
export async function GET(req: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin()
    const key = req.nextUrl.searchParams.get('key') || 'print_options'
    
    const { data, error } = await supabaseAdmin
      .from('settings')
      .select('*')
      .eq('key', key)
      .single()
    
    if (error) {
      console.error('[SETTINGS] GET error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json(data?.value || {})
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// POST: 설정 업데이트 (관리자만)
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req)
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
    
    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()
    const { key = 'print_options', value } = body
    
    // 기존 설정 확인
    const { data: existing } = await supabaseAdmin
      .from('settings')
      .select('id')
      .eq('key', key)
      .single()
    
    let data, error
    
    if (existing) {
      // 기존 설정 업데이트
      const result = await supabaseAdmin
        .from('settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key)
        .select()
        .single()
      data = result.data
      error = result.error
    } else {
      // 새 설정 삽입
      const result = await supabaseAdmin
        .from('settings')
        .insert({ key, value, updated_at: new Date().toISOString() })
        .select()
        .single()
      data = result.data
      error = result.error
    }
    
    if (error) {
      console.error('[SETTINGS] POST error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
