// TypeScript의 JS 추론은 ES6 class/extends는 잘 이해하지만, ES5 스타일
// 프로토타입 상속(`Child.prototype = Object.create(Parent.prototype)`,
// `Child.prototype = new Parent()` 등)은 정적으로 따라가지 못한다.
// (실제로 검증됨: 자기 프로토타입에 직접 붙인 멤버는 찾지만, 부모로부터
// 상속받은 멤버는 any로 처리되어 정의를 못 찾는다.)
//
// 이 모듈은 스크립트 텍스트를 정규식으로 훑어 "자식 생성자 -> 부모 생성자"
// 체인과 "변수 -> 생성자" 매핑을 만들고, 그 체인을 따라 올라가며
// `Constructor.prototype.member = ...` 형태의 정의를 찾아준다.
// (완전한 파서가 아니므로 흔한 패턴만 커버하는 근사치 휴리스틱)

interface ChainMaps {
  /** 자식 생성자 이름 -> 부모 생성자 이름 */
  parentOf: Map<string, string>;
  /** 변수 이름 -> `new 생성자(...)`로 만들어진 생성자 이름 */
  constructorOfVar: Map<string, string>;
}

function buildChainMaps(text: string): ChainMaps {
  const parentOf = new Map<string, string>();
  const constructorOfVar = new Map<string, string>();

  // Child.prototype = Object.create(Parent.prototype)
  let re = /\b(\w+)\.prototype\s*=\s*Object\.create\(\s*(\w+)\.prototype\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) parentOf.set(m[1], m[2]);

  // Child.prototype = new Parent(...)  (Object.create 이전의 구식 패턴)
  re = /\b(\w+)\.prototype\s*=\s*new\s+(\w+)\s*\(/g;
  while ((m = re.exec(text))) parentOf.set(m[1], m[2]);

  // Child.prototype = Parent.prototype  (프로토타입 객체를 그대로 재사용)
  re = /\b(\w+)\.prototype\s*=\s*(\w+)\.prototype\s*[;,)]/g;
  while ((m = re.exec(text))) parentOf.set(m[1], m[2]);

  // var/let/const x = new Constructor(...)
  re = /\b(?:var|let|const)\s+(\w+)\s*=\s*new\s+(\w+)\s*\(/g;
  while ((m = re.exec(text))) constructorOfVar.set(m[1], m[2]);

  return { parentOf, constructorOfVar };
}

// Constructor.prototype.member = ... 형태의 정의 위치를 찾는다
function findOwnPrototypeMember(
  text: string,
  ctorName: string,
  memberName: string
): { start: number; end: number } | null {
  const re = new RegExp(`\\b${ctorName}\\.prototype\\.(${memberName})\\s*=`);
  const m = re.exec(text);
  if (!m) return null;
  const nameStart = m.index + m[0].indexOf(m[1]);
  return { start: nameStart, end: nameStart + memberName.length };
}

/**
 * offset 위치가 속한 `Constructor.prototype.xxx = function () { ... }` 블록의
 * Constructor 이름을 찾는다. `this.member()` 형태로 부모 메서드를 호출할 때,
 * "지금 어떤 생성자의 프로토타입 메서드 안에 있는지" 알아내기 위함.
 * (완전한 블록 스코프 분석이 아니라, offset 이전의 가장 가까운 선언을 사용하는 근사치)
 */
function findEnclosingConstructor(text: string, offset: number): string | null {
  const re = /\b(\w+)\.prototype\.\w+\s*=\s*function/g;
  let m: RegExpExecArray | null;
  let best: string | null = null;
  while ((m = re.exec(text))) {
    if (m.index > offset) break;
    best = m[1];
  }
  return best;
}

/**
 * `baseVarName.memberName` (예: `d.speak`) 또는, baseVarName이 'this'인 경우
 * offset이 속한 프로토타입 메서드의 생성자를 기준으로, 프로토타입 상속
 * 체인을 따라 올라가며 memberName의 정의를 찾는다.
 */
export function findPrototypeChainDefinition(
  text: string,
  baseVarName: string,
  memberName: string,
  offset: number
): { start: number; end: number } | null {
  const { parentOf, constructorOfVar } = buildChainMaps(text);

  let ctor: string | undefined =
    baseVarName === 'this' ? findEnclosingConstructor(text, offset) ?? undefined : constructorOfVar.get(baseVarName);

  if (!ctor) return null;

  const visited = new Set<string>();
  while (ctor && !visited.has(ctor)) {
    visited.add(ctor);
    const found = findOwnPrototypeMember(text, ctor, memberName);
    if (found) return found;
    ctor = parentOf.get(ctor);
  }
  return null;
}

/** offset 위치의 `base.member` 또는 `this.member` 형태를 추출한다 (base가 없으면 null) */
export function getMemberAccessContext(
  text: string,
  offset: number
): { base: string; memberStart: number; memberEnd: number } | null {
  const isIdentChar = (ch: string) => /[\w$]/.test(ch);

  let memberStart = offset;
  while (memberStart > 0 && isIdentChar(text[memberStart - 1])) memberStart--;
  let memberEnd = offset;
  while (memberEnd < text.length && isIdentChar(text[memberEnd])) memberEnd++;
  if (memberStart === memberEnd) return null;

  if (text[memberStart - 1] !== '.') return null;

  let baseEnd = memberStart - 1;
  let baseStart = baseEnd;
  while (baseStart > 0 && isIdentChar(text[baseStart - 1])) baseStart--;
  if (baseStart === baseEnd) return null;

  return { base: text.slice(baseStart, baseEnd), memberStart, memberEnd };
}
