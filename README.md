# JSP Language Support (VS Code Extension)

`.jsp` 파일에 대해 다음을 지원하는 확장입니다.

- **구문 강조(TextMate 문법)**: `<%-- --%>`, `<%@ %>`, `<%! %>`, `<%= %>`, `<% %>`,
  `${...}` EL 표현식을 인식하고, 나머지는 VS Code 내장 HTML 문법(`text.html.basic`)을
  그대로 재사용합니다. `<script>`/`<style>` 내부도 자동으로 JS/CSS 강조가 되고,
  taglib 커스텀 태그(`<my:tag>`)는 "알 수 없는 태그"로 빨갛게 표시되지 않도록
  별도 처리되어 있습니다.
- **자동완성 / 호버**
  - HTML 태그·속성 → `vscode-html-languageservice`
  - `<script>` 안의 JavaScript, 그리고 `@click`/`v-model`/`onclick` 같은
    이벤트·Vue 디렉티브 속성값 → TypeScript `LanguageService`
  - `<%@ page|include|taglib %>` 지시어 속성, 워크스페이스의 `.tld` 파일에서 찾은
    커스텀 태그·속성 → 자체 구현
- **정의로 이동 (Ctrl+클릭)**: `<script>` 안의 함수/변수, `<script src>`로 연결된
  외부 JS 파일, TypeScript 내장 lib(`Array.prototype.push` 등), ES5 프로토타입
  상속 체인(`Object.create`, `new Parent()` 등), Vue `methods`/`computed`/`data`
  객체 속성까지 정규식 기반 휴리스틱으로 따라갑니다.
- **문서 서식(Format Document)**: HTML 구조는 JSP 스크립틀릿을 안전하게 보존하며
  정렬하고, `<script>` 내부 JS는 TypeScript 자체 포맷 기능으로 별도 정렬합니다.

## 설정(Settings)

`settings.json`(워크스페이스 또는 사용자 설정)에서 다음 옵션을 조정할 수 있습니다.

| 설정 | 기본값 | 설명 |
|---|---|---|
| `jsp.javascript.globalScopeFolders` | `[]` | 이 폴더(워크스페이스 루트 기준 상대경로) 안의 `.js` 파일은 `<script src>`로 명시적으로 연결되어 있지 않아도 항상 전역 스코프에 포함됩니다. AJAX 등으로 런타임에 동적으로 로드되는 스크립트처럼 정적 분석으로 추적할 수 없는 파일에 사용하세요. IntelliJ/WebStorm의 "전역 리졸브 스코프"와 비슷한 방식입니다. 예: `["src/main/webapp/js/common"]` |
| `jsp.format.wrapLineLength` | `120` | 문서 서식(Format Document) 정렬 시 HTML 줄을 강제로 줄바꿈하는 최대 글자 수. 속성이 많은 긴 태그가 애매한 위치에서 잘려 보기 불편하다면 `0`으로 설정해 줄바꿈을 끄거나, 더 큰 값을 넣으세요. |
| `jsp.format.wrapAttributes` | `"auto"` | 속성이 많은 태그를 줄바꿈하는 방식. `auto` \| `force` \| `force-aligned` \| `force-expand-multiline` \| `aligned-multiple` \| `preserve` \| `preserve-aligned` 중 선택. `preserve`는 원래 작성한 줄바꿈을 최대한 유지합니다. |

**예시** (`.vscode/settings.json`):

```json
{
  "jsp.javascript.globalScopeFolders": ["src/main/webapp/js/common"],
  "jsp.format.wrapLineLength": 0,
  "jsp.format.wrapAttributes": "preserve"
}
```

설정을 바꾸면 확장을 다시 시작하지 않아도 바로 반영됩니다
(`workspace/didChangeConfiguration`을 감지해서 재적용).
`globalScopeFolders`로 지정한 폴더를 실제로 못 찾으면 VS Code 알림으로
경고가 뜨니, 경로가 워크스페이스 루트 기준으로 맞는지 확인하는 데 참고하세요.

## 구조

```
vscode-jsp-lang/
├─ package.json                 # 확장 매니페스트 (언어/문법/설정 등록)
├─ language-configuration.json  # 주석, 괄호, 자동닫기 설정
├─ syntaxes/jsp.tmLanguage.json # TextMate 문법
├─ client/src/extension.ts      # 확장 진입점 (LanguageClient 실행)
└─ server/src/
   ├─ server.ts                 # LSP 진입점, 요청 라우팅, 설정/워처 관리
   ├─ embeddedSupport.ts        # 문서를 html/js/css/jsp 영역으로 분리
   ├─ tldRegistry.ts            # 워크스페이스 .tld 파일 스캔·파싱
   ├─ globalScope.ts            # jsp.javascript.globalScopeFolders 스캔
   └─ modes/
      ├─ htmlMode.ts            # HTML 자동완성/호버
      ├─ javascriptMode.ts      # JS 자동완성/호버/정의이동/포맷
      ├─ jspMode.ts             # JSP 지시어 자동완성
      ├─ taglibMode.ts          # 커스텀 태그(prefix:tag) 자동완성
      ├─ vueHeuristics.ts       # Vue methods/computed/data 정의이동 휴리스틱
      ├─ prototypeHeuristics.ts # ES5 프로토타입 상속 체인 정의이동 휴리스틱
      └─ formatMode.ts          # 문서 서식(HTML 구조 + JS 재포맷)
```

## 동작 원리 (임베디드 언어)

JSP 문서 하나를 그대로 각 언어 서비스에 넘기면 문법 오류로 실패하기 때문에,
요청이 들어온 커서 위치의 언어를 먼저 판별한 뒤, **해당 언어 영역만 남기고
나머지는 같은 길이의 공백으로 치환한 가상 문서**를 만들어 각 언어 서비스에
전달합니다. 오프셋이 그대로 유지되므로 결과 위치를 원본 문서 좌표로 다시
변환할 필요가 없습니다. (VS Code의 공식 `html-language-features` 확장이 쓰는
방식과 동일한 패턴입니다.)

문서 서식 정렬만은 예외로, HTML 구조 정렬(JSP는 `templating:'erb'` 옵션으로
보존)과 JS 재포맷(TypeScript 자체 포맷 기능)을 각각 수행한 뒤 결과를 하나로
합쳐 문서 전체를 교체하는 방식을 씁니다.

## 실행 방법

```bash
npm install       # 루트 + client + server 의존성 설치
npm run compile   # tsc -b 로 client/out, server/out 생성
```

VS Code에서 이 폴더를 열고 `F5` (Run Extension)를 누르면 확장 개발 호스트
창이 열립니다. 거기서 `.jsp` 파일을 열어 확인하세요.

배포용 `.vsix`를 만들려면 `npm run compile` 대신 `node esbuild.js`로 번들링한
뒤 `npx @vscode/vsce package --allow-missing-repository --no-dependencies`를
실행하세요 (`.vscodeignore`가 소스와 불필요한 `node_modules`를 제외합니다).

## 알려진 제한사항 / 다음 단계

- `<% %>` 스크립틀릿·`<%! %>` 선언부의 **Java 코드 자동완성/에러체크는 미구현**입니다.
  완전한 지원을 하려면 JVM 기반 Java 언어 분석(예: Eclipse JDT LS 연동)이 필요해
  범위가 크게 커집니다. 우선 하이라이팅만 제공하고, 필요하면 사용자가
  "Language Support for Java" 확장을 별도로 함께 쓰는 방식을 권장합니다.
- 진단(diagnostics, 빨간 밑줄 에러 표시)은 아직 연결되어 있지 않습니다.
  `connection.sendDiagnostics(...)`를 `server.ts`의 `documents.onDidChangeContent`에서
  호출하도록 추가하면 됩니다.
- AJAX 등으로 **동적으로 삽입되는 `<script>`** 는 정적 분석으로 원천적으로 알 수
  없습니다. `jsp.javascript.globalScopeFolders`로 해당 폴더를 지정하거나,
  스크립트 맨 위에 `/// <reference path="./other.js" />` 주석을 쓰면 우회할 수 있습니다.
- Vue methods/computed/data, 프로토타입 상속 체인 정의이동은 **정규식 기반
  휴리스틱**이라 완전한 타입 분석이 아닙니다. 같은 이름의 멤버가 여러 곳에
  있으면 첫 번째로 찾은 것을 반환합니다.
- EL(`${...}`) 표현식 안의 빈(bean) 속성 자동완성은 미구현이며, `jspMode.ts`에
  프로젝트의 태그라이브러리/빈 정보를 채워 넣는 방식으로 확장할 수 있습니다.
- 태그라이브러리 프리셋 목록(`jspMode.ts`의 `COMMON_TAGLIBS`)은 예시이므로 실제
  프로젝트에 맞게 수정하세요 (워크스페이스의 `.tld` 파일은 자동으로 인식됩니다).
