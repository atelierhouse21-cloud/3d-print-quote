export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
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
    const pw = req.headers.get('x-admin-password')
    if (pw !== process.env.ADMIN_PASSWORD) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const supabaseAdmin = getSupabaseAdmin()
    const body = await req.json()
    const { key = 'print_options', value } = body
    
    const { data, error } = await supabaseAdmin
      .from('settings')
      .upsert({ key, value, updated_at: new Date().toISOString() })
      .select()
      .single()
    
    if (error) {
      console.error('[SETTINGS] POST error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    
    return NextResponse.json({ ok: true, data })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
