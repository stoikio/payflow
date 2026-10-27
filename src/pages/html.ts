const ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escape = (value: unknown) =>
  String(value ?? '').replaceAll(
    /[&<>"']/g,
    (character) => ENTITIES[character] ?? character,
  );

export const layout = ({
  title,
  body,
  refreshSeconds,
}: {
  title: string;
  body: string;
  refreshSeconds?: number;
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : ''}
<title>${escape(title)}</title>
<style>
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1a1f36; background: #f6f8fa; }
  header { background: #0f5132; color: white; padding: 12px 24px; display: flex; gap: 12px; align-items: baseline; }
  header strong { font-size: 16px; }
  header span { opacity: .8; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  main { max-width: 1200px; margin: 0 auto; padding: 24px; }
  .card { background: white; border: 1px solid #e3e8ee; border-radius: 8px; padding: 24px; }
  .narrow { max-width: 420px; margin: 48px auto; }
  label { display: block; font-weight: 500; margin: 16px 0 4px; }
  input { width: 100%; box-sizing: border-box; height: 38px; padding: 0 10px; border: 1px solid #cfd7df; border-radius: 6px; font: inherit; }
  button { margin-top: 20px; width: 100%; height: 40px; border: 0; border-radius: 6px; background: #0f5132; color: white; font: inherit; font-weight: 600; cursor: pointer; }
  .error { margin-top: 12px; padding: 8px 10px; border-radius: 6px; background: #fde4e4; color: #a01c1c; }
  .muted { color: #697386; font-size: 12px; }
  h2 { font-size: 15px; margin: 32px 0 8px; }
  table { width: 100%; border-collapse: collapse; background: white; border: 1px solid #e3e8ee; border-radius: 8px; overflow: hidden; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #eef1f4; font-size: 12px; white-space: nowrap; }
  th { background: #f6f8fa; color: #697386; font-weight: 500; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  .status { padding: 1px 6px; border-radius: 8px; background: #eef1f4; }
  .status.active, .status.paid_out, .status.confirmed, .status.succeeded { background: #d7f7e6; color: #0f5132; }
  .status.failed, .status.charged_back, .status.cancelled { background: #fde4e4; color: #a01c1c; }
</style>
</head>
<body>
<header><strong>PayFlow</strong><span>Sandbox</span></header>
<main>${body}</main>
</body>
</html>`;
