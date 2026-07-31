const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

async function build() {
  // tsc -b(타입체크용)가 out에 컴파일 결과를 남겨두므로, 번들 전에 깨끗이 비운다.
  // 그렇지 않으면 esbuild가 만든 단일 server.js 옆에 tsc가 만든 개별 .js 찌꺼기가 함께 남는다.
  fs.rmSync('client/out', { recursive: true, force: true });
  fs.rmSync('server/out', { recursive: true, force: true });

  // client: vscode-languageclient까지 하나의 파일로 번들. vscode API는 VS Code가 런타임에 제공하므로 external.
  await esbuild.build({
    entryPoints: ['client/src/extension.ts'],
    bundle: true,
    outfile: 'client/out/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    minify: true,
    sourcemap: false
  });

  // server: typescript, vscode-languageserver 등을 하나의 파일로 번들.
  // vscode-html-languageservice는 내부적으로 동적 require를 쓰는 파일이 있어
  // 번들에 포함시키면 깨지므로 external로 두고 node_modules를 그대로 함께 배포한다.
  await esbuild.build({
    entryPoints: ['server/src/server.ts'],
    bundle: true,
    outfile: 'server/out/server.js',
    external: ['vscode', 'vscode-html-languageservice'],
    format: 'cjs',
    platform: 'node',
    target: 'node16',
    minify: true,
    sourcemap: false
  });

  copyTypescriptLibs();
  reportSize();
}

// typescript 패키지의 lib/*.d.ts 텍스트 파일만 복사한다.
// (제외되는 것들: typescript.js 자체(번들에 이미 포함됨), tsc.js/tsserver.js/typingsInstaller.js(CLI 전용, 미사용),
//  ko/ja/ru/... 등 진단 메시지 번역 json(미사용))
function copyTypescriptLibs() {
  const srcDir = path.join(__dirname, 'server', 'node_modules', 'typescript', 'lib');
  const destDir = path.join(__dirname, 'server', 'out', 'typescript-libs');
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });

  const files = fs.readdirSync(srcDir).filter(f => /^lib\..*\.d\.ts$/.test(f));
  for (const f of files) {
    fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
  }
  console.log(`[build] typescript lib .d.ts ${files.length}개 복사 -> server/out/typescript-libs`);
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return total;
}

function reportSize() {
  const mb = n => (n / 1024 / 1024).toFixed(2) + ' MB';
  console.log(`[build] client/out: ${mb(dirSize('client/out'))}`);
  console.log(`[build] server/out: ${mb(dirSize('server/out'))}`);
}

build().catch(err => {
  console.error(err);
  process.exit(1);
});
