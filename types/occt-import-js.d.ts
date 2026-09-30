// occt-import-js는 타입 정의를 제공하지 않는 순수 JS(Emscripten) 패키지라서,
// tsc가 "타입 선언을 찾을 수 없음" 오류를 내지 않도록 최소한으로 모듈 존재만 선언한다.
// 실제 타입은 사용하는 쪽(lib/occt.ts)에서 좁혀서 다룬다.
declare module 'occt-import-js'
