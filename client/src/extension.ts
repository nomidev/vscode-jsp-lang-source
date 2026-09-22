import * as path from 'path';
import * as vscode from 'vscode';
import { ExtensionContext } from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
  // 서버 모듈(컴파일된 위치)
  const serverModule = context.asAbsolutePath(
    path.join('server', 'out', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] }
    }
  };

  const clientOptions: LanguageClientOptions = {
    // jsp 언어 파일에서만 활성화
    documentSelector: [{ scheme: 'file', language: 'jsp' }],
    synchronize: {
      configurationSection: 'jsp'
    }
  };

  client = new LanguageClient(
    'jspLanguageServer',
    'JSP Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  registerTagAutoClose(context);
}

// "HTML 태그 자동완성(닫는 태그 자동 삽입)" - Auto Closing Tags 기능은 표준 LSP
// 요청이 아니라서(VS Code 내장 HTML 확장도 이런 식으로 구현한다), 클라이언트가
// 직접 타이핑을 감지해서 서버에 커스텀 요청(jsp/tagComplete)을 보내고,
// 돌아온 스니펫을 커서 위치에 삽입한다.
function registerTagAutoClose(context: ExtensionContext) {
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async event => {
      if (event.document.languageId !== 'jsp') return;
      if (event.contentChanges.length !== 1) return;

      const change = event.contentChanges[0];
      // 붙여넣기나 자동완성 삽입이 아니라, 사용자가 '>' 또는 '/' 한 글자를
      // 직접 타이핑한 경우만 대상으로 한다 (스니펫 삽입 자체가 이 조건에
      // 안 걸리므로 무한 루프로 이어지지 않는다).
      if (change.rangeLength !== 0) return;
      if (change.text !== '>' && change.text !== '/') return;

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document !== event.document) return;

      const position = change.range.start.translate(0, change.text.length);

      let snippet: string | null;
      try {
        snippet = await client.sendRequest<string | null>('jsp/tagComplete', {
          textDocument: { uri: event.document.uri.toString() },
          position: { line: position.line, character: position.character }
        });
      } catch {
        return;
      }

      if (!snippet) return;
      // 요청을 보내는 사이 커서가 옮겨졌을 수 있으니, 여전히 같은 위치인지 확인
      if (!editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return;

      editor.insertSnippet(new vscode.SnippetString(snippet), position);
    })
  );
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
