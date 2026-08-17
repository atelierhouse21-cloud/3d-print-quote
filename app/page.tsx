'use client'
import { useState, useRef, useEffect } from 'react'
  import * as THREE from 'three'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { METHODS, calcDays, krw, calcPriceV2, calcPriceFDM, normalizeSettings, defaultSettings, defaultMethodCfg, RETENTION_MONTHS, priceBreakdown, SHIPPING_FEE } from '@/lib/constants'
import type { PrintOptions, MethodCfg, MaterialCfg, QualityCfg } from '@/lib/constants'

// ── 모바일(세로 화면) 감지 훅 ─────────────────────────
// 화면 폭이 좁아지면 가로 배치를 세로(1열)로 자동 전환한다.
function useIsMobile(breakpoint = 640) {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener('resize', check)
    window.addEventListener('orientationchange', check)
    return () => {
      window.removeEventListener('resize', check)
      window.removeEventListener('orientationchange', check)
    }
  }, [breakpoint])
  return isMobile
}

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
// 표면적(cm²) — 삼각형 넓이의 합. 입력 좌표는 mm 기준이라 mm²→cm²(÷100)
function calcSurfaceArea(v: Float32Array): number {
  let area = 0
  for (let i = 0; i < v.length; i += 9) {
    const ax=v[i+3]-v[i], ay=v[i+4]-v[i+1], az=v[i+5]-v[i+2]
    const bx=v[i+6]-v[i], by=v[i+7]-v[i+1], bz=v[i+8]-v[i+2]
    const cx=ay*bz-az*by, cy=az*bx-ax*bz, cz=ax*by-ay*bx
    area += Math.sqrt(cx*cx+cy*cy+cz*cz) / 2
  }
  return parseFloat((area/100).toFixed(2))
}
function calcBBox(v: Float32Array) {
  let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity
  for (let i = 0; i < v.length; i+=3) {
    if(v[i]<x0)x0=v[i]; if(v[i]>x1)x1=v[i]
    if(v[i+1]<y0)y0=v[i+1]; if(v[i+1]>y1)y1=v[i+1]
    if(v[i+2]<z0)z0=v[i+2]; if(v[i+2]>z1)z1=v[i+2]
  }
  return { x:parseFloat((x1-x0).toFixed(1)), y:parseFloat((y1-y0).toFixed(1)), z:parseFloat((z1-z0).toFixed(1)), cx:(x0+x1)/2, cy:(y0+y1)/2, cz:(z0+z1)/2 }
}

// 같은 평면/매끈한 곡면이 한 덩어리처럼 보이도록, 정점별 평균 법선(스무스 셰이딩) 계산
// 표시(미리보기)용으로 삼각형 수를 줄임 — 견적 계산(부피/크기/개체수)은 원본을 그대로 사용
function decimateForRender(v: Float32Array, maxTris: number): Float32Array {
  const tri = v.length / 9
  if (tri <= maxTris) return v
  const stride = Math.ceil(tri / maxTris)
  const keep = Math.ceil(tri / stride)
  const out = new Float32Array(keep * 9)
  let w = 0
  for (let t = 0; t < tri; t += stride) {
    const i = t * 9
    out.set(v.subarray(i, i + 9), w); w += 9
  }
  return w === out.length ? out : out.subarray(0, w)
}

function computeSmoothNormals(v: Float32Array): Float32Array {
  const keyOf = (i: number) => `${Math.round(v[i]*1000)},${Math.round(v[i+1]*1000)},${Math.round(v[i+2]*1000)}`
  const map = new Map<string, [number, number, number]>()
  for (let i = 0; i < v.length; i += 9) {
    const ax=v[i+3]-v[i], ay=v[i+4]-v[i+1], az=v[i+5]-v[i+2]
    const bx=v[i+6]-v[i], by=v[i+7]-v[i+1], bz=v[i+8]-v[i+2]
    const fnx=ay*bz-az*by, fny=az*bx-ax*bz, fnz=ax*by-ay*bx  // 면적 가중 법선
    for (const j of [i, i+3, i+6]) {
      const k = keyOf(j); const cur = map.get(k)
      if (cur) { cur[0]+=fnx; cur[1]+=fny; cur[2]+=fnz } else map.set(k, [fnx, fny, fnz])
    }
  }
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i += 3) {
    const a = map.get(keyOf(i))!
    const l = Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]) || 1
    out[i]=a[0]/l; out[i+1]=a[1]/l; out[i+2]=a[2]/l
  }
  return out
}

// STL 내 서로 떨어진 개체(연결 요소) 수 — union-find
function countObjects(v: Float32Array): number {
  const id = new Map<string, number>(); let next = 0
  const getId = (i: number) => {
    const k = `${Math.round(v[i]*1000)},${Math.round(v[i+1]*1000)},${Math.round(v[i+2]*1000)}`
    let x = id.get(k); if (x === undefined) { x = next++; id.set(k, x) } return x
  }
  const tris: [number, number, number][] = []
  for (let i = 0; i < v.length; i += 9) tris.push([getId(i), getId(i+3), getId(i+6)])
  const parent = new Array(next); for (let i = 0; i < next; i++) parent[i] = i
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a: number, b: number) => { const ra=find(a), rb=find(b); if (ra!==rb) parent[ra]=rb }
  for (const t of tris) { union(t[0], t[1]); union(t[1], t[2]) }
  const roots = new Set<number>(); for (let i = 0; i < next; i++) roots.add(find(i))
  return roots.size
}

// ── STL 뷰어 ──────────────────────────────────────────
type STLInfo = { x:number; y:number; z:number; volume:number; surfaceArea:number; objectCount:number|null }
function STLViewer({ file, onAnalyzed, height=240 }: { file:File; onAnalyzed:(i:STLInfo)=>void; height?:number }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [info, setInfo] = useState<STLInfo|null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (!file) return
    let disposed = false
    let renderer: THREE.WebGLRenderer | null = null
    let controls: any = null
    let geometry: THREE.BufferGeometry | null = null
    let material: THREE.Material | null = null
    let ro: ResizeObserver | null = null
    let animId = 0
    setLoading(true); setErr(false)

    file.arrayBuffer().then(buf => {
      if (disposed) return
      try {
        // STL 파싱 (바이너리/아스키 자동)
        geometry = new STLLoader().parse(buf as ArrayBuffer)

        // 분석용: 위치 배열로 부피·크기·개체수 계산 (원본 기준, 정확)
        const verts = geometry.getAttribute('position').array as Float32Array
        const bbox = calcBBox(verts)
        const volume = calcVolume(verts)
        const surfaceArea = calcSurfaceArea(verts)
        const triCount = verts.length / 9
        let objectCount: number | null = null
        if (triCount > 0 && triCount <= 800000) objectCount = countObjects(verts)
        const si: STLInfo = { x:bbox.x, y:bbox.y, z:bbox.z, volume, surfaceArea, objectCount }
        setInfo(si); onAnalyzed(si)

        const mount = mountRef.current
        if (!mount) { setLoading(false); return }
        const W = mount.clientWidth || 500
        const H = height

        // 렌더링 준비
        geometry.center()
        geometry.computeVertexNormals()
        geometry.computeBoundingSphere()
        const radius = geometry.boundingSphere?.radius || 1

        const scene = new THREE.Scene()
        scene.background = new THREE.Color(0xeef1f5)

        const camera = new THREE.PerspectiveCamera(35, W/H, radius*0.01, radius*100)
        const dist = radius / Math.sin((35 * Math.PI/180)/2) * 1.25
        camera.position.set(dist*0.55, dist*0.4, dist*0.95)

        renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setSize(W, H)
        renderer.domElement.style.width = '100%'
        renderer.domElement.style.height = '100%'
        renderer.domElement.style.display = 'block'
        mount.appendChild(renderer.domElement)

        // 조명 (그림자 없음) — 음영 대비를 높여 입체감 강조
        scene.add(new THREE.AmbientLight(0xffffff, 0.45))
        const d1 = new THREE.DirectionalLight(0xffffff, 1.25); d1.position.set(1, 1.4, 1); scene.add(d1)
        const d2 = new THREE.DirectionalLight(0xffffff, 0.4); d2.position.set(-1, 0.4, -0.9); scene.add(d2)

        // 남색 계열 단색 면
        material = new THREE.MeshStandardMaterial({ color: 0x3a5a92, metalness: 0.2, roughness: 0.5 })
        const mesh = new THREE.Mesh(geometry, material)
        scene.add(mesh)

        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.1
        controls.target.set(0, 0, 0)
        controls.update()

        const animate = () => {
          if (disposed || !renderer) return
          animId = requestAnimationFrame(animate)
          controls.update()
          renderer.render(scene, camera)
        }
        animate()

        ro = new ResizeObserver(() => {
          if (!renderer || !mount) return
          const w = mount.clientWidth || W
          renderer.setSize(w, H)
          camera.aspect = w / H
          camera.updateProjectionMatrix()
        })
        ro.observe(mount)

        setLoading(false)
      } catch {
        setErr(true); setLoading(false)
      }
    }).catch(() => { if (!disposed) { setErr(true); setLoading(false) } })

    return () => {
      disposed = true
      cancelAnimationFrame(animId)
      ro?.disconnect()
      try { controls?.dispose?.() } catch {}
      try { geometry?.dispose() } catch {}
      try { (material as any)?.dispose?.() } catch {}
      if (renderer) {
        renderer.dispose()
        const dom = renderer.domElement
        if (dom && dom.parentNode) dom.parentNode.removeChild(dom)
      }
    }
  }, [file, height])

  return (
    <div style={{borderRadius:10,overflow:'hidden',border:'1.5px solid #e5e7eb'}}>
      <div ref={mountRef} style={{position:'relative',background:'#eef1f5',height,touchAction:'none'}}>
        {loading&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,color:'#6b7280',zIndex:1}}>
          <div style={{fontSize:12}}>분석 중...</div>
        </div>}
        {err&&<div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:6,color:'#9ca3af',zIndex:1}}>
          <div style={{fontSize:12}}>미리보기 불가</div>
        </div>}
        {!loading&&!err&&<div style={{position:'absolute',bottom:6,right:8,fontSize:10,color:'#6b7280',background:'rgba(255,255,255,0.85)',padding:'2px 7px',borderRadius:5,pointerEvents:'none',zIndex:1}}>
          드래그·회전 | 휠·핀치·확대 | 우클릭·이동
        </div>}
      </div>
      {info&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',borderTop:'1px solid #e5e7eb',background:'#fff'}}>
          {[['X',info.x+'mm'],['Y',info.y+'mm'],['Z',info.z+'mm'],['부피',info.volume+'㎤']].map(([l,v],i)=>(
            <div key={l} style={{padding:'7px 8px',textAlign:'center',borderRight:i<3?'1px solid #e5e7eb':'none'}}>
              <div style={{fontSize:9,color:'#9ca3af',fontWeight:700,textTransform:'uppercase' as const,marginBottom:2}}>{l}</div>
              <div style={{fontSize:12,fontWeight:700}}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 타입 ──────────────────────────────────────────────
type FileItem = {
  id:string; file:File
  vol:number|null; sizeX:number|null; sizeY:number|null; sizeZ:number|null; objectCount:number|null; manualReview:boolean
  method:string; material:string; density:number; coefficient:number; minPrice:number; color:string; quality:string; factor:number; infill:number; surfaceArea:number|null
  qty:number; note:string
}
type CustomerForm = { name:string; email:string; company:string; phone:string; address:string; addressDetail:string }

// ── 설정 기반 옵션 헬퍼 (options는 항상 정규화되어 존재) ──
function getMethodCfg(options: PrintOptions, method: string): MethodCfg {
  return options[method] || defaultMethodCfg(method)
}
function getMaterials(options: PrintOptions, method: string): MaterialCfg[] {
  const ms = getMethodCfg(options, method).materials
  return ms.length ? ms : defaultMethodCfg(method).materials
}
function getColorsOf(materials: MaterialCfg[], materialName: string): string[] {
  return materials.find(m => m.name === materialName)?.colors || []
}
function getQualities(options: PrintOptions, method: string): QualityCfg[] {
  const qs = getMethodCfg(options, method).qualities
  return qs.length ? qs : defaultMethodCfg(method).qualities
}
function getEnabledMethods(options: PrintOptions): [string, typeof METHODS[string]][] {
  return Object.entries(METHODS).filter(([k]) => options[k]?.enabled !== false)
}

// 한 파일(라인)의 예상 금액: 가격식 결과에 소재별 최소 금액을 하한으로 적용
function linePrice(it: FileItem, options: PrintOptions): number {
  if (!it.vol) return 0
  let p: number
  if (it.method === 'FDM') {
    const cfg = options['FDM']
    const tEff = cfg?.shellThickness ?? 1.1
    const kLoss = cfg?.lossFactor ?? 1.04
    p = calcPriceFDM(it.vol, it.surfaceArea || 0, it.density, it.coefficient, it.qty, it.factor, it.infill, tEff, kLoss)
  } else {
    // 기타 방식(SLA/SLS/MJF)은 기존 방식 유지 — infill(%)이 재료비율 배수 역할(기본 100=×1.0)
    p = calcPriceV2(it.vol, it.density, it.coefficient, it.qty, it.factor, (it.infill ?? 100) / 100)
  }
  return Math.max(p, it.minPrice || 0)
}

// 관리자 확인용 계산 근거(중간값 포함). 제출 시 저장되어 관리자 상세에서 표시됨.
function calcDetail(it: FileItem, options: PrintOptions): any {
  const r2 = (n: number) => Math.round(n * 100) / 100
  const density = it.density, coeff = it.coefficient, factor = it.factor, qty = it.qty
  const vol = it.vol || 0, surf = it.surfaceArea || 0
  const price = linePrice(it, options)
  if (it.method === 'FDM') {
    const cfg = options['FDM']
    const tEff = cfg?.shellThickness ?? 1.1
    const kLoss = cfg?.lossFactor ?? 1.04
    const alpha = Math.min(Math.max(it.infill || 0, 0), 100) / 100
    let vShell = surf * (Math.max(tEff, 0) / 10)
    if (vShell > vol) vShell = vol
    const vInfill = Math.max(vol - vShell, 0)
    const mass = density * (vShell + vInfill * alpha) * qty * kLoss
    return {
      method: 'FDM', volume: vol, surfaceArea: surf, infill: it.infill,
      shellThickness: tEff, lossFactor: kLoss, density, coefficient: coeff, factor, qty,
      vShell: r2(vShell), vInfill: r2(vInfill), mass: r2(mass), minPrice: it.minPrice || 0, price,
    }
  }
  return {
    method: it.method, volume: vol, density, coefficient: coeff, factor, qty,
    materialRatio: it.infill ?? 100, mass: r2(vol * density * qty), minPrice: it.minPrice || 0, price,
  }
}

// 자동 견적이 어려워 담당자 수동 견적이 필요한 파일인지 판정 (다중 개체 또는 최대 출력 사이즈 초과)
function itemNeedsManual(it: FileItem, options: PrintOptions): boolean {
  if (it.objectCount != null && it.objectCount > 1) return true
  const m = getMaterials(options, it.method).find(x => x.name === it.material)
  if (m) {
    if (m.maxX > 0 && it.sizeX != null && it.sizeX > m.maxX) return true
    if (m.maxY > 0 && it.sizeY != null && it.sizeY > m.maxY) return true
    if (m.maxZ > 0 && it.sizeZ != null && it.sizeZ > m.maxZ) return true
  }
  return false
}

// ── FileItem 초기값 (설정 기반) ───────────────────────
function newFileItem(file: File, options: PrintOptions): FileItem {
  const enabledMethods = getEnabledMethods(options)
  const method = enabledMethods[0]?.[0] || 'FDM'
  const materials = getMaterials(options, method)
  const mat = materials[0]
  const colors = mat?.colors || []
  const quals = getQualities(options, method)
  return {
    id: Math.random().toString(36).slice(2),
    file, vol:null, surfaceArea:null, sizeX:null, sizeY:null, sizeZ:null, objectCount:null, manualReview:false,
    method,
    material: mat?.name || '',
    density:  mat?.density || 1.0,
    coefficient: mat?.coefficient || 1000,
    minPrice: mat?.minPrice || 0,
    color:    colors[0] || '',
    quality:  quals[0]?.name || '',
    factor:   quals[0]?.factor || 1.0,
    infill:   quals[0]?.infill ?? 100,
    qty: 1, note: '',
  }
}

const S: Record<string,React.CSSProperties> = {
  wrap: {maxWidth:820,margin:'0 auto',padding:'20px 16px 60px'},
  card: {background:'#fff',borderRadius:16,border:'1px solid #e5e7eb',overflow:'hidden'},
  body: {padding:'24px 24px'},
  grp:  {display:'flex',flexDirection:'column',gap:5},
  lbl:  {fontSize:11,fontWeight:700,color:'#374151',textTransform:'uppercase',letterSpacing:'.4px'} as React.CSSProperties,
  inp:  {padding:'9px 11px',border:'1.5px solid #d1d5db',borderRadius:8,fontSize:13,fontFamily:'inherit',outline:'none'},
  btn:  {padding:'10px 22px',borderRadius:10,fontSize:14,fontWeight:600,cursor:'pointer',border:'none',display:'inline-flex',alignItems:'center',gap:6},
  sBtn: {background:'#fff',color:'#374151',border:'1.5px solid #d1d5db',padding:'9px 20px',borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer'},
}

// 단일 옵션(선택 불가)일 때 고정 표시
function Fixed({ text }: { text: string }) {
  return <div style={{padding:'9px 11px',border:'1.5px solid #e5e7eb',borderRadius:8,fontSize:12,background:'#f9fafb',color:'#374151'}}>{text || '-'}</div>
}

// ── 파일 아이템 카드 ──────────────────────────────────
function FileItemCard({ item, idx, options, onChange, onRemove, isMobile, closedMethods }: {
  item: FileItem; idx: number; options: PrintOptions
  onChange: (id:string, key:keyof FileItem, val:any)=>void
  onRemove: (id:string)=>void
  isMobile: boolean
  closedMethods: string[]
}) {
  const enabledMethods = getEnabledMethods(options)
  const materials      = getMaterials(options, item.method)
  const colors         = getColorsOf(materials, item.material)
  const qualities      = getQualities(options, item.method)

  // 방식 변경 시 귀속 설정 초기화
  const updMethod = (m: string) => {
    const mats  = getMaterials(options, m)
    const mat   = mats[0]
    const quals = getQualities(options, m)
    onChange(item.id, 'method',   m)
    onChange(item.id, 'material', mat?.name || '')
    onChange(item.id, 'density',  mat?.density || 1.0)
    onChange(item.id, 'coefficient', mat?.coefficient || 1000)
    onChange(item.id, 'minPrice', mat?.minPrice || 0)
    onChange(item.id, 'color',    mat?.colors?.[0] || '')
    onChange(item.id, 'quality',  quals[0]?.name || '')
    onChange(item.id, 'factor',   quals[0]?.factor || 1.0)
    onChange(item.id, 'infill',   quals[0]?.infill ?? 100)
  }
  // 소재 변경 시 밀도·단가계수·색상 갱신 (색상은 소재에 종속)
  const updMaterial = (name: string) => {
    const mat = materials.find(x => x.name === name)
    onChange(item.id, 'material', name)
    onChange(item.id, 'density',  mat?.density || 1.0)
    onChange(item.id, 'coefficient', mat?.coefficient || 1000)
    onChange(item.id, 'minPrice', mat?.minPrice || 0)
    onChange(item.id, 'color',    mat?.colors?.[0] || '')
  }

  const isSTL = item.file.name.split('.').pop()?.toLowerCase() === 'stl'
  const price = linePrice(item, options)

  // 선택 소재의 최대 출력 사이즈 + 초과 여부
  const matCfg = materials.find(m => m.name === item.material)
  const hasMax = !!matCfg && (matCfg.maxX > 0 || matCfg.maxY > 0 || matCfg.maxZ > 0)
  const overX = !!matCfg && matCfg.maxX > 0 && item.sizeX != null && item.sizeX > matCfg.maxX
  const overY = !!matCfg && matCfg.maxY > 0 && item.sizeY != null && item.sizeY > matCfg.maxY
  const overZ = !!matCfg && matCfg.maxZ > 0 && item.sizeZ != null && item.sizeZ > matCfg.maxZ
  const overSize = overX || overY || overZ
  const multiObject = item.objectCount != null && item.objectCount > 1
  const needsManual = multiObject || overSize   // 자동 견적 불가 → 담당자 견적 요청 대상

  return (
    <div style={{border:'1.5px solid #e5e7eb',borderRadius:14,overflow:'hidden',marginBottom:16,background:'#fff'}}>
      {/* 헤더 */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'10px 16px',background:'#f9fafb',borderBottom:'1px solid #e5e7eb'}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{background:'#2563eb',color:'#fff',borderRadius:'50%',width:22,height:22,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,flexShrink:0}}>{idx+1}</span>
          <span style={{fontWeight:600,fontSize:13,maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{item.file.name}</span>
        </div>
        <button onClick={()=>onRemove(item.id)} style={{background:'none',border:'none',cursor:'pointer',color:'#9ca3af',fontSize:18,lineHeight:1,padding:'0 4px'}}>×</button>
      </div>

      {/* 본문 — 폰에서는 미리보기(위) + 설정(아래) 1열로 쌓음 */}
      <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':(isSTL?'1fr 1fr':'1fr'),gap:0}}>
        {isSTL && (
          <div style={{padding:14,borderRight:isMobile?'none':'1px solid #e5e7eb',borderBottom:isMobile?'1px solid #e5e7eb':'none'}}>
            <STLViewer height={220} file={item.file} onAnalyzed={info=>{
              onChange(item.id,'vol',info.volume)
              onChange(item.id,'surfaceArea',info.surfaceArea as any)
              onChange(item.id,'sizeX',info.x); onChange(item.id,'sizeY',info.y); onChange(item.id,'sizeZ',info.z)
              onChange(item.id,'objectCount',info.objectCount as any)
            }}/>
          </div>
        )}

        <div style={{padding:14}}>
          {/* 출력 방식 */}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:700,color:'#374151',textTransform:'uppercase' as const,letterSpacing:'.4px',marginBottom:6}}>출력 방식</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:5}}>
              {enabledMethods.map(([k, m])=>{
                const isClosed = closedMethods.includes(k)
                return (
                <button key={k} disabled={isClosed} onClick={()=>{ if(!isClosed) updMethod(k) }} style={{
                  border:item.method===k?'2px solid #2563eb':'1px solid #e5e7eb',
                  borderRadius:7,padding:'6px 8px',cursor:isClosed?'not-allowed':'pointer',textAlign:'left',
                  background:isClosed?'#f3f4f6':(item.method===k?'#eff6ff':'#fafafa'),opacity:isClosed?0.6:1,transition:'all .12s'}}>
                  <div style={{fontSize:12,fontWeight:700,color:isClosed?'#9ca3af':(item.method===k?'#2563eb':'#1a1a1a')}}>{m.label}{isClosed?' (접수 마감)':''}</div>
                  <div style={{fontSize:10,color:item.method===k?'#3b82f6':'#9ca3af',marginTop:1}}>{m.sub}</div>
                </button>
              )})}
            </div>
            {closedMethods.includes(item.method) && (
              <div style={{marginTop:8,padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,fontSize:12,color:'#b91c1c',fontWeight:600}}>
                현재 이 방식은 작업량이 많아 접수가 마감되었습니다. 다른 방식을 선택해 주세요.
              </div>
            )}
          </div>

          {/* 소재 / 색상 / 품질 / 수량 — 옵션이 1개면 고정 표시 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
            <div style={S.grp}>
              <label style={S.lbl}>소재</label>
              {materials.length>1 ? (
                <select value={item.material} onChange={e=>updMaterial(e.target.value)} style={{...S.inp,fontSize:12}}>
                  {materials.map(m=><option key={m.name}>{m.name}</option>)}
                </select>
              ) : <Fixed text={item.material} />}
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>색상</label>
              {colors.length>1 ? (
                <select value={item.color} onChange={e=>onChange(item.id,'color',e.target.value)} style={{...S.inp,fontSize:12}}>
                  {colors.map(v=><option key={v}>{v}</option>)}
                </select>
              ) : <Fixed text={item.color} />}
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>품질</label>
              {qualities.length>1 ? (
                <select value={item.quality} onChange={e=>{
                  const q = qualities.find(x=>x.name===e.target.value)
                  onChange(item.id,'quality',e.target.value); onChange(item.id,'factor',q?.factor||1.0); onChange(item.id,'infill',q?.infill??100)
                }} style={{...S.inp,fontSize:12}}>
                  {qualities.map(q=><option key={q.name}>{q.name}</option>)}
                </select>
              ) : <Fixed text={item.quality} />}
            </div>
            <div style={S.grp}>
              <label style={S.lbl}>수량</label>
              <input type="number" min={1} max={9999} value={item.qty}
                onChange={e=>onChange(item.id,'qty',Math.max(1,parseInt(e.target.value)||1))}
                style={{...S.inp,fontSize:12}}/>
            </div>
          </div>

          {/* 파일별 요청 사항 */}
          <div style={{...S.grp,marginBottom:10}}>
            <label style={S.lbl}>요청 사항</label>
            <textarea value={item.note} onChange={e=>onChange(item.id,'note',e.target.value)}
              placeholder="납기 요청, 특이사항 등을 입력하세요"
              style={{...S.inp,fontSize:12,minHeight:54,resize:'vertical'}}/>
          </div>

          {/* 경고 (담당자 견적 필요 사유) */}
          {overSize && (
            <div style={{marginBottom:8,padding:'8px 12px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:8,fontSize:12,color:'#b91c1c',fontWeight:600}}>
              출력 가능 사이즈를 초과합니다. (초과: {[overX?'X':'',overY?'Y':'',overZ?'Z':''].filter(Boolean).join('·')}축)
            </div>
          )}
          {multiObject && (
            <div style={{marginBottom:8,padding:'8px 12px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:8,fontSize:12,color:'#92400e',fontWeight:600}}>
              개체가 1개가 아닙니다. (이 파일에서 {item.objectCount}개의 개체가 감지되었습니다.)
            </div>
          )}

          {needsManual ? (
            /* 자동 견적 불가 → 담당자 견적 요청 */
            <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'12px 14px'}}>
              <div style={{fontSize:12,color:'#1e40af',marginBottom:10,lineHeight:1.6}}>
                이 파일은 자동 견적이 어려워 담당자 확인이 필요합니다. 아래 <b>담당자 견적 요청</b>을 눌러 주세요. (요청하셔야 다음 단계로 진행됩니다.)
              </div>
              {item.manualReview ? (
                <div style={{display:'flex',alignItems:'center',gap:8,justifyContent:'center',padding:'9px 0',background:'#dcfce7',borderRadius:7,color:'#15803d',fontSize:13,fontWeight:700}}>
                  담당자 견적 요청됨
                </div>
              ) : (
                <button onClick={()=>onChange(item.id,'manualReview',true as any)}
                  style={{width:'100%',padding:'10px 0',background:'#2563eb',color:'#fff',border:'none',borderRadius:7,fontSize:13,fontWeight:700,cursor:'pointer'}}>
                  담당자 견적 요청
                </button>
              )}
            </div>
          ) : (
            <>
              {/* 예상 금액 */}
              <div style={{background:'#f0fdf4',borderRadius:8,padding:'8px 12px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:11,color:'#6b7280'}}>예상 금액 (VAT 별도)</span>
                <span style={{fontSize:15,fontWeight:800,color:'#15803d'}}>{item.vol?krw(price):'담당자 산출'}</span>
              </div>
              {item.minPrice > 0 && (
                <div style={{marginTop:6,fontSize:11,color:'#6b7280',textAlign:'right'}}>
                  이 소재의 최소 견적 금액은 {krw(item.minPrice)} 입니다.
                </div>
              )}
              {hasMax && (
                <div style={{marginTop:6,fontSize:11,color:'#6b7280'}}>
                  이 소재의 최대 출력 사이즈: {matCfg!.maxX>0?`X ${matCfg!.maxX}`:'X 무제한'} · {matCfg!.maxY>0?`Y ${matCfg!.maxY}`:'Y 무제한'} · {matCfg!.maxZ>0?`Z ${matCfg!.maxZ}`:'Z 무제한'} (mm)
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 메인 ──────────────────────────────────────────────
export default function Home() {
  const isMobile = useIsMobile()
  const [step, setStep]       = useState(1)
  const [options, setOptions] = useState<PrintOptions>(defaultSettings())
  const [optLoaded, setOptLoaded] = useState(false)
  const [done, setDone]       = useState<string|null>(null)
  const [loading, setLoading] = useState(false)
  const [customer, setCustomer] = useState<CustomerForm>({name:'',email:'',company:'',phone:'',address:'',addressDetail:''})
  const [items, setItems]     = useState<FileItem[]>([])
  const [drag, setDrag]       = useState(false)
  const [agreePrivacy, setAgreePrivacy]     = useState(false)
  const [agreeMarketing, setAgreeMarketing] = useState(false)
  const [wantCashReceipt, setWantCashReceipt] = useState(false)
  const [wantTaxInvoice, setWantTaxInvoice] = useState(false)
  const [showPrivacyBox, setShowPrivacyBox]     = useState(false)
  const [showMarketingBox, setShowMarketingBox] = useState(false)
  const [agreeRefund, setAgreeRefund] = useState(false)
  const [showRefundBox, setShowRefundBox] = useState(false)
  const [dailyCounts, setDailyCounts] = useState<Record<string, number>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  // ── 설정 로드 (페이지 시작 시) ──
  useEffect(() => {
    fetch(`/api/settings?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(raw => setOptions(normalizeSettings(raw)))
      .catch(() => setOptions(defaultSettings()))
      .finally(() => setOptLoaded(true))
    // 현재 진행 중(배송준비 미만) 방식별 작업 수(혼잡·마감 안내용)
    fetch(`/api/daily-count?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setDailyCounts(d.counts || {}))
      .catch(() => setDailyCounts({}))
  }, [])

  // 파일 설정(1단계)·견적 확인(2단계)에 들어갈 때마다 최신 작업 수를 다시 조회
  useEffect(() => {
    if (step !== 1 && step !== 2) return
    fetch(`/api/daily-count?t=${Date.now()}`, { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setDailyCounts(d.counts || {}))
      .catch(() => {})
  }, [step])

  const updC = (k: keyof CustomerForm, v: string) => setCustomer(p=>({...p,[k]:v}))

  // 다음(카카오) 우편번호 서비스 — 무료, API 키 불필요
  const loadPostcodeScript = () => new Promise<void>((resolve, reject) => {
    if ((window as any).daum?.Postcode) return resolve()
    const existing = document.getElementById('daum-postcode-script') as HTMLScriptElement | null
    if (existing) { existing.addEventListener('load', () => resolve()); existing.addEventListener('error', () => reject(new Error('load fail'))); return }
    const s = document.createElement('script')
    s.id = 'daum-postcode-script'
    s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('load fail'))
    document.head.appendChild(s)
  })
  const openPostcode = async () => {
    try {
      await loadPostcodeScript()
      new (window as any).daum.Postcode({
        oncomplete: (data: any) => {
          const addr = data.roadAddress || data.jibunAddress || data.address || ''
          const zone = data.zonecode ? `(${data.zonecode}) ` : ''
          setCustomer(p => ({ ...p, address: zone + addr }))
        },
      }).open()
    } catch {
      alert('주소 검색 서비스를 불러오지 못했습니다. 네트워크 상태를 확인하거나, 주소를 직접 입력해 주세요.')
    }
  }

  const handleFile = (f: File | null) => {
    if (!f) return
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (ext !== 'stl') { alert('STL 파일만 업로드 가능합니다.'); return }
    setItems(p => [...p, newFileItem(f, options)])
  }

  const updateItem = (id: string, key: keyof FileItem, val: any) => {
    setItems(p => p.map(it => it.id===id ? {...it,[key]:val} : it))
  }
  const removeItem = (id: string) => setItems(p => p.filter(it => it.id !== id))

  const totalPrice = items.reduce((sum,it)=> sum + (itemNeedsManual(it, options) ? 0 : linePrice(it, options)), 0)
  // 진행 중 작업 수가 혼잡 기준 이상인 방식(혼잡 안내). 견적서에 포함된 방식만 대상.
  const congestedMethods = Array.from(new Set(items.map(it=>it.method)))
    .filter(mth => {
      const lim = options[mth]?.dailyLimit || 0
      return lim > 0 && (dailyCounts[mth] || 0) >= lim
    })
    .map(mth => METHODS[mth]?.label || mth)

  // 진행 중 작업 수가 마감 기준 이상인 방식(접수 마감)
  const methodClosed = (m: string) => {
    const cap = options[m]?.capacityLimit || 0
    return cap > 0 && (dailyCounts[m] || 0) >= cap
  }
  const closedMethodCodes = Object.keys(options).filter(methodClosed)
  const closedInCart = Array.from(new Set(items.map(it=>it.method))).filter(methodClosed).map(m=>METHODS[m]?.label||m)

  const submit = async () => {
    if(!customer.name.trim()||!customer.email.trim()){alert('이름과 이메일은 필수입니다.');return}
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())){alert('이메일 형식이 올바르지 않습니다.');return}
    if(!customer.phone.trim()){alert('연락처는 필수입니다.');return}
    if(!/^0\d{8,10}$/.test(customer.phone.replace(/[^0-9]/g,''))){alert('연락처 형식이 올바르지 않습니다. (예: 010-1234-5678)');return}
    if(!customer.address.trim()){alert('수령 주소는 필수입니다.');return}
    if (!agreePrivacy) { alert('개인정보 수집·이용 동의(필수)에 체크해 주세요.'); return }
    if (!agreeRefund) { alert('취소·교환·환불 정책 확인(필수)에 체크해 주세요.'); return }
    const pending = items.find(it => itemNeedsManual(it, options) && !it.manualReview)
    if (pending) { alert(`"${pending.file.name}" 파일은 담당자 견적이 필요합니다. 파일 카드의 "담당자 견적 요청" 버튼을 눌러 주세요.`); return }
    const closedItem = items.find(it => methodClosed(it.method))
    if (closedItem) { alert(`현재 ${METHODS[closedItem.method]?.label || closedItem.method} 방식은 작업량이 많아 접수가 마감되었습니다. 다른 방식을 선택하시거나 잠시 후 다시 시도해 주세요.`); return }
    setLoading(true)
    try {
      const primary = items[0]
      const totalSupply = items.reduce((s,it)=> s + (it.vol ? linePrice(it, options) : 0), 0)
      // 파일별 사양 + 요청사항을 하나의 note로도 합침(목록/하위호환)
      const finalNote = items.map((it,i)=>{
        const base = `[파일${i+1}: ${it.file.name} / ${METHODS[it.method]?.label||it.method} / ${it.material} / ${it.color} / ${it.quality} / ${it.qty}개]`
        return it.note.trim() ? `${base}\n  └ 요청: ${it.note.trim()}` : base
      }).join('\n')

      // 모든 파일 정보 전송
      const filesPayload = items.map(it => {
        const manual = itemNeedsManual(it, options)
        return {
          fileName: it.file.name,
          method: it.method, material: it.material, color: it.color, quality: it.quality,
          qty: it.qty, vol: it.vol || 0,
          sizeX: it.sizeX||0, sizeY: it.sizeY||0, sizeZ: it.sizeZ||0,
          note: it.note || '',
          price: (manual || !it.vol) ? null : linePrice(it, options),
          manualReview: manual,
          objectCount: it.objectCount,
          surfaceArea: it.surfaceArea,
          calc: (manual || !it.vol) ? null : calcDetail(it, options),
        }
      })

      const payload = {
        name: customer.name, email: customer.email,
        company: customer.company, phone: customer.phone,
        address: [customer.address, customer.addressDetail].filter(s=>s&&s.trim()).join(' '),
        note: finalNote,
        method: primary.method, material: primary.material,
        color: primary.color, quality: primary.quality,
        qty: primary.qty, vol: primary.vol || 0,
        auto_price: totalSupply,
        sizeX: primary.sizeX||0, sizeY: primary.sizeY||0, sizeZ: primary.sizeZ||0,
        fileName: primary.file.name,
        files: filesPayload,
        privacy_consent: true,
        marketing_consent: agreeMarketing,
        billing: { cashReceipt: wantCashReceipt, taxInvoice: wantTaxInvoice, refundPolicyConfirmed: agreeRefund },
      }
      const res = await fetch('/api/quotes', {
        method: 'POST', headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      })
      if (res.status === 429) {
        const j = await res.json().catch(()=>({}))
        alert(j.error || '금일 견적 접수가 마감되었습니다. 내일 다시 시도해 주세요.')
        setLoading(false)
        return
      }
      const json = await res.json()
      if (!json.ok) throw new Error(json.error)

      // 파일별 업로드 (경로 배열과 items 순서 일치)
      const paths: string[] = json.storage_paths && json.storage_paths.length
        ? json.storage_paths
        : (json.storage_path ? [json.storage_path] : [])
      if (paths.length) {
        const { createClient } = await import('@supabase/supabase-js')
        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )
        for (let i=0; i<items.length && i<paths.length; i++) {
          if (items[i].file && paths[i]) {
            const { error: upErr } = await supabase.storage
              .from('quote-files')
              .upload(paths[i], items[i].file, { upsert:false })
            if (upErr) console.error(`파일${i+1} 업로드 실패:`, upErr.message)
          }
        }
      }
      setDone(json.quote_no)
    } catch(e:any) { alert('오류: '+e.message) }
    finally { setLoading(false) }
  }

  const STEP_LABELS = ['파일 업로드 & 출력 설정','견적 확인','고객 정보']
  const STEP_LABELS_SHORT = ['파일 & 설정','견적 확인','고객 정보']

  // 설정 로드 중 스피너
  if (!optLoaded) return (
    <div style={S.wrap}>
      <Logo/>
      <div style={{ textAlign:'center', padding:'60px 0', color:'#9ca3af' }}>
        <div style={{ fontSize:14 }}>옵션 정보를 불러오는 중...</div>
      </div>
    </div>
  )

  if (done) return (
    <div style={S.wrap}><Logo/>
      <div style={S.card}><div style={{...S.body,textAlign:'center',padding:'52px 28px'}}>
        <h2 style={{fontSize:22,fontWeight:700,marginBottom:10}}>견적 요청이 접수되었습니다!</h2>
        <p style={{color:'#6b7280',lineHeight:1.8,marginBottom:28}}>
          <b>{customer.email}</b>으로 접수 확인 메일을 발송했습니다.<br/>
          담당자 검토 후 <b>1~2 영업일 이내</b> 최종 견적을 안내드립니다.<br/>
          <span style={{fontSize:13,color:'#9ca3af'}}>견적 번호: {done}</span>
        </p>
        <button style={S.sBtn} onClick={()=>{setDone(null);setStep(1);setCustomer({name:'',email:'',company:'',phone:'',address:'',addressDetail:''});setItems([]);setAgreePrivacy(false);setAgreeMarketing(false)}}>새 견적 요청</button>
      </div></div>
    </div>
  )

  return (
    <div style={S.wrap}><Logo/>
      <div style={S.card}>
        {/* 진행 단계 — 폰에서는 축소 + 줄임 라벨로 잘림 방지 */}
        <div style={{display:'flex',alignItems:'center',padding:isMobile?'13px 10px':'16px 24px',background:'#f9fafb',borderBottom:'1px solid #e5e7eb',overflow:'hidden'}}>
          {(isMobile?STEP_LABELS_SHORT:STEP_LABELS).map((s,i)=>(
            <div key={i} style={{display:'flex',alignItems:'center',flex:i<STEP_LABELS.length-1?1:undefined,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:isMobile?5:7,flexShrink:0}}>
                <div style={{width:isMobile?22:24,height:isMobile?22:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,flexShrink:0,
                  background:step>i+1?'#16a34a':step===i+1?'#2563eb':'#fff',
                  border:`2px solid ${step>i+1?'#16a34a':step===i+1?'#2563eb':'#d1d5db'}`,
                  color:step>i+1||step===i+1?'#fff':'#9ca3af'}}>
                  {i+1}
                </div>
                <span style={{fontSize:isMobile?11:12,whiteSpace:'nowrap',color:step===i+1?'#1a1a1a':'#9ca3af',fontWeight:step===i+1?600:400}}>{s}</span>
              </div>
              {i<STEP_LABELS.length-1&&<div style={{flex:1,height:1,background:'#d1d5db',margin:isMobile?'0 5px':'0 8px',minWidth:6}}/>}
            </div>
          ))}
        </div>

        <div style={{...S.body,padding:isMobile?'18px 14px':'24px 24px'}}>

          {/* ── STEP 1 ── */}
          {/* ── STEP 3: 고객 정보 ── */}
          {step===3&&<>
            <p style={{color:'#6b7280',marginBottom:20,fontSize:13}}>견적 요청자 정보를 입력하고 제출해 주세요.</p>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:14,marginBottom:14}}>
              <div style={S.grp}><label style={S.lbl}>이름 *</label><input type="text" value={customer.name} onChange={e=>updC('name',e.target.value)} placeholder="홍길동" style={S.inp}/></div>
              <div style={S.grp}><label style={S.lbl}>이메일 *</label><input type="email" value={customer.email} onChange={e=>updC('email',e.target.value)} placeholder="example@mail.com" style={S.inp}/></div>
              <div style={S.grp}><label style={S.lbl}>업체명</label><input type="text" value={customer.company} onChange={e=>updC('company',e.target.value)} placeholder="(주)○○ (미입력 시 개인으로 처리)" style={S.inp}/></div>
              <div style={S.grp}><label style={S.lbl}>연락처 *</label><input type="tel" value={customer.phone} onChange={e=>updC('phone',e.target.value)} placeholder="010-0000-0000" style={S.inp}/></div>
            </div>
            <div style={{...S.grp,marginBottom:16}}>
              <label style={S.lbl}>수령 주소 *</label>
              <div style={{display:'flex',gap:8}}>
                <input type="text" value={customer.address} onChange={e=>updC('address',e.target.value)}
                  placeholder="주소 검색을 눌러 입력하세요" style={{...S.inp,flex:1,minWidth:0}}/>
                <button type="button" onClick={openPostcode}
                  style={{...S.btn,background:'#374151',color:'#fff',flexShrink:0,padding:'9px 16px'}}>주소 검색</button>
              </div>
              <input type="text" value={customer.addressDetail} onChange={e=>updC('addressDetail',e.target.value)}
                placeholder="상세주소 (동·호수 등)" style={{...S.inp,marginTop:8}}/>
            </div>

            {/* 개인정보 수집·이용 동의 */}
            <div style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                  <input type="checkbox" checked={agreePrivacy} onChange={e=>setAgreePrivacy(e.target.checked)}
                    style={{width:17,height:17,accentColor:'#2563eb',cursor:'pointer'}}/>
                  <span><span style={{color:'#dc2626'}}>[필수]</span> 개인정보 수집·이용에 동의합니다.</span>
                </label>
                <button type="button" onClick={()=>setShowPrivacyBox(v=>!v)}
                  style={{background:'none',border:'none',color:'#2563eb',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                  {showPrivacyBox?'접기':'자세히'}
                </button>
              </div>
              {showPrivacyBox && (
                <div style={{marginTop:10,padding:'10px 12px',background:'#f9fafb',borderRadius:8,fontSize:12,color:'#4b5563',lineHeight:1.7}}>
                  <div><b>· 수집·이용 목적:</b> 3D 프린팅 견적 상담, 제작 및 출력물 배송, 견적 진행 안내(이메일·문자) 발송</div>
                  <div><b>· 수집 항목:</b> 이름, 이메일, 연락처, 업체명, 수령(배송) 주소, 업로드한 3D 모델 파일 및 견적 정보</div>
                  <div><b>· 보유·이용 기간:</b> 견적 요청일로부터 {RETENTION_MONTHS}개월 (기간 경과 또는 목적 달성 시 지체 없이 파기). 단, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.</div>
                  <div><b>· 동의 거부 권리:</b> 동의를 거부할 권리가 있으며, 거부 시 견적 서비스 이용이 제한될 수 있습니다.</div>
                  <div style={{marginTop:6}}><a href="/privacy" target="_blank" rel="noopener noreferrer" style={{color:'#2563eb',textDecoration:'underline'}}>개인정보처리방침 전문 보기</a></div>
                </div>
              )}
            </div>

            {/* 광고·마케팅 활용 동의 (선택) */}
            <div style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',marginBottom:20}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                  <input type="checkbox" checked={agreeMarketing} onChange={e=>setAgreeMarketing(e.target.checked)}
                    style={{width:17,height:17,accentColor:'#2563eb',cursor:'pointer'}}/>
                  <span><span style={{color:'#6b7280'}}>[선택]</span> 광고·마케팅 활용에 동의합니다.</span>
                </label>
                <button type="button" onClick={()=>setShowMarketingBox(v=>!v)}
                  style={{background:'none',border:'none',color:'#2563eb',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                  {showMarketingBox?'접기':'자세히'}
                </button>
              </div>
              {showMarketingBox && (
                <div style={{marginTop:10,padding:'10px 12px',background:'#f9fafb',borderRadius:8,fontSize:12,color:'#4b5563',lineHeight:1.7}}>
                  <div><b>· 목적:</b> 신제품·할인·이벤트 등 광고성 정보 안내(이메일·문자), 작업 내용(제작물)을 자사 광고·홍보에 활용</div>
                  <div><b>· 항목:</b> 이름, 작업 내용(사진)</div>
                  <div><b>· 보유·이용 기간:</b> 동의 철회 시까지 (최대 견적 정보 보유기간과 동일)</div>
                  <div><b>· 미동의하셔도 견적 서비스 이용에는 제한이 없습니다.</b></div>
                </div>
              )}
            </div>

            {/* 취소·교환·환불 규정 확인 (필수) */}
            <div style={{border:`1px solid ${agreeRefund?'#e5e7eb':'#fca5a5'}`,borderRadius:10,padding:'12px 14px',marginBottom:20}}>
              <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,fontWeight:600}}>
                  <input type="checkbox" checked={agreeRefund} onChange={e=>setAgreeRefund(e.target.checked)}
                    style={{width:17,height:17,accentColor:'#2563eb',cursor:'pointer'}}/>
                  <span><span style={{color:'#dc2626'}}>[필수]</span> 취소·교환·환불 정책을 확인하였습니다.</span>
                </label>
                <button type="button" onClick={()=>setShowRefundBox(v=>!v)}
                  style={{background:'none',border:'none',color:'#2563eb',fontSize:12,cursor:'pointer',whiteSpace:'nowrap'}}>
                  {showRefundBox?'접기':'자세히'}
                </button>
              </div>
              {showRefundBox && (
                <div style={{marginTop:10,padding:'10px 12px',background:'#f9fafb',borderRadius:8,fontSize:12,color:'#4b5563',lineHeight:1.8}}>
                  <div><b>· 주문 제작 상품 안내:</b> 고객 파일 기반 맞춤 출력 상품으로, <b>제작 착수 후에는 단순 변심에 의한 취소·환불이 제한</b>될 수 있습니다.</div>
                  <div><b>· 제작 착수 전:</b> 취소 및 전액 환불이 가능합니다.</div>
                  <div><b>· 판매자 귀책(출력 불량·파손·오제작):</b> 재제작 또는 환불해 드립니다.</div>
                  <div><b>· 고객 제공 파일의 오류·결함</b>으로 인한 결과물은 교환·환불이 어려울 수 있습니다.</div>
                  <div style={{marginTop:6}}>자세한 내용은 <a href="/refund-policy" target="_blank" rel="noopener noreferrer" style={{color:'#2563eb',textDecoration:'underline',fontWeight:600}}>취소·교환·환불 정책 전문 보기</a>에서 확인하실 수 있습니다.</div>
                </div>
              )}
            </div>

            {/* 증빙 요청 (선택) */}
            <div style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 14px',marginBottom:20}}>
              <div style={{fontSize:12,fontWeight:700,color:'#374151',marginBottom:8}}>증빙 요청 (선택)</div>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',fontSize:13,marginBottom:8}}>
                <input type="checkbox" checked={wantCashReceipt} onChange={e=>setWantCashReceipt(e.target.checked)}
                  style={{width:17,height:17,accentColor:'#2563eb',cursor:'pointer'}}/>
                <span>현금영수증 발행을 요청합니다.</span>
              </label>
              <label style={{display:'flex',alignItems:'flex-start',gap:8,cursor:'pointer',fontSize:13}}>
                <input type="checkbox" checked={wantTaxInvoice} onChange={e=>setWantTaxInvoice(e.target.checked)}
                  style={{width:17,height:17,accentColor:'#2563eb',cursor:'pointer',marginTop:1}}/>
                <span>세금계산서 발행을 요청합니다. <span style={{color:'#6b7280',fontSize:12}}>(영업일 이내 담당자가 별도로 연락드려 발행에 필요한 자료를 안내드립니다.)</span></span>
              </label>
            </div>

            <div style={{display:'flex',justifyContent:'space-between'}}>
              <button style={S.sBtn} onClick={()=>setStep(2)}>← 이전</button>
              <button style={{...S.btn,background:(loading||!agreePrivacy||!agreeRefund)?'#9ca3af':'#16a34a',color:'#fff',cursor:loading?'wait':((!agreePrivacy||!agreeRefund)?'not-allowed':'pointer')}} onClick={submit} disabled={loading||!agreePrivacy||!agreeRefund}>
                {loading?'제출 중...':'견적 요청 제출'}
              </button>
            </div>
          </>}

          {/* ── STEP 1: 파일 업로드 & 출력 설정 ── */}
          {step===1&&<>
            <p style={{color:'#6b7280',marginBottom:16,fontSize:13}}>출력할 파일을 업로드하고 각 파일의 출력 설정을 선택해 주세요.</p>
            {closedMethodCodes.length>0 && (
              <div style={{marginBottom:14,padding:'10px 14px',background:'#fef2f2',border:'1px solid #fca5a5',borderRadius:10,fontSize:13,color:'#b91c1c'}}>
                현재 <b>{closedMethodCodes.map(m=>METHODS[m]?.label||m).join(', ')}</b> 방식은 작업량이 많아 접수가 마감되었습니다. 다른 방식을 선택해 주세요.
              </div>
            )}
            <input ref={fileRef} type="file" accept={isMobile?undefined:'.stl'} style={{display:'none'}} onChange={e=>{handleFile(e.target.files?.[0]||null);if(fileRef.current)fileRef.current.value=''}}/>
            <div
              onDragOver={e=>{e.preventDefault();setDrag(true)}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0])}}
              style={{border:`2px dashed ${drag?'#2563eb':'#d1d5db'}`,borderRadius:12,padding:'20px',
                background:drag?'#eff6ff':'#f9fafb',transition:'all .15s',marginBottom:10}}>
              <div style={{display:'flex',alignItems:'center',gap:16,flexWrap:'wrap'}}>
                <div style={{flex:1,minWidth:200}}>
                  <div style={{fontWeight:600,fontSize:14,marginBottom:3}}>파일을 이 영역에 드래그 하거나</div>
                  <div style={{fontSize:12,color:'#6b7280'}}>STL 파일만 지원</div>
                </div>
                <button onClick={()=>fileRef.current?.click()}
                  style={{...S.btn,background:'#2563eb',color:'#fff',flexShrink:0,fontSize:13}}>
                  + 파일 선택
                </button>
              </div>
            </div>
            {items.length===0&&(
              <div style={{textAlign:'center',padding:'32px 0',color:'#9ca3af',fontSize:13}}>
                업로드된 파일이 없습니다.
              </div>
            )}
            {items.map((item,idx)=>(
              <FileItemCard key={item.id} item={item} idx={idx} options={options} onChange={updateItem} onRemove={removeItem} isMobile={isMobile} closedMethods={closedMethodCodes}/>
            ))}
            {items.length>0&&(
              <div style={{display:'flex',justifyContent:'flex-end',marginTop:8}}>
                <button style={{...S.btn,background:'#2563eb',color:'#fff'}} onClick={()=>{
                  const pending = items.find(it => itemNeedsManual(it, options) && !it.manualReview)
                  if(pending){alert(`"${pending.file.name}" 파일은 자동 견적이 어려워 담당자 확인이 필요합니다.\n파일 카드의 "담당자 견적 요청" 버튼을 누른 뒤 진행해 주세요.`);return}
                  const closedItem = items.find(it => methodClosed(it.method))
                  if(closedItem){alert(`현재 ${METHODS[closedItem.method]?.label || closedItem.method} 방식은 작업량이 많아 접수가 마감되었습니다.\n다른 방식을 선택하시거나 잠시 후 다시 시도해 주세요.`);return}
                  setStep(2)
                }}>견적 확인 →</button>
              </div>
            )}
          </>}

          {/* ── STEP 2: 견적 확인 ── */}
          {step===2&&<>
            <p style={{color:'#6b7280',marginBottom:16,fontSize:13}}>견적 내용을 확인하고 다음 단계로 진행해 주세요.</p>
            {congestedMethods.length>0 && (
              <div style={{display:'flex',gap:10,padding:'12px 14px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:10,fontSize:13,color:'#92400e',marginBottom:14,alignItems:'flex-start'}}>
                <span></span><span>현재 작업 대기가 많아 작업 소요에 시간이 더 소요될 수 있습니다{congestedMethods.length>0?` (${congestedMethods.join(', ')})`:''}. 접수는 정상적으로 진행됩니다.</span>
              </div>
            )}
            {items.map((item,idx)=>(
              <div key={item.id} style={{border:'1px solid #e5e7eb',borderRadius:10,padding:'12px 16px',marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:7}}>
                    <span style={{background:'#2563eb',color:'#fff',borderRadius:'50%',width:20,height:20,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700}}>{idx+1}</span>
                    <span style={{fontWeight:600,fontSize:13}}>{item.file.name}</span>
                  </div>
                  <span style={{fontSize:15,fontWeight:800,color: itemNeedsManual(item,options)?'#2563eb':'#15803d'}}>{itemNeedsManual(item,options) ? '담당자 견적' : (item.vol?krw(linePrice(item, options)):'담당자 산출')}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:6}}>
                  {[['방식',METHODS[item.method]?.label||item.method],['소재',item.material],['색상',item.color],['수량',item.qty+'개'],
                    ['품질',item.quality],
                    ...(item.sizeX!=null?[['크기',`${item.sizeX}×${item.sizeY}×${item.sizeZ}mm`]]:[] as [string,string][]),
                    ...(item.vol!=null?[['부피',item.vol+'㎤']]:[] as [string,string][]),
                  ].map(([l,v])=>(
                    <div key={l} style={{background:'#f9fafb',borderRadius:6,padding:'6px 8px'}}>
                      <div style={{fontSize:10,color:'#9ca3af',marginBottom:1,fontWeight:600,textTransform:'uppercase' as const}}>{l}</div>
                      <div style={{fontSize:12,fontWeight:600}}>{v}</div>
                    </div>
                  ))}
                </div>
                {item.note.trim()&&<div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>요청사항: {item.note}</div>}
                <div style={{marginTop:8,fontSize:12,color:'#6b7280'}}>예상 납기: <b>{calcDays(item.method,item.qty)}</b> (영업일 기준)</div>
              </div>
            ))}

            {(() => { const b = priceBreakdown(totalPrice); return (
              <div style={{background:'#eff6ff',borderRadius:10,padding:'14px 16px',marginBottom:14}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#374151',marginBottom:6}}>
                  <span>공급가 {items.length>1?'(전체 합계)':''}</span><span>{krw(b.supply)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#374151',marginBottom:6}}>
                  <span>부가세 (10%)</span><span>{krw(b.vat)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:13,color:'#374151',marginBottom:8,paddingBottom:8,borderBottom:'1px solid #bfdbfe'}}>
                  <span>배송비</span><span>{krw(b.shipping)}</span>
                </div>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontWeight:700,fontSize:14}}>합계 (VAT·배송비 포함)</span>
                  <span style={{fontSize:20,fontWeight:800,color:'#2563eb'}}>{krw(b.total)}</span>
                </div>
                <div style={{marginTop:6,fontSize:11,color:'#6b7280',textAlign:'right'}}>배송비 {krw(SHIPPING_FEE)} 포함</div>
              </div>
            )})()}

            <div style={{display:'flex',gap:10,padding:'11px 14px',background:'#fffbeb',border:'1px solid #fcd34d',borderRadius:10,fontSize:13,color:'#92400e',marginBottom:20,alignItems:'flex-start'}}>
              <span></span><span>위 금액은 자동 계산 예상 견적입니다. 담당자 검토 후 <b>확정 견적을 이메일로 안내</b>드립니다.</span>
            </div>

            <div style={{display:'flex',justifyContent:'space-between'}}>
              <button style={S.sBtn} onClick={()=>setStep(1)}>← 이전</button>
              <button style={{...S.btn,background:'#2563eb',color:'#fff'}} onClick={()=>setStep(3)}>다음 단계 →</button>
            </div>
          </>}

        </div>
      </div>
    </div>
  )
}

function Logo() {
  return (
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
      <div>
        <div style={{fontSize:20,fontWeight:700,letterSpacing:-.5}}>아틀리에 하우스 3D 프린팅 견적 시스템</div>
      </div>
    </div>
  )
}
