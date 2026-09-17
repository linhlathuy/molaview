interface UriLike {
  path: string;
  with?(change: { path: string }): UriLike;
}

interface WebviewLike {
  cspSource: string;
  asWebviewUri(uri: UriLike): { toString(): string };
}

function assetUri(webview: WebviewLike, extensionUri: UriLike, filename: string): string {
  const path = `${extensionUri.path.replace(/\/$/, '')}/dist/${filename}`;
  const uri = extensionUri.with ? extensionUri.with({ path }) : { path };
  return webview.asWebviewUri(uri).toString();
}

export function createWebviewHtml(webview: WebviewLike, extensionUri: UriLike, nonce: string): string {
  const script = assetUri(webview, extensionUri, 'webview.js');
  const style = assetUri(webview, extensionUri, 'webview.css');
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    "img-src data: blob:",
    `script-src 'nonce-${nonce}'`
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${style}">
  <title>MoLaView</title>
</head>
<body>
  <div id="app" aria-label="MoLaView"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}
