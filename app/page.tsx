'use client'
import { useState, useRef, lazy, Suspense } from 'react'
import { METHODS, MATS, COLS, QUAL, calcPrice, calcDays, krw } from '@/lib/constants'
import type { STLInfo } from '@/components/STLViewer'

const STLViewer = lazy(() => import('@/components/STLViewer'))

type FormState = {
  name: string; email: string; company: string; phone: string; note: string
  file: File | null; vol: number | null
  sizeX: number | null; sizeY: number | null; sizeZ: number | null
  method: string; material: string; color: string; quality: string; qm: number
  qty: number; infill: number
}

const BLANK: FormState = {
  name:'', email:'', company:'', phone:'', note:'', file:null, vol:null,
  sizeX:null, sizeY:null, sizeZ:null,
  method:'FDM', material:'PLA', color:'White', quality:'Standard (0.2mm)', qm:1.0, qty:1, infill:20,
}

const S: Record<string, React.CSSProperties> = {
  wrap: { maxWidth:760, margin:'0 auto', padding:'24px 16px 60px' },
  card: { background:'#fff', borderRadius:16, border:'1px solid #e5e7eb', overflow:'hidden' },
  body: { padding:28 },
  row:  { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:20 },
  grp:  { display:'flex', flexDirection:'column', gap:6 },
  lbl:  { fontSize:12, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.4px' } as React.CSSProperties,
  btn:  { padding:'10px 24px', borderRadius:10, fontSize:14, fontWeight:600, cursor:'pointer', border:'none', display:'inline-flex', alignItems:'center', gap:6 },
  sBtn: { background:'#fff', color:'#374151', border:'1.5px solid #d1d5db', padding:'10px 22px', borderRadius:10, fontSize:14, fontWeight:600, cursor:'pointer' },
  alert: { display:'flex', gap:10, padding:'12px 14px', borderRadius:10, fontSize:13, lineHeight:'1.5', marginBottom:16, alignItems:'flex-start' },
}

export default function Home() {
  const [step, setStep] = useState(1)
  const [done, setDone] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(BLANK)
  const [drag, setDrag] = useState(false)
  const [showViewer, setShowViewer] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const upd = (k: keyof FormState, v: any) => setForm(p => ({ ...p, [k]: v }))

  const setMethod = (m: string) => setForm(p => ({
    ...p, method: m, material: MATS[m][0], color: COLS[m][0],
    quality: QUAL[m][0].v, qm: QUAL[m][0].m,
  }))

  const handleFile = (f: File | null) => {
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase()
    const supported = ['stl','obj','3mf','step','stp','iges']
    if (!supported.includes(ext || '')) {
      alert('지원 형식: STL · OBJ · 3MF · STEP · IGES'); return
    }
    const canPreview = ext === 'stl'
    setForm(p => ({ ...p, file: f, vol: null, sizeX: null, sizeY: null, sizeZ: null }))
    setShowViewer(canPreview)
    // STL이 아닌 파일은 파일 크기 기반 부피 추정
    if (!canPreview) {
      const est = parseFloat(((f.size / 1024 / 1024) * 8 + 5).toFixed(1))
      setForm(p => ({ ...p, file: f, vol: est, sizeX: null, sizeY: null, sizeZ: null }))
    }
  }

  const onSTLAnalyzed = (info: STLInfo) => {
    setForm(p => ({
      ...p,
      vol: info.volume,
      sizeX: info.x,
      sizeY: info.y,
      sizeZ: info.z,
    }))
  }

  const step1Valid = form.name.trim() && form.email.trim() && form.file
  const price = form.vol ? calcPrice(form.method, form.vol, form.qm, form.qty, form.infill) : 0
  const days = calcDays(form.method, form.qty)
  const disc = form.qty >= 10 ? 15 : form.qty >= 5 ? 8 : 0

  const submit = async () => {
    setLoading(true)
    try {
      const fd = new FormData()
      fd.append('name', form.name)
      fd.append('email', form.email)
      fd.append('company', form.company)
      fd.append('phone', form.phone)
      fd.append('note', form.note)
      fd.append('method', form.method)
      fd.append('material', form.material)
      fd.append('color', form.color)
      fd.append('quality', form.quality)
      fd.append('qty', String(form.qty))
      fd.append('infill', String(form.infill))
      fd.append('qm', String(form.qm))
      fd.append('vol', String(form.vol || 0))
      fd.append('sizeX', String(form.sizeX || 0))
      fd.append('sizeY', String(form.sizeY || 0))
      fd.append('sizeZ', String(form.sizeZ || 0))
      if (form.file) fd.append('file', form.file)

      const res = await fetch('/api/quotes', { method: 'POST', body: fd })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)
      setDone(json.quote_no)
    } catch (e: any) {
      alert('오류가 발생했습니다: ' + e.message)
    } finally {
      setLoading(false)
    }
  }

  const STEP_LABELS = ['고객 정보 & 파일', '출력 설정', '견적 확인']

  if (done) return (
    <div style={S.wrap}>
      <Logo />
      <div style={S.card}>
        <div style={{ ...S.body, textAlign:'center', padding:'52px 28px' }}>
          <div style={{ fontSize:64, marginBottom:20 }}>🎉</div>
          <h2 style={{ fontSize:22, fontWeight:700, marginBottom:10 }}>견적 요청이 접수되었습니다!</h2>
          <p style={{ color:'#6b7280', lineHeight:1.8, marginBottom:28 }}>
            <b>{form.email}</b>으로 접수 확인 메일을 발송했습니다.<br/>
            담당자 검토 후 <b>1~2 영업일 이내</b> 최종 견적을 안내드립니다.<br/>
            <span style={{ fontSize:13, color:'#9ca3af' }}>견적 번호: {done}</span>
          </p>
          <button style={S.sBtn} onClick={() => { setDone(null); setStep(1); setForm(BLANK); setShowViewer(false) }}>새 견적 요청</button>
        </div>
      </div>
    </div>
  )

  return (
    <div style={S.wrap}>
      <Logo />
      <div style={S.card}>
        {/* 진행 단계 */}
        <div style={{ display:'flex', alignItems:'center', padding:'18px 28px', background:'#f9fafb', borderBottom:'1px solid #e5e7eb' }}>
          {STEP_LABELS.map((s, i) => (
            <div key={i} style={{ display:'flex', alignItems:'center', flex: i < STEP_LABELS.length-1 ? 1 : undefined }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                <div style={{
                  width:26, height:26, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:12, fontWeight:700, flexShrink:0,
                  background: step > i+1 ? '#16a34a' : step === i+1 ? '#2563eb' : '#fff',
                  border: `2px solid ${step > i+1 ? '#16a34a' : step === i+1 ? '#2563eb' : '#d1d5db'}`,
                  color: step > i+1 || step === i+1 ? '#fff' : '#9ca3af',
                }}>
                  {step > i+1 ? '✓' : i+1}
                </div>
                <span style={{ fontSize:13, whiteSpace:'nowrap', color: step===i+1 ? '#1a1a1a' : '#9ca3af', fontWeight: step===i+1 ? 600 : 400 }}>{s}</span>
              </div>
              {i < STEP_LABELS.length-1 && <div style={{ flex:1, height:1, background:'#d1d5db', margin:'0 10px' }} />}
            </div>
          ))}
        </div>

        <div style={S.body}>

          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              <p style={{ color:'#6b7280', marginBottom:20 }}>견적 요청에 필요한 기본 정보와 3D 파일을 업로드해 주세요.</p>
              <div style={S.row}>
                <div style={S.grp}><label style={S.lbl}>이름 *</label><input type="text" value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="홍길동" /></div>
                <div style={S.grp}><label style={S.lbl}>이메일 *</label><input type="email" value={form.email} onChange={e=>upd('email',e.target.value)} placeholder="example@mail.com" /></div>
                <div style={S.grp}><label style={S.lbl}>회사 / 기관</label><input type="text" value={form.company} onChange={e=>upd('company',e.target.value)} placeholder="(주)회사명 또는 개인" /></div>
                <div style={S.grp}><label style={S.lbl}>연락처</label><input type="tel" value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="010-0000-0000" /></div>
              </div>

              <label style={{ ...S.lbl, display:'block', marginBottom:8 }}>3D 파일 업로드 *</label>

              {/* 업로드 존 */}
              <div
                onDragOver={e=>{e.preventDefault();setDrag(true)}}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0])}}
                onClick={()=>fileRef.current?.click()}
                style={{
                  border:`2px dashed ${drag?'#2563eb':form.file?'#16a34a':'#d1d5db'}`,
                  borderRadius:12, padding: form.file && showViewer ? '14px 20px' : '32px 20px',
                  textAlign:'center', cursor:'pointer', marginBottom: showViewer ? 12 : 16,
                  background: drag?'#eff6ff':form.file?'#f0fdf4':'#f9fafb', transition:'all .15s',
                }}
              >
                <input ref={fileRef} type="file" accept=".stl,.obj,.3mf,.step,.stp,.iges" style={{display:'none'}} onChange={e=>handleFile(e.target.files?.[0]||null)} />
                {form.file ? (
                  <>
                    <div style={{ fontSize: showViewer ? 24 : 40, marginBottom:6 }}>📄</div>
                    <div style={{ fontWeight:600, marginBottom:3 }}>{form.file.name}</div>
                    <div style={{ fontSize:12, color:'#6b7280' }}>클릭하여 파일 변경</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize:40, marginBottom:10 }}>☁️</div>
                    <div style={{ fontWeight:600, marginBottom:4 }}>파일을 드래그하거나 클릭하여 업로드</div>
                    <div style={{ fontSize:12, color:'#6b7280' }}>지원 형식: STL · OBJ · 3MF · STEP · IGES</div>
                  </>
                )}
              </div>

              {/* STL 3D 미리보기 */}
              {form.file && showViewer && (
                <Suspense fallback={
                  <div style={{ height:280, background:'#f9fafb', borderRadius:12, display:'flex', alignItems:'center', justifyContent:'center', color:'#9ca3af', marginBottom:16 }}>
                    ⏳ 3D 모델 로딩 중...
                  </div>
                }>
                  <STLViewer file={form.file} onAnalyzed={onSTLAnalyzed} />
                </Suspense>
              )}

              {/* STL 아닌 파일 — 사이즈 수동 입력 안내 */}
              {form.file && !showViewer && (
                <div style={{ ...S.alert, background:'#fffbeb', border:'1px solid #fcd34d', color:'#92400e', marginBottom:16 }}>
                  <span>ℹ️</span>
                  <span>STL 파일은 3D 미리보기와 자동 사이즈/부피 계산이 지원됩니다. 현재 파일은 담당자가 직접 분석 후 견적을 산출합니다.</span>
                </div>
              )}

              <div style={S.grp}>
                <label style={S.lbl}>요청 사항</label>
                <textarea value={form.note} onChange={e=>upd('note',e.target.value)} placeholder="납기 요청, 표면 처리, 색상 등 특이 사항을 입력하세요" />
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginTop:24 }}>
                <button style={{ ...S.btn, background:'#2563eb', color:'#fff' }}
                  onClick={() => { if (!step1Valid) { alert('이름, 이메일, 파일은 필수입니다.'); return } setStep(2) }}>
                  다음 단계 →
                </button>
              </div>
            </>
          )}

          {/* ── STEP 2 ── */}
          {step === 2 && (
            <>
              <p style={{ color:'#6b7280', marginBottom:18 }}>출력 방식과 소재, 품질, 수량을 선택해 주세요.</p>
              <label style={{ ...S.lbl, display:'block', marginBottom:8 }}>출력 방식 선택</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:20 }}>
                {Object.entries(METHODS).map(([k, m]) => (
                  <button key={k} onClick={() => setMethod(k)} style={{
                    border: form.method===k ? '2px solid #2563eb' : '1.5px solid #e5e7eb',
                    borderRadius:10, padding:'12px 16px', cursor:'pointer', textAlign:'left',
                    background: form.method===k ? '#eff6ff' : '#fff', transition:'all .15s',
                  }}>
                    <div style={{ fontSize:15, fontWeight:700, color: form.method===k ? '#2563eb' : '#1a1a1a' }}>{m.label}</div>
                    <div style={{ fontSize:12, color: form.method===k ? '#3b82f6' : '#6b7280', marginTop:2 }}>{m.sub} · ₩{m.price.toLocaleString()}/cm³~</div>
                  </button>
                ))}
              </div>

              <div style={S.row}>
                <div style={S.grp}>
                  <label style={S.lbl}>소재 (Material)</label>
                  <select value={form.material} onChange={e=>upd('material',e.target.value)}>
                    {MATS[form.method].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div style={S.grp}>
                  <label style={S.lbl}>색상 (Color)</label>
                  <select value={form.color} onChange={e=>upd('color',e.target.value)}>
                    {COLS[form.method].map(v => <option key={v}>{v}</option>)}
                  </select>
                </div>
                <div style={S.grp}>
                  <label style={S.lbl}>출력 품질 (Layer Height)</label>
                  <select value={form.quality} onChange={e=>{
                    const q = QUAL[form.method].find(x=>x.v===e.target.value)
                    setForm(p=>({...p, quality:e.target.value, qm:q?.m||1.0}))
                  }}>
                    {QUAL[form.method].map(q => <option key={q.v}>{q.v}</option>)}
                  </select>
                </div>
                <div style={S.grp}>
                  <label style={S.lbl}>수량</label>
                  <input type="number" min={1} max={9999} value={form.qty} onChange={e=>upd('qty',Math.max(1,parseInt(e.target.value)||1))} />
                </div>
                {form.method === 'FDM' && (
                  <div style={{ ...S.grp, gridColumn:'1/-1' }}>
                    <label style={S.lbl}>
                      충전율 (Infill): <span style={{ color:'#2563eb', fontWeight:700 }}>{form.infill}%</span>
                      <span style={{ fontWeight:400, color:'#9ca3af', marginLeft:8 }}>
                        {form.infill<=20?'경량':form.infill<=50?'일반':form.infill<=80?'강도 우선':'솔리드'}
                      </span>
                    </label>
                    <input type="range" min={10} max={100} step={5} value={form.infill} onChange={e=>upd('infill',parseInt(e.target.value))} style={{ accentColor:'#2563eb' }} />
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'#9ca3af' }}>
                      <span>10% 경량</span><span>50% 일반</span><span>100% 솔리드</span>
                    </div>
                  </div>
                )}
              </div>

              {disc > 0 && (
                <div style={{ ...S.alert, background:'#f0fdf4', border:'1px solid #86efac', color:'#14532d' }}>
                  ✅ <span>{form.qty}개 이상 주문 — <b>{disc}% 수량 할인</b> 자동 적용됩니다</span>
                </div>
              )}

              <div style={{ display:'flex', justifyContent:'space-between', marginTop:8 }}>
                <button style={S.sBtn} onClick={()=>setStep(1)}>← 이전</button>
                <button style={{ ...S.btn, background:'#2563eb', color:'#fff' }} onClick={()=>setStep(3)}>견적 확인 →</button>
              </div>
            </>
          )}

          {/* ── STEP 3 ── */}
          {step === 3 && (
            <>
              <p style={{ color:'#6b7280', marginBottom:16 }}>아래 내용을 확인하고 견적 요청을 제출해 주세요.</p>

              {/* 파일 / 사이즈 정보 */}
              <div style={{ background:'#f9fafb', borderRadius:12, padding:'14px 18px', marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#9ca3af', textTransform:'uppercase', letterSpacing:'.4px', marginBottom:10 }}>모델 정보</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
                  <div>
                    <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>파일명</div>
                    <div style={{ fontSize:13, fontWeight:600, wordBreak:'break-all' }}>{form.file?.name||'-'}</div>
                  </div>
                  {form.sizeX != null && <>
                    <div>
                      <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>X (가로)</div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{form.sizeX} mm</div>
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>Y (세로)</div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{form.sizeY} mm</div>
                    </div>
                    <div>
                      <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>Z (높이)</div>
                      <div style={{ fontSize:13, fontWeight:600 }}>{form.sizeZ} mm</div>
                    </div>
                  </>}
                  <div>
                    <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2 }}>부피</div>
                    <div style={{ fontSize:13, fontWeight:600 }}>{form.vol} cm³</div>
                  </div>
                </div>
              </div>

              {/* 출력 사양 */}
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:14 }}>
                {[
                  ['출력 방식', METHODS[form.method].label],
                  ['소재', form.material],
                  ['색상', form.color],
                  ['품질', form.quality],
                  ['수량', form.qty+'개'],
                  ...(form.method==='FDM'?[['충전율',form.infill+'%']]:[] as [string,string][]),
                ].map(([l,v]) => (
                  <div key={l} style={{ background:'#f9fafb', borderRadius:8, padding:'10px 12px' }}>
                    <div style={{ fontSize:11, color:'#9ca3af', marginBottom:2, fontWeight:600, textTransform:'uppercase', letterSpacing:'.3px' }}>{l}</div>
                    <div style={{ fontSize:14, fontWeight:600 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* 금액 / 납기 */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
                <div style={{ background:'#fff', border:'1.5px solid #e5e7eb', borderRadius:12, padding:20 }}>
                  <div style={{ fontSize:12, color:'#6b7280', marginBottom:8 }}>💰 예상 금액 (VAT 별도)</div>
                  <div style={{ fontSize:28, fontWeight:800, letterSpacing:-1 }}>{form.vol ? krw(price) : '분석 필요'}</div>
                  {disc>0 && <div style={{ fontSize:12, color:'#16a34a', fontWeight:600, marginTop:4 }}>수량 할인 {disc}% 적용</div>}
                  <div style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>담당자 검토 후 최종 확정</div>
                </div>
                <div style={{ background:'#fff', border:'1.5px solid #e5e7eb', borderRadius:12, padding:20 }}>
                  <div style={{ fontSize:12, color:'#6b7280', marginBottom:8 }}>📅 예상 납기</div>
                  <div style={{ fontSize:24, fontWeight:800 }}>{days}</div>
                  <div style={{ fontSize:12, color:'#9ca3af', marginTop:4 }}>영업일 기준 / 변동 가능</div>
                </div>
              </div>

              <div style={{ ...S.alert, background:'#fffbeb', border:'1px solid #fcd34d', color:'#92400e' }}>
                <span>⚠️</span>
                <span>위 금액은 파일 부피 기반 <b>자동 계산 예상 견적</b>입니다. 담당자 검토 후 <b>확정 견적을 이메일로 안내</b>드립니다.</span>
              </div>

              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <button style={S.sBtn} onClick={()=>setStep(2)}>← 이전</button>
                <button
                  style={{ ...S.btn, background: loading?'#9ca3af':'#16a34a', color:'#fff', cursor:loading?'wait':'pointer' }}
                  onClick={submit} disabled={loading}
                >
                  {loading ? '제출 중...' : '✓ 견적 요청 제출'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24 }}>
      <div>
        <div style={{ fontSize:22, fontWeight:700, letterSpacing:-.5 }}>🖨️ 3D 프린팅 견적 시스템</div>
        <div style={{ fontSize:13, color:'#6b7280', marginTop:2 }}>FDM · SLA/DLP · SLS · MJF — 자동 견적 + 담당자 확인</div>
      </div>
    </div>
  )
}
