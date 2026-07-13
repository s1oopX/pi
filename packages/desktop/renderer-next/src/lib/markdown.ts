import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

const PRELOADED_LANGS = [
  "javascript",
  "typescript",
  "python",
  "bash",
  "json",
  "html",
  "css",
  "markdown",
  "rust",
  "go",
  "java",
  "c",
  "cpp",
  "yaml",
  "toml",
  "sql",
  "diff",
  "tsx",
  "jsx",
] as const;

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [...PRELOADED_LANGS],
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const loadedLangs = highlighter.getLoadedLanguages();
  const resolvedLang = loadedLangs.includes(lang) ? lang : "text";

  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    themes: {
      dark: "github-dark",
      light: "github-light",
    },
  });
}
