#!/usr/bin/env bash
# 배포용 vsix 생성 스크립트.
# 개발용 node_modules(전체 설치본)를 건드리지 않으려면 이 스크립트 실행 전에
# 별도 clean checkout에서 돌리는 것을 권장합니다.
set -e
cd "$(dirname "$0")/.."

echo "1) 타입체크"
npx tsc -b

echo "2) esbuild 번들링 (client/server 각각 단일 js로)"
rm -rf client/out server/out
node esbuild.js

echo "3) client/node_modules 제거 (번들에 이미 포함됨)"
rm -rf client/node_modules

echo "4) server/node_modules를 typescript 런타임 필수 파일만 남기고 정리"
TS_DIR="server/node_modules/typescript"
if [ -d "$TS_DIR" ]; then
  find server/node_modules -mindepth 1 -maxdepth 1 ! -name typescript -exec rm -rf {} +
  rm -rf "$TS_DIR/bin" "$TS_DIR/README.md" "$TS_DIR/SECURITY.md" "$TS_DIR/ThirdPartyNoticeText.txt"
  rm -f "$TS_DIR"/lib/_tsc.js "$TS_DIR"/lib/_tsserver.js "$TS_DIR"/lib/_typingsInstaller.js \
        "$TS_DIR"/lib/tsc.js "$TS_DIR"/lib/tsserver.js "$TS_DIR"/lib/tsserverlibrary.js \
        "$TS_DIR"/lib/typingsInstaller.js "$TS_DIR"/lib/watchGuard.js "$TS_DIR"/lib/typesMap.json \
        "$TS_DIR"/lib/typescript.d.ts "$TS_DIR"/lib/typescript.js.map
  rm -rf "$TS_DIR"/lib/{cs,de,es,fr,it,ja,ko,pl,pt-br,ru,tr,zh-cn,zh-tw}
  cat > "$TS_DIR/package.json" << 'EOF'
{
  "name": "typescript",
  "version": "5.4.5",
  "main": "./lib/typescript.js"
}
EOF
fi

echo "5) vsix 패키징"
npx vsce package --allow-missing-repository --no-dependencies

echo "완료. 생성된 .vsix 파일을 확인하세요."
echo "주의: 이 스크립트는 node_modules를 실제로 삭제/축소합니다."
echo "다시 개발하려면 'npm install'로 원상 복구하세요."
