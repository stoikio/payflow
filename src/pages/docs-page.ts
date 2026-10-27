import { readFileSync } from 'node:fs';

import { Marked } from 'marked';

import { layout } from './html.ts';

export const API_REFERENCE = new URL('../../docs/api.md', import.meta.url);

type TocEntry = { depth: number; id: string; html: string };

/** GitHub's heading anchors, so links written for the repository work on the page too. */
const slugify = (text: string) =>
  text
    .toLowerCase()
    .replaceAll(/[`*]/g, '')
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replaceAll(/\s/g, '-');

export const renderMarkdown = (markdown: string) => {
  const toc: TocEntry[] = [];
  const seen = new Map<string, number>();
  let title = 'API reference';

  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth, text }) {
        const html = this.parser.parseInline(tokens);
        if (depth === 1) {
          title = text;
          return `<h1>${html}</h1>\n`;
        }
        const slug = slugify(text);
        const count = seen.get(slug) ?? 0;
        seen.set(slug, count + 1);
        const id = count === 0 ? slug : `${slug}-${count}`;
        if (depth <= 3) {
          toc.push({ depth, id, html });
        }
        return `<h${depth} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${html}</h${depth}>\n`;
      },
    },
  });

  return { html: marked.parse(markdown, { async: false }), toc, title };
};

const tableOfContents = (toc: TocEntry[]) => {
  const sections: string[] = [];
  let children: string[] = [];
  const close = () => {
    if (children.length > 0) {
      sections.push(`<ul>${children.join('')}</ul>`);
      children = [];
    }
  };
  for (const entry of toc) {
    const link = `<a href="#${entry.id}">${entry.html}</a>`;
    if (entry.depth === 2) {
      close();
      sections.push(`<li class="section">${link}`);
    } else {
      children.push(`<li>${link}</li>`);
    }
  }
  close();
  return `<ul>${sections.join('</li>')}</li></ul>`;
};

const STYLES = `<style>
  main { max-width: 1240px; }
  .docs { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 40px; align-items: start; }
  .toc { position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow-y: auto; font-size: 13px; }
  .toc ul { list-style: none; margin: 0; padding: 0; }
  .toc ul ul { margin: 2px 0 8px; padding-left: 12px; border-left: 1px solid #e3e8ee; }
  .toc a { display: block; padding: 2px 8px; border-radius: 4px; color: #3c4257; text-decoration: none; }
  .toc a:hover { background: #eef1f4; }
  .toc a.active { color: #0f5132; background: #d7f7e6; }
  .toc li.section > a { font-weight: 600; color: #1a1f36; margin-top: 6px; }
  .toc code { font-size: 12px; }
  .doc { min-width: 0; background: white; border: 1px solid #e3e8ee; border-radius: 8px; padding: 32px 40px; font-size: 14px; line-height: 1.6; }
  .doc h1 { font-size: 26px; margin: 0 0 12px; }
  .doc h2 { font-size: 20px; margin: 48px 0 12px; padding-top: 24px; border-top: 1px solid #eef1f4; }
  .doc h3 { font-size: 16px; margin: 32px 0 8px; }
  .doc h4 { font-size: 14px; margin: 24px 0 6px; }
  .doc h2, .doc h3, .doc h4 { position: relative; scroll-margin-top: 16px; }
  .doc .anchor { position: absolute; left: -18px; color: #a3acb9; text-decoration: none; opacity: 0; }
  .doc :is(h2, h3, h4):hover .anchor { opacity: 1; }
  .doc p, .doc ul, .doc ol { margin: 8px 0; }
  .doc :not(pre) > code { padding: 1px 5px; border-radius: 4px; background: #f2f4f7; color: #1a1f36; }
  .doc pre { margin: 12px 0; }
  .doc table { display: block; width: max-content; max-width: 100%; overflow-x: auto; margin: 12px 0; }
  .doc th, .doc td { white-space: normal; font-size: 13px; padding: 8px 12px; vertical-align: top; }
  .doc td code { white-space: nowrap; }
  @media (max-width: 860px) { .docs { grid-template-columns: 1fr; } .toc { position: static; max-height: none; } .doc { padding: 24px; } }
</style>`;

/** Highlights the section being read in the table of contents. */
const SCRIPT = `<script>
  const links = [...document.querySelectorAll('.toc a')];
  const headings = links.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  const highlight = () => {
    let current = 0;
    headings.forEach((heading, index) => {
      if (heading && heading.getBoundingClientRect().top < 120) current = index;
    });
    links.forEach((link, index) => link.classList.toggle('active', index === current));
  };
  addEventListener('scroll', highlight, { passive: true });
  highlight();
</script>`;

/** Read on every request: edits to the reference show without a restart. */
export const docsPage = () => {
  const { html, toc, title } = renderMarkdown(readFileSync(API_REFERENCE, 'utf8'));
  return layout({
    title,
    current: 'docs',
    head: STYLES,
    body: `<div class="docs">
<nav class="toc" aria-label="Table of contents">${tableOfContents(toc)}</nav>
<article class="doc">${html}</article>
</div>
${SCRIPT}`,
  });
};
