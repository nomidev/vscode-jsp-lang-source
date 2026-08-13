// TypeScript LanguageService는 `methods: { foo() {} }`처럼 객체 리터럴 안에 있는
// 속성을, 템플릿의 `@click="foo"` 같은 표현식과 자동으로 연결해주지 않는다.
// (Vue는 런타임에 methods/data/computed를 컴포넌트 인스턴스에 병합하는데, 이건
// 일반적인 정적 타입 분석 범위 밖의 프레임워크 고유 동작이라 정식 Vue 언어
// 서버(Volar) 수준의 특수 처리가 필요하다.)
//
// 대신, 실무에서 가장 흔한 Vue 2/3 Options API 패턴에 한해 정규식 기반으로
// "같은 스크립트 안에서 methods/computed/data 블록에 있는 동일 이름 속성"을
// 찾아주는 가벼운 휴리스틱을 제공한다. 완전한 스코프 분석은 아니라서 같은
// 이름의 속성이 여러 곳에 있으면 첫 번째 것을 반환한다.

const BLOCK_KEYS = ['methods', 'computed', 'data'];

// content 안에서 startIndex 위치의 '{' 에 대응하는 닫는 '}' 의 인덱스를 찾는다.
// (문자열/주석 안의 중괄호는 대충 무시 - 정교한 파서가 아니므로 드문 edge case는 놓칠 수 있음)
function findMatchingBrace(content: string, openBraceIndex: number): number {
  let depth = 0;
  for (let i = openBraceIndex; i < content.length; i++) {
    const ch = content[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * scriptText 안에서 methods/computed/data 블록을 찾고, 그 안에서
 * `name` 이라는 이름의 속성 정의 위치를 찾아 오프셋을 반환한다.
 * (scriptText는 원본 JSP 문서와 오프셋이 동일한 임베디드 JS 텍스트여야 한다)
 */
export function findVueMemberOffset(scriptText: string, name: string): { start: number; end: number } | null {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return null; // 식별자 형태가 아니면 대상 아님

  for (const key of BLOCK_KEYS) {
    // "methods:" / "methods :" / "data()" / "data ()" 형태 모두 커버
    const blockHeaderRegex = new RegExp(`\\b${key}\\s*(?::|\\([^)]*\\)\\s*\\{)`, 'g');
    let headerMatch: RegExpExecArray | null;
    while ((headerMatch = blockHeaderRegex.exec(scriptText))) {
      // 헤더 뒤 첫 '{' 를 블록 시작으로 삼는다
      const braceStart = scriptText.indexOf('{', headerMatch.index);
      if (braceStart === -1) continue;
      const braceEnd = findMatchingBrace(scriptText, braceStart);
      if (braceEnd === -1) continue;

      const blockBody = scriptText.slice(braceStart + 1, braceEnd);
      // 속성 정의: `name:` (ES5 스타일) 또는 `name(` (ES6 메서드 축약형)
      const memberRegex = new RegExp(`(^|[{,;\\s])(${name})\\s*[:(]`, 'm');
      const memberMatch = memberRegex.exec(blockBody);
      if (memberMatch && memberMatch[2]) {
        const nameStart = braceStart + 1 + memberMatch.index + memberMatch[1].length;
        return { start: nameStart, end: nameStart + name.length };
      }
    }
  }
  return null;
}
