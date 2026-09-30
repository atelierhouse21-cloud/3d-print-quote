// STEP/STP(CAD) 파일을 브라우저에서 직접 파싱하기 위한 헬퍼.
// occt-import-js(OpenCascade를 WASM으로 빌드한 라이브러리)로 STEP을 삼각형화(tessellate)한 뒤,
// STL과 동일한 "삼각형 스프(triangle soup)" Float32Array — 9개 float = 삼각형 1개(꼭짓점 3개 x xyz) —
// 로 변환해서 반환한다. 이렇게 하면 STL 분석에 쓰던 calcVolume/calcBBox/countObjects/
// detectMeshIntegrityIssue/detectThinWalls 등을 STEP에도 그대로 재사용할 수 있다.
//
// occt-import-js는 용량이 큰 WASM(약 7MB)이라, STL만 올리는 고객은 다운로드하지 않도록
// 동적 import()로 STEP/STP 파일을 실제로 열 때만 로드한다(코드 스플리팅).

type OcctMesh = {
  attributes: { position: { array: number[] } }
  index: { array: number[] }
}
type OcctReadResult = { success: boolean; meshes: OcctMesh[] }
type OcctInstance = {
  ReadStepFile: (content: Uint8Array, params: any) => OcctReadResult
}

let occtPromise: Promise<OcctInstance> | null = null

function getOcct(): Promise<OcctInstance> {
  if (!occtPromise) {
    occtPromise = import('occt-import-js').then((mod: any) => {
      const factory = mod.default || mod
      // wasm 파일은 /public/occt-import-js.wasm 로 서빙됨 — 번들러가 아닌 정적 경로에서 직접 fetch하도록 지정
      return factory({ locateFile: (path: string) => '/' + path }) as Promise<OcctInstance>
    })
  }
  return occtPromise
}

// 인덱스 기반 메시(여러 개 가능 — 조립품이면 부품마다 하나)를 인덱스 없는 삼각형 스프로 펼침
function occtMeshesToTriangleSoup(meshes: OcctMesh[]): Float32Array {
  let totalTris = 0
  for (const m of meshes) totalTris += Math.floor(m.index.array.length / 3)
  const out = new Float32Array(totalTris * 9)
  let o = 0
  for (const m of meshes) {
    const pos = m.attributes.position.array
    const idx = m.index.array
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
      out[o++] = pos[a];   out[o++] = pos[a + 1]; out[o++] = pos[a + 2]
      out[o++] = pos[b];   out[o++] = pos[b + 1]; out[o++] = pos[b + 2]
      out[o++] = pos[c];   out[o++] = pos[c + 1]; out[o++] = pos[c + 2]
    }
  }
  return out
}

export async function parseStepToTriangleSoup(buf: ArrayBuffer): Promise<Float32Array> {
  const occt = await getOcct()
  // linearUnit: 'millimeter' — STEP 파일 자체 단위(m/inch/mm 등)와 무관하게 항상 mm로 변환해서 받음
  // (앱 전체의 사이즈·부피 계산이 mm 기준이므로 필수)
  const result = occt.ReadStepFile(new Uint8Array(buf), { linearUnit: 'millimeter' })
  if (!result.success || !result.meshes || result.meshes.length === 0) {
    throw new Error('STEP 파일을 해석할 수 없습니다.')
  }
  return occtMeshesToTriangleSoup(result.meshes)
}
