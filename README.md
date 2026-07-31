# JSP Language Support (VS Code Extension)

`.jsp` 파일에 대해 다음을 지원하는 확장 스캐폴드입니다.

- **구문 강조(TextMate 문법)**: `<%-- --%>`, `<%@ %>`, `<%! %>`, `<%= %>`, `<% %>`,
  `${...}` EL 표현식을 인식하고, 나머지는 VS Code 내장 HTML 문법(`text.html.basic`)을
  그대로 재사용합니다. 즉 `<script>`/`<style>` 내부도 자동으로 JS/CSS 강조가 됩니다.
- **Language Server (자동완성/호버)**
  - HTML 태그/속성 자동완성 → `vscode-html-languageservice`
  - `<script>` 안의 JavaScript 자동완성/호버 → TypeScript `LanguageService`
  - `<%@ page|include|taglib %>` 지시어 속성 자동완성 → 자체 구현(`jspMode.ts`)

## 구조

```
vscode-jsp-lang/
├─ package.json                 # 확장 매니페스트 (언어/문법 등록)
├─ language-configuration.json  # 주석, 괄호, 자동닫기 설정
├─ syntaxes/jsp.tmLanguage.json # TextMate 문법
├─ client/src/extension.ts      # 확장 진입점 (LanguageClient 실행)
└─ server/src/
   ├─ server.ts                 # LSP 진입점, 요청 라우팅
   ├─ embeddedSupport.ts        # 문서를 html/js/css/jsp 영역으로 분리
   └─ modes/
      ├─ htmlMode.ts
      ├─ javascriptMode.ts
      └─ jspMode.ts
```

## 동작 원리 (임베디드 언어)

JSP 문서 하나를 그대로 각 언어 서비스에 넘기면 문법 오류로 실패하기 때문에,
요청이 들어온 커서 위치의 언어를 먼저 판별한 뒤, **해당 언어 영역만 남기고
나머지는 같은 길이의 공백으로 치환한 가상 문서**를 만들어 각 언어 서비스에
전달합니다. 오프셋이 그대로 유지되므로 결과 위치를 원본 문서 좌표로 다시
변환할 필요가 없습니다. (VS Code의 공식 `html-language-features` 확장이 쓰는
방식과 동일한 패턴입니다.)

## 실행 방법

```bash
npm install       # 루트 + client + server 의존성 설치
npm run compile   # tsc -b 로 client/out, server/out 생성
```

VS Code에서 이 폴더를 열고 `F5` (Run Extension)를 누르면 확장 개발 호스트
창이 열립니다. 거기서 `.jsp` 파일을 열어 확인하세요.

## 알려진 제한사항 / 다음 단계

- `<% %>` 스크립틀릿·`<%! %>` 선언부의 **Java 코드 자동완성/에러체크는 미구현**입니다.
  완전한 지원을 하려면 JVM 기반 Java 언어 분석(예: Eclipse JDT LS 연동)이 필요해
  범위가 크게 커집니다. 우선 하이라이팅만 제공하고, 필요하면 사용자가
  "Language Support for Java" 확장을 별도로 함께 쓰는 방식을 권장합니다.
- 진단(diagnostics)은 아직 연결되어 있지 않습니다. `connection.sendDiagnostics(...)`를
  `server.ts`의 `documents.onDidChangeContent`에서 호출하도록 추가하면 됩니다.
- EL(`${...}`) 표현식 안의 빈(bean) 속성 자동완성도 미구현이며, `jspMode.ts`에
  프로젝트의 태그라이브러리/빈 정보를 채워 넣는 방식으로 확장할 수 있습니다.
- 태그라이브러리 목록(`jspMode.ts`의 `COMMON_TAGLIBS`)은 예시이므로 실제 프로젝트에
  맞게 수정하세요.
