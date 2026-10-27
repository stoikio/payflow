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

const NAV_LINKS = [
  { page: 'dashboard', href: '/dashboard', label: 'Dashboard' },
  { page: 'docs', href: '/docs', label: 'Docs' },
] as const;

export type NavPage = (typeof NAV_LINKS)[number]['page'];

const nav = (current: NavPage) =>
  `<nav>${NAV_LINKS.map(
    (link) =>
      `<a href="${link.href}"${link.page === current ? ' aria-current="page"' : ''}>${link.label}</a>`,
  ).join('')}</nav>`;

export const layout = ({
  title,
  body,
  refreshSeconds,
  current,
  head = '',
}: {
  title: string;
  body: string;
  refreshSeconds?: number;
  /** Shows the merchant navigation, with this page highlighted. Payer pages have none. */
  current?: NavPage;
  head?: string;
}) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshSeconds ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : ''}
<title>${escape(title)}</title>
<link rel="icon" href="data:,">
<style>
  body { margin: 0; font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif; color: #1a1f36; background: #f6f8fa; }
  header { background: #0f5132; color: white; padding: 12px 24px; display: flex; gap: 12px; align-items: baseline; }
  header strong { font-size: 16px; }
  header span { opacity: .8; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  header nav { margin-left: auto; display: flex; gap: 20px; }
  header nav a { color: white; opacity: .8; text-decoration: none; font-size: 13px; }
  header nav a:hover, header nav a[aria-current] { opacity: 1; text-decoration: underline; text-underline-offset: 4px; }
  a { color: #0f5132; }
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
  .status.delivered { background: #d7f7e6; color: #0f5132; }
  .status.pending { background: #fff1d6; color: #8a5300; }
  tr.failed td { background: #fff5f5; }
  tr.failed td:first-child { box-shadow: inset 3px 0 #d64545; }
  tr.retrying td { background: #fffaf0; }
  tr.retrying td:first-child { box-shadow: inset 3px 0 #e0a100; }
  .result-error { color: #a01c1c; white-space: normal; }
  .section-title { display: flex; align-items: baseline; gap: 16px; margin: 32px 0 8px; }
  .section-title h2 { margin: 0; }
  .filters { display: flex; gap: 6px; }
  .filters a { padding: 1px 10px; border: 1px solid #cfd7df; border-radius: 12px; background: white; color: #1a1f36; font-size: 12px; text-decoration: none; }
  .filters a[aria-current] { background: #1a1f36; border-color: #1a1f36; color: white; }
  button.inline { width: auto; height: 32px; margin: 0; padding: 0 14px; }
  pre { margin: 0; padding: 12px 14px; border-radius: 6px; background: #0f172a; color: #e2e8f0; overflow: auto; font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  pre code { color: inherit; }
</style>
${head}
</head>
<body>
<header><strong>PayFlow</strong><span>Sandbox</span>${current ? nav(current) : ''}</header>
<main>${body}</main>
</body>
</html>`;

export const status = (value: string) =>
  `<span class="status ${escape(value)}">${escape(value)}</span>`;

export const time = (value: string | number | null) =>
  value === null
    ? ''
    : escape(new Date(value).toISOString().replace('T', ' ').slice(0, 19));

export const table = (headers: string[], rows: string[][], rowClasses: string[] = []) =>
  rows.length === 0
    ? '<p class="muted">Nothing yet.</p>'
    : `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead><tbody>${rows
        .map(
          (cells, index) =>
            `<tr${rowClasses[index] ? ` class="${rowClasses[index]}"` : ''}>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`,
        )
        .join('')}</tbody></table>`;
