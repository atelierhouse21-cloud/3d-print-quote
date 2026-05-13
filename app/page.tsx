'use client'
import { useState, useRef, useEffect } from 'react'
import { METHODS, MATS, COLS, QUAL, calcPrice, calcDays, krw } from '@/lib/constants'

// ── STL 파서 ──────────────────────────────────────────
function isBinarySTL(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const n = view.getUint32(80, true)
  return buffer.byteLength === 84 + n * 50
}
function parseBinarySTL(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer)
  const n = view.getUint32(80, true)
  const v = new Float32Array(n * 9)
  let o = 84
  for (let i = 0; i < n; i++) {
    o += 12
    for (let j = 0; j < 9; j++) { v[i*9+j] = view.getFloat32(o, true); o += 4 }
    o += 2
  }
  return v
}
function parseASCIISTL(text: string): Float32Array {
  const v: number[] = []
  const re = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) v.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
  return new Float32Array(v)
}
function parseSTL(buffer: ArrayBuffer): Float32Array {
  const h = new TextDecoder().decode(buffer.slice(0, 5))
  if (h === 'solid' && !isBinarySTL(buffer)) return parseASCIISTL(new TextDecoder().decode(buffer))
  return parseBinarySTL(buffer)
}
function calcVolume(v: Float32Array): number {
  let vol = 0
  for (let i = 0; i < v.length; i += 9)
    vol += (v[i]*(v[i+4]*v[i+8]-v[i+7]*v[i+5]) - v[i+1]*(v[i+3]*v[i+8]-v[i+6]*v[i+5]) + v[i+2]*(v[i+3]*v[i+7]-v[i+6]*v[i+4])) / 6
  return parseFloat((Math.abs(vol)/1000).toFixed(2))
}
function calcBBox(v: Float32Array) {
  let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity
  for (let i = 0; i < v.length; i+=3) {
    if(v[i]<x0)x0=v[i]; if(v[i]>x1)x1=v[i]
    if(v[i+1]<y0)y0=v[i+1]; if(v[i+1]>y1)y1=v[i+1]
    if(v[i+2]<z0)z0=v[i+2]; if(v[i+2]>z1)z1=v[i+2]
  }
  return { x:parseFloat((x1-x0).toFixed(1)), y:parseFloat((y1-y0).toFixed(1)), z:parseFloat((z1-z0).toFixed(1)),
           cx:(x0+x1)/2, cy:(y0+y1)/2, cz:(z0+z1)/2 }
}

// ── Canvas 2D 렌더러 (Three.js 없이 등축 투영) ──────────
function renderSTL(canvas: HTMLCanvasElement, verts: Float32Array, bbox: ReturnType<typeof calcBBox>) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = '#f9fafb'
  ctx.fillRect(0, 0, W, H)

  // 등축 투영 행렬 (isometric)
  const ax = Math.PI / 6, ay = Math.PI / 4
  const ca = Math.cos(ax), sa = Math.sin(ax)
  const cb = Math.cos(ay), sb = Math.sin(ay)
  const proj = (x: number, y: number, z: number) => {
    const rx = cb*x + sb*z
    const ry = -sa*(-sb*x+cb*z) + ca*y
    return { px: rx, py: ry }
  }

  const scale = Math.min(W, H) * 0.55 / Math.max(bbox.x||1, bbox.y||1, bbox.z||1)
  const cx = bbox.cx, cy = bbox.cy, cz = bbox.cz

  // 삼각형 수집 및 깊이 정렬
  const tris: { d: number; pts: {px:number;py:number}[]; nx:number;ny:number;nz:number }[] = []
  for (let i = 0; i < verts.length; i += 9) {
    const pts = []
    let depth = 0
    for (let j = 0; j < 3; j++) {
      const p = proj((verts[i+j*3]-cx)*scale, (verts[i+j*3+1]-cy)*scale, (verts[i+j*3+2]-cz)*scale)
      pts.push({ px: p.px + W/2, py: -p.py + H/2 })
      depth += verts[i+j*3+2]
    }
    // 노멀 계산 (조명)
    const ax2=verts[i+3]-verts[i], ay2=verts[i+4]-verts[i+1], az2=verts[i+5]-verts[i+2]
    const bx=verts[i+6]-verts[i], by2=verts[i+7]-verts[i+1], bz=verts[i+8]-verts[i+2]
    const nx=ay2*bz-az2*by2, ny=az2*bx-ax2*bz, nz=ax2*by2-ay2*bx
    const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1
    tris.push({ d:depth/3, pts, nx:nx/nl, ny:ny/nl, nz:nz/nl })
  }
  tris.sort((a,b) => a.d - b.d)

  // 빛 방향
  const lx=0.5, ly=0.8, lz=0.3, ll=Math.sqrt(lx*lx+ly*ly+lz*lz)
  for (const t of tris) {
    const diff = Math.max(0, (t.nx*lx/ll + t.ny*ly/ll + t.nz*lz/ll))
    const bright = Math.round(40 + diff * 180)
    ctx.beginPath()
    ctx.moveTo(t.pts[0].px, t.pts[0].py)
    ctx.lineTo(t.pts[1].px, t.pts[1].py)
    ctx.lineTo(t.pts[2].px, t.pts[2].py)
    ctx.closePath()
    ctx.fillStyle = `rgb(${Math.round(bright*0.3)},${Math.round(bright*0.5)},${bright})`
    ctx.fill()
  }
}

// ── STL 뷰어 ────────────────────────────────────────────
type STLInfo = { x:number; y:number; z:number; volume:number }
function STLViewer({ file, onAnalyzed }: { file:File; onAnalyzed:(i:STLInfo)=>void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [info, setInfo] = useState<STLInfo|null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)
  const [tick, setTick] = useState(0)
  const dragging = useRef(false)
  const lastX = useRef(0)
  const lastY = useRef(0)
  const vertsRef = useRef<Float32Array|null>(null)
  const bboxRef = useRef<ReturnType<typeof calcBBox>|null>(null)
  const rotY = useRef(0.4)   // 수평 회전 (Y축)
  const rotX = useRef(-0.3)  // 수직 회전 (X축)
  const zoom = useRef(1.0)

  useEffect(() => {
    if (!file) return
    setLoading(true); setErr(false)
    file.arrayBuffer().then(buf => {
      try {
        const v = parseSTL(buf)
        const bbox = calcBBox(v)
        const volume = calcVolume(v)
        const si: STLInfo = { x:bbox.x, y:bbox.y, z:bbox.z, volume }
        setInfo(si); onAnalyzed(si)
        vertsRef.current = v; bboxRef.current = bbox
        rotY.current = 0.4; rotX.current = -0.3; zoom.current = 1.0
        setLoading(false)
      } catch { setErr(true); setLoading(false) }
    }).catch(() => { setErr(true); setLoading(false) })
  }, [file])

  useEffect(() => {
    if (!canvasRef.current || !vertsRef.current || !bboxRef.current) return
    draw()
  }, [loading, tick])

  function draw() {
    const canvas = canvasRef.current
    const verts = vertsRef.current
    const bbox = bboxRef.current
    if (!canvas || !verts || !bbox) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0,0,W,H)
    ctx.fillStyle = '#f9fafb'; ctx.fillRect(0,0,W,H)

    const baseScale = Math.min(W,H) * 0.45 / Math.max(bbox.x||1, bbox.y||1, bbox.z||1)
    const scale = baseScale * zoom.current
    const cx=bbox.cx, cy=bbox.cy, cz=bbox.cz
    const ry=rotY.current, rx=rotX.current
    const cry=Math.cos(ry), sry=Math.sin(ry)
    const crx=Math.cos(rx), srx=Math.sin(rx)

    // Y축 회전 후 X축 회전
    const proj = (x:number,y:number,z:number) => {
      // Y축 회전
      const x1= cry*x + sry*z
      const z1=-sry*x + cry*z
      // X축 회전
      const y2= crx*y - srx*z1
      const z2= srx*y + crx*z1
      return { px: x1, py: y2, pz: z2 }
    }

    const tris: {d:number;pts:{px:number;py:number}[];nx:number;ny:number;nz:number}[] = []
    for (let i=0; i<verts.length; i+=9) {
      const pts=[]
      let d=0
      for (let j=0; j<3; j++) {
        const p = proj((verts[i+j*3]-cx)*scale, (verts[i+j*3+1]-cy)*scale, (verts[i+j*3+2]-cz)*scale)
        pts.push({px: p.px+W/2, py: -p.py+H/2}); d += p.pz
      }
      // 노멀
      const ax2=verts[i+3]-verts[i], ay2=verts[i+4]-verts[i+1], az2=verts[i+5]-verts[i+2]
      const bx2=verts[i+6]-verts[i], by2=verts[i+7]-verts[i+1], bz2=verts[i+8]-verts[i+2]
      const nx=ay2*bz2-az2*by2, ny=az2*bx2-ax2*bz2, nz=ax2*by2-ay2*bx2
      const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1
      tris.push({d:d/3, pts, nx:nx/nl, ny:ny/nl, nz:nz/nl})
    }
    tris.sort((a,b)=>a.d-b.d)

    const lx=0.4, ly=0.7, lz=0.6, ll=Math.sqrt(lx*lx+ly*ly+lz*lz)
    for (const t of tris) {
      const diff = Math.max(0, t.nx*lx/ll + t.ny*ly/ll + t.nz*lz/ll)
      const amb = 0.25
      const bright = Math.round((amb + diff*(1-amb)) * 220)
      ctx.beginPath()
      ctx.moveTo(t.pts[0].px, t.pts[0].py)
      ctx.lineTo(t.pts[1].px, t.pts[1].py)
      ctx.lineTo(t.pts[2].px, t.pts[2].py)
      ctx.closePath()
      ctx.fillStyle = `rgb(${Math.round(bright*0.28)},${Math.round(bright*0.48)},${bright})`
      ctx.fill()
    }
  }

  const onMouseDown = (e: React.MouseEvent) => {
    dragging.current = true; lastX.current = e.clientX; lastY.current = e.clientY
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = (e.clientX - lastX.current) * 0.008
    const dy = (e.clientY - lastY.current) * 0.008
    lastX.current = e.clientX; lastY.current = e.clientY
    rotY.current += dx
    rotX.current += dy
    // X축 회전 범위 제한 (-90° ~ +90°)
    rotX.current = Math.max(-Math.PI/2, Math.min(Math.PI/2, rotX.current))
    setTick(t => t+1)
  }
  const onMouseUp = () => { dragging.current = false }
  const viewerRef = useRef<HTMLDivElement>(null)

  // passive:false 로 휠 이벤트 직접 등록 (React 기본값은 passive:true 라 preventDefault 불가)
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      zoom.current *= e.deltaY > 0 ? 0.9 : 1.1
      zoom.current = Math.max(0.2, Math.min(5.0, zoom.current))
      setTick(t => t+1)
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])

  return (
    <div style={{borderRadius:12,overflow:'hidden',border:'1.5px solid #e5e7eb',marginBottom:16}}>
      <div ref={viewerRef} style={{position:'relative',background:'#f9fafb',height:300,cursor:dragging.current?'grabbing':'grab'}}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        {loading&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:10,color:'#6b7280'}}>
          <div style={{fontSize:32}}>⏳</div><div style={{fontSize:13}}>3D 모델 분석 중...</div>
        </div>}
        {err&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'#9ca3af'}}>
          <div style={{fontSize:32}}>📄</div><div style={{fontSize:13}}>미리보기를 불러올 수 없습니다</div>
        </div>}
        <canvas ref={canvasRef} width={720} height={300}
          style={{width:'100%',height:'100%',display:loading||err?'none':'block'}}/>
        {!loading&&!err&&<div style={{position:'absolute',bottom:8,right:10,fontSize:11,color:'#9ca3af',
          background:'rgba(255,255,255,0.85)',padding:'4px 10px',borderRadius:6,pointerEvents:'none'}}>
          🖱 드래그: 360° 회전 &nbsp;|&nbsp; 휠: 확대/축소
        </div>}
      </div>
      {info&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderTop:'1px solid #e5e7eb'}}>
          {[['X (가로)',info.x+' mm'],['Y (세로)',info.y+' mm'],['Z (높이)',info.z+' mm'],['부피',info.volume+' cm³']].map(([l,v],i)=>(
            <div key={l} style={{padding:'10px 14px',textAlign:'center',borderRight:i<3?'1px solid #e5e7eb':'none',background:'#fff'}}>
              <div style={{fontSize:10,color:'#9ca3af',fontWeight:700,textTransform:'uppercase' as const,letterSpacing:'.3px',marginBottom:3}}>{l}</div>
              <div style={{fontSize:14,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 메인 폼 ──────────────────────────────────────────────
type FormState = {
  name:string;email:string;company:string;phone:string;note:string
  file:File|null;vol:number|null;sizeX:number|null;sizeY:number|null;sizeZ:number|null
  method:string;material:string;color:string;quality:string;qm:number;qty:number;infill:number
}
const BLANK:FormState = {
  name:'',email:'',company:'',phone:'',note:'',file:null,vol:null,sizeX:null,sizeY:null,sizeZ:null,
  method:'FDM',material:'PLA',color:'White',quality:'Standard (0.2mm)',qm:1.0,qty:1,infill:20,
}
const S:Record<string,React.CSSProperties> = {
  wrap:{maxWidth:760,margin:'0 auto',padding:'24px 16px 60px'},
  card:{background:'#fff',borderRadius:16,border:'1px solid #e5e7eb',overflow:'hidden'},
  body:{padding:28},
  row:{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:20},
  grp:{display:'flex',flexDirection:'column',gap:6},
  lbl:{fontSize:12,fontWeight:700,color:'#374151',textTransform:'uppercase',letterSpacing:'.4px'},
  btn:{padding:'10px 24px',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',border:'none',display:'inline-flex',alignItems:'center',gap:6},
  sBtn:{background:'#fff',color:'#374151',border:'1.5px solid #d1d5db',padding:'10px 22px',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer'},
  alert:{display:'flex',gap:10,padding:'12px 14px',borderRadius:10,fontSize:13,lineHeight:'1.5',marginBottom:16,alignItems:'flex-start'},
}

export default function Home() {
  const [step,setStep]=useState(1)
  const [done,setDone]=useState<string|null>(null)
  const [loading,setLoading]=useState(false)
  const [form,setForm]=useState<FormState>(BLANK)
  const [drag,setDrag]=useState(false)
  const [showViewer,setShowViewer]=useState(false)
  const fileRef=useRef<HTMLInputElement>(null)

  const upd=(k:keyof FormState,v:any)=>setForm(p=>({...p,[k]:v}))
  const setMethod=(m:string)=>setForm(p=>({...p,method:m,material:MATS[m][0],color:COLS[m][0],quality:QUAL[m][0].v,qm:QUAL[m][0].m}))

  const handleFile=(f:File|null)=>{
    if(!f)return
    const ext=f.name.split('.').pop()?.toLowerCase()
    if(!['stl','obj','3mf','step','stp','iges'].includes(ext||'')){alert('지원 형식: STL · OBJ · 3MF · STEP · IGES');return}
    const isSTL=ext==='stl'
    setShowViewer(isSTL)
    if(isSTL){setForm(p=>({...p,file:f,vol:null,sizeX:null,sizeY:null,sizeZ:null}))}
    else{const est=parseFloat(((f.size/1024/1024)*8+5).toFixed(1));setForm(p=>({...p,file:f,vol:est,sizeX:null,sizeY:null,sizeZ:null}))}
  }

  const onAnalyzed=(info:STLInfo)=>setForm(p=>({...p,vol:info.volume,sizeX:info.x,sizeY:info.y,sizeZ:info.z}))
  const price=form.vol?calcPrice(form.method,form.vol,form.qm,form.qty,form.infill):0
  const days=calcDays(form.method,form.qty)
  const disc=form.qty>=10?15:form.qty>=5?8:0

  const submit=async()=>{
    setLoading(true)
    try{
      const fd=new FormData()
      ;['name','email','company','phone','note','method','material','color','quality'].forEach(k=>fd.append(k,(form as any)[k]))
      fd.append('qty',String(form.qty));fd.append('infill',String(form.infill))
      fd.append('qm',String(form.qm));fd.append('vol',String(form.vol||0))
      fd.append('sizeX',String(form.sizeX||0));fd.append('sizeY',String(form.sizeY||0));fd.append('sizeZ',String(form.sizeZ||0))
      if(form.file)fd.append('file',form.file)
      const res=await fetch('/api/quotes',{method:'POST',body:fd})
      const json=await res.json()
      if(!json.ok)throw new Error(json.error)
      setDone(json.quote_no)
    }catch(e:any){alert('오류가 발생했습니다: '+e.message)}
    finally{setLoading(false)}
  }

  const STEP_LABELS=['고객 정보 & 파일','출력 설정','견적 확인']

  if(done)return(
    <div style={S.wrap}><Logo/>
      <div style={S.card}><div style={{...S.body,textAlign:'center',padding:'52px 28px'}}>
        <div style={{fontSize:64,marginBottom:20}}>🎉</div>
        <h2 style={{fontSize:22,fontWeight:700,marginBottom:10}}>견적 요청이 접수되었습니다!</h2>
        <p style={{color:'#6b7280',lineHeight:1.8,marginBottom:28}}>
          <b>{form.email}</b>으로 접수 확인 메일을 발송했습니다.<br/>
          담당자 검토 후 <b>1~2 영업일 이내</b> 최종 견적을 안내드립니다.<br/>
          <span style={{fontSize:13,color:'#9ca3af'}}>견적 번호: {done}</span>
        </p>
        <button style={S.sBtn} onClick={()=>{setDone(null);setStep(1);setForm(BLANK);setShowViewer(false)}}>새 견적 요청</button>
      </div></div>
    </div>
  )

  return(
    <div style={S.wrap}><Logo/>
      <div style={S.card}>
        <div style={{display:'flex',alignItems:'center',padding:'18px 28px',background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
          {STEP_LABELS.map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',flex:i<STEP_LABELS.length-1?1:undefined}}>
              <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
                <div style={{width:26,height:26,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0,
                  background:step>i+1?'#16a34a':step===i+1?'#2563eb':'#fff',
                  border:`2px solid ${step>i+1?'#16a34a':step===i+1?'#2563eb':'#d1d5db'}`,
                  color:step>i+1||step===i+1?'#fff':'#9ca3af'}}>
                  {step>i+1?'✓':i+1}
                </div>
                <span style={{fontSize:13,whiteSpace:'nowrap',color:step===i+1?'#1a1a1a':'#9ca3af',fontWeight:step===i+1?600:400}}>{s}</span>
              </div>
              {i<STEP_LABELS.length-1&&<div style={{flex:1,height:1,background:'#d1d5db',margin:'0 10px'}}/>}
            </div>
          ))}
        </div>

        <div style={S.body}>
          {step===1&&<>
            <p style={{color:'#6b7280',marginBottom:20}}>견적 요청에 필요한 기본 정보와 3D 파일을 업로드해 주세요.</p>
            <div style={S.row}>
              <div style={S.grp}><label style={S.lbl}>이름 *</label><input type="text" value={form.name} onChange={e=>upd('name',e.target.value)} placeholder="홍길동"/></div>
              <div style={S.grp}><label style={S.lbl}>이메일 *</label><input type="email" value={form.email} onChange={e=>upd('email',e.target.value)} placeholder="example@mail.com"/></div>
              <div style={S.grp}><label style={S.lbl}>회사 / 기관</label><input type="text" value={form.company} onChange={e=>upd('company',e.target.value)} placeholder="(주)회사명 또는 개인"/></div>
              <div style={S.grp}><label style={S.lbl}>연락처</label><input type="tel" value={form.phone} onChange={e=>upd('phone',e.target.value)} placeholder="010-0000-0000"/></div>
            </div>
            <label style={{...S.lbl,display:'block',marginBottom:8}}>3D 파일 업로드 *</label>
            <div onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0])}}
              onClick={()=>fileRef.current?.click()}
              style={{border:`2px dashed ${drag?'#2563eb':form.file?'#16a34a':'#d1d5db'}`,borderRadius:12,
                padding:form.file&&showViewer?'14px 20px':'32px 20px',textAlign:'center',cursor:'pointer',
                marginBottom:16,background:drag?'#eff6ff':form.file?'#f0fdf4':'#f9fafb',transition:'all .15s'}}>
              <input ref={fileRef} type="file" accept=".stl,.obj,.3mf,.step,.stp,.iges" style={{display:'none'}} onChange={e=>handleFile(e.target.files?.[0]||null)}/>
              {form.file?<>
                <div style={{fontSize:24,marginBottom:6}}>📄</div>
                <div style={{fontWeight:600,marginBottom:3}}>{form.file.name}</div>
                <div style={{fontSize:12,color:'#6b7280'}}>클릭하여 파일 변경</div>
              </>:<>
                <div style={{fontSize:40,marginBottom:10}}>☁️</div>
                <div style={{fontWeight:600,marginBottom:4}}>파일을 드래그하거나 클릭하여 업로드</div>
                <div style={{fontSize:12,color:'#6b7280'}}>지원 형식: STL · OBJ · 3MF · STEP · IGES</div>
              </>}
            </div>
            {form.file&&showViewer&&<STLViewer file={form.file} onAnalyzed={onAnalyzed}/>}
            {form.file&&!showViewer&&(
              <div style={{...S.alert,background:'#fffbeb',border:'1px solid #fcd34d',color:'#92400e'}}>
                <span>ℹ️</span><span>STL 파일은 3D 미리보기와 자동 사이즈/부피 계산이 지원됩니다.</span>
              </div>
            )}
            <div style={S.grp}>
              <label style={S.lbl}>요청 사항</label>
              <textarea value={form.note} onChange={e=>upd('note',e.target.value)} placeholder="납기 요청, 표면 처리, 색상 등 특이 사항을 입력하세요"/>
            </div>
            <div style={{display:'flex',justifyContent:'flex-end',marginTop:24}}>
              <button style={{...S.btn,background:'#2563eb',color:'#fff'}}
                onClick={()=>{if(!form.name.trim()||!form.email.trim()||!form.file){alert('이름, 이메일, 파일은 필수입니다.');return}setStep(2)}}>
                다음 단계 →
              </button>
            </div>
          </>}

          {step===2&&<>
            <p style={{color:'#6b7280',marginBottom:18}}>출력 방식과 소재, 품질, 수량을 선택해 주세요.</p>
            <label style={{...S.lbl,display:'block',marginBottom:8}}>출력 방식 선택</label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
              {Object.entries(METHODS).map(([k,m])=>(
                <button key={k} onClick={()=>setMethod(k)} style={{border:form.method===k?'2px solid #2563eb':'1.5px solid #e5e7eb',borderRadius:10,padding:'12px 16px',cursor:'pointer',textAlign:'left',background:form.method===k?'#eff6ff':'#fff',transition:'all .15s'}}>
                  <div style={{fontSize:15,fontWeight:700,color:form.method===k?'#2563eb':'#1a1a1a'}}>{m.label}</div>
                  <div style={{fontSize:12,color:form.method===k?'#3b82f6':'#6b7280',marginTop:2}}>{m.sub} · ₩{m.price.toLocaleString()}/cm³~</div>
                </button>
              ))}
            </div>
            <div style={S.row}>
              <div style={S.grp}><label style={S.lbl}>소재</label><select value={form.material} onChange={e=>upd('material',e.target.value)}>{MATS[form.method].map(v=><option key={v}>{v}</option>)}</select></div>
              <div style={S.grp}><label style={S.lbl}>색상</label><select value={form.color} onChange={e=>upd('color',e.target.value)}>{COLS[form.method].map(v=><option key={v}>{v}</option>)}</select></div>
              <div style={S.grp}><label style={S.lbl}>출력 품질</label><select value={form.quality} onChange={e=>{const q=QUAL[form.method].find(x=>x.v===e.target.value);setForm(p=>({...p,quality:e.target.value,qm:q?.m||1.0}))}}>{QUAL[form.method].map(q=><option key={q.v}>{q.v}</option>)}</select></div>
              <div style={S.grp}><label style={S.lbl}>수량</label><input type="number" min={1} max={9999} value={form.qty} onChange={e=>upd('qty',Math.max(1,parseInt(e.target.value)||1))}/></div>
              {form.method==='FDM'&&<div style={{...S.grp,gridColumn:'1/-1'}}>
                <label style={S.lbl}>충전율 (Infill): <span style={{color:'#2563eb',fontWeight:700}}>{form.infill}%</span> <span style={{fontWeight:400,color:'#9ca3af'}}>{form.infill<=20?'경량':form.infill<=50?'일반':form.infill<=80?'강도 우선':'솔리드'}</span></label>
                <input type="range" min={10} max={100} step={5} value={form.infill} onChange={e=>upd('infill',parseInt(e.target.value))} style={{accentColor:'#2563eb'}}/>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#9ca3af'}}><span>10% 경량</span><span>50% 일반</span><span>100% 솔리드</span></div>
              </div>}
            </div>
            {disc>0&&<div style={{...S.alert,background:'#f0fdf4',border:'1px solid #86efac',color:'#14532d'}}>✅ <span>{form.qty}개 이상 — <b>{disc}% 수량 할인</b> 자동 적용</span></div>}
            <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
              <button style={S.sBtn} onClick={()=>setStep(1)}>← 이전</button>
              <button style={{...S.btn,background:'#2563eb',color:'#fff'}} onClick={()=>setStep(3)}>견적 확인 →</button>
            </div>
          </>}

          {step===3&&<>
            <p style={{color:'#6b7280',marginBottom:16}}>아래 내용을 확인하고 견적 요청을 제출해 주세요.</p>
            <div style={{background:'#f9fafb',borderRadius:12,padding:'14px 18px',marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:'#9ca3af',textTransform:'uppercase' as const,letterSpacing:'.4px',marginBottom:10}}>모델 정보</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                <div><div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>파일명</div><div style={{fontSize:13,fontWeight:600,wordBreak:'break-all'}}>{form.file?.name||'-'}</div></div>
                {form.sizeX!=null&&<>
                  <div><div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>X (가로)</div><div style={{fontSize:13,fontWeight:600}}>{form.sizeX} mm</div></div>
                  <div><div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>Y (세로)</div><div style={{fontSize:13,fontWeight:600}}>{form.sizeY} mm</div></div>
                  <div><div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>Z (높이)</div><div style={{fontSize:13,fontWeight:600}}>{form.sizeZ} mm</div></div>
                </>}
                <div><div style={{fontSize:11,color:'#9ca3af',marginBottom:2}}>부피</div><div style={{fontSize:13,fontWeight:600}}>{form.vol??'-'} cm³</div></div>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:14}}>
              {([['출력 방식',METHODS[form.method].label],['소재',form.material],['색상',form.color],['품질',form.quality],['수량',form.qty+'개'],...(form.method==='FDM'?[['충전율',form.infill+'%']]:[])] as [string,string][]).map(([l,v])=>(
                <div key={l} style={{background:'#f9fafb',borderRadius:8,padding:'10px 12px'}}>
                  <div style={{fontSize:11,color:'#9ca3af',marginBottom:2,fontWeight:600,textTransform:'uppercase' as const,letterSpacing:'.3px'}}>{l}</div>
                  <div style={{fontSize:14,fontWeight:600}}>{v}</div>
                </div>
              ))}
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:14}}>
              <div style={{background:'#fff',border:'1.5px solid #e5e7eb',borderRadius:12,padding:20}}>
                <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>💰 예상 금액 (VAT 별도)</div>
                <div style={{fontSize:28,fontWeight:800,letterSpacing:-1}}>{form.vol?krw(price):'담당자 산출'}</div>
                {disc>0&&<div style={{fontSize:12,color:'#16a34a',fontWeight:600,marginTop:4}}>수량 할인 {disc}% 적용</div>}
                <div style={{fontSize:12,color:'#9ca3af',marginTop:4}}>담당자 검토 후 최종 확정</div>
              </div>
              <div style={{background:'#fff',border:'1.5px solid #e5e7eb',borderRadius:12,padding:20}}>
                <div style={{fontSize:12,color:'#6b7280',marginBottom:8}}>📅 예상 납기</div>
                <div style={{fontSize:24,fontWeight:800}}>{days}</div>
                <div style={{fontSize:12,color:'#9ca3af',marginTop:4}}>영업일 기준 / 변동 가능</div>
              </div>
            </div>
            <div style={{...S.alert,background:'#fffbeb',border:'1px solid #fcd34d',color:'#92400e'}}>
              <span>⚠️</span><span>위 금액은 자동 계산 예상 견적입니다. 담당자 검토 후 <b>확정 견적을 이메일로 안내</b>드립니다.</span>
            </div>
            <div style={{display:'flex',justifyContent:'space-between'}}>
              <button style={S.sBtn} onClick={()=>setStep(2)}>← 이전</button>
              <button style={{...S.btn,background:loading?'#9ca3af':'#16a34a',color:'#fff',cursor:loading?'wait':'pointer'}} onClick={submit} disabled={loading}>
                {loading?'제출 중...':'✓ 견적 요청 제출'}
              </button>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}

function Logo() {
  return(
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
      <div>
        <div style={{fontSize:22,fontWeight:700,letterSpacing:-.5}}>🖨️ 3D 프린팅 견적 시스템</div>
        <div style={{fontSize:13,color:'#6b7280',marginTop:2}}>FDM · SLA/DLP · SLS · MJF — 자동 견적 + 담당자 확인</div>
      </div>
    </div>
  )
}
