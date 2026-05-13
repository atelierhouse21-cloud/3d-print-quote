'use client'
import { useEffect, useRef, useState } from 'react'

export type STLInfo = {
  x: number   // mm
  y: number
  z: number
  volume: number  // cm³
}

type Props = {
  file: File
  onAnalyzed: (info: STLInfo) => void
}

// ── STL 파서 (binary / ascii 모두 지원) ──────────────────
function parseSTL(buffer: ArrayBuffer): Float32Array {
  const text = new TextDecoder().decode(buffer.slice(0, 80))
  if (text.startsWith('solid') && !isBinary(buffer)) {
    return parseASCII(new TextDecoder().decode(buffer))
  }
  return parseBinary(buffer)
}

function isBinary(buffer: ArrayBuffer): boolean {
  const header = new DataView(buffer)
  const numTriangles = header.getUint32(80, true)
  return buffer.byteLength === 84 + numTriangles * 50
}

function parseBinary(buffer: ArrayBuffer): Float32Array {
  const view = new DataView(buffer)
  const numTriangles = view.getUint32(80, true)
  const verts = new Float32Array(numTriangles * 9)
  let offset = 84
  for (let i = 0; i < numTriangles; i++) {
    offset += 12 // skip normal
    for (let j = 0; j < 9; j++) {
      verts[i * 9 + j] = view.getFloat32(offset, true)
      offset += 4
    }
    offset += 2 // attribute byte count
  }
  return verts
}

function parseASCII(text: string): Float32Array {
  const verts: number[] = []
  const re = /vertex\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)\s+([\d.eE+\-]+)/g
  let m
  while ((m = re.exec(text)) !== null) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]))
  }
  return new Float32Array(verts)
}

// ── 부피 계산 (signed tetrahedron method) ────────────────
function calcVolume(verts: Float32Array): number {
  let vol = 0
  for (let i = 0; i < verts.length; i += 9) {
    const [x1,y1,z1,x2,y2,z2,x3,y3,z3] = verts.slice(i, i+9)
    vol += (x1*(y2*z3 - y3*z2) - y1*(x2*z3 - x3*z2) + z1*(x2*y3 - x3*y2)) / 6
  }
  return Math.abs(vol) / 1000 // mm³ → cm³
}

// ── 바운딩 박스 계산 ─────────────────────────────────────
function calcBBox(verts: Float32Array) {
  let minX=Infinity,minY=Infinity,minZ=Infinity
  let maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity
  for (let i = 0; i < verts.length; i += 3) {
    if (verts[i]   < minX) minX = verts[i]
    if (verts[i]   > maxX) maxX = verts[i]
    if (verts[i+1] < minY) minY = verts[i+1]
    if (verts[i+1] > maxY) maxY = verts[i+1]
    if (verts[i+2] < minZ) minZ = verts[i+2]
    if (verts[i+2] > maxZ) maxZ = verts[i+2]
  }
  return {
    x: parseFloat((maxX-minX).toFixed(1)),
    y: parseFloat((maxY-minY).toFixed(1)),
    z: parseFloat((maxZ-minZ).toFixed(1)),
  }
}

export default function STLViewer({ file, onAnalyzed }: Props) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)
  const [info, setInfo] = useState<STLInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!file || !mountRef.current) return
    let renderer: any, animId: number, controls: any

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        // Three.js 동적 임포트 (SSR 방지)
        const THREE = await import('three')
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js' as any)

        const buffer = await file.arrayBuffer()
        const verts = parseSTL(buffer)
        const bbox = calcBBox(verts)
        const volume = parseFloat(calcVolume(verts).toFixed(2))
        const stlInfo = { ...bbox, volume }
        setInfo(stlInfo)
        onAnalyzed(stlInfo)

        // ── Three.js 씬 설정 ──────────────────────────
        const w = mountRef.current!.clientWidth
        const h = 280

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        renderer.setSize(w, h)
        renderer.setPixelRatio(window.devicePixelRatio)
        renderer.setClearColor(0xf9fafb, 1)
        mountRef.current!.innerHTML = ''
        mountRef.current!.appendChild(renderer.domElement)

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 10000)

        // 조명
        scene.add(new THREE.AmbientLight(0xffffff, 0.6))
        const dir1 = new THREE.DirectionalLight(0xffffff, 0.8)
        dir1.position.set(1, 2, 3)
        scene.add(dir1)
        const dir2 = new THREE.DirectionalLight(0x8ab4f8, 0.4)
        dir2.position.set(-2, -1, -1)
        scene.add(dir2)

        // 지오메트리 생성
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(verts, 3))
        geometry.computeVertexNormals()

        const material = new THREE.MeshPhongMaterial({
          color: 0x2563eb,
          specular: 0x4488ff,
          shininess: 40,
          side: THREE.DoubleSide,
        })
        const mesh = new THREE.Mesh(geometry, material)

        // 중심 맞추기
        geometry.computeBoundingBox()
        const center = new THREE.Vector3()
        geometry.boundingBox!.getCenter(center)
        mesh.position.sub(center)
        scene.add(mesh)

        // 카메라 위치
        const size = new THREE.Vector3()
        geometry.boundingBox!.getSize(size)
        const maxDim = Math.max(size.x, size.y, size.z)
        camera.position.set(maxDim * 1.5, maxDim * 1.0, maxDim * 1.5)
        camera.lookAt(0, 0, 0)

        // 그리드
        const grid = new THREE.GridHelper(maxDim * 3, 10, 0xd1d5db, 0xe5e7eb)
        grid.position.y = -size.z / 2
        scene.add(grid)

        // 컨트롤
        controls = new OrbitControls(camera, renderer.domElement)
        controls.enableDamping = true
        controls.dampingFactor = 0.1

        const animate = () => {
          animId = requestAnimationFrame(animate)
          controls.update()
          renderer.render(scene, camera)
        }
        animate()
        setLoading(false)
      } catch (e: any) {
        setError('미리보기를 불러올 수 없습니다')
        setLoading(false)
      }
    }

    run()

    return () => {
      cancelAnimationFrame(animId)
      renderer?.dispose()
      if (mountRef.current) mountRef.current.innerHTML = ''
    }
  }, [file])

  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: '1.5px solid #e5e7eb', marginBottom: 16 }}>
      {/* 3D 뷰어 영역 */}
      <div style={{ position: 'relative', background: '#f9fafb', height: 280 }}>
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 10, color: '#6b7280',
          }}>
            <div style={{ fontSize: 32 }}>⏳</div>
            <div style={{ fontSize: 13 }}>3D 모델 분석 중...</div>
          </div>
        )}
        {error && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8, color: '#9ca3af',
          }}>
            <div style={{ fontSize: 32 }}>📄</div>
            <div style={{ fontSize: 13 }}>{error}</div>
          </div>
        )}
        <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
        {!loading && !error && (
          <div style={{
            position: 'absolute', bottom: 8, right: 10,
            fontSize: 11, color: '#9ca3af', background: 'rgba(255,255,255,0.8)',
            padding: '3px 8px', borderRadius: 6,
          }}>
            🖱 드래그: 회전 · 스크롤: 확대
          </div>
        )}
      </div>

      {/* 치수 정보 */}
      {info && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 0, borderTop: '1px solid #e5e7eb',
        }}>
          {[
            ['X (가로)', info.x + ' mm'],
            ['Y (세로)', info.y + ' mm'],
            ['Z (높이)', info.z + ' mm'],
            ['부피',     info.volume + ' cm³'],
          ].map(([l, v], i) => (
            <div key={l} style={{
              padding: '10px 14px', textAlign: 'center',
              borderRight: i < 3 ? '1px solid #e5e7eb' : 'none',
              background: '#fff',
            }}>
              <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 3 }}>{l}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{v}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
