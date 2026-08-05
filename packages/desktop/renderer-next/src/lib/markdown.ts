import { createHighlighter, type BundledLanguage, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;
const languageLoads = new Map<BundledLanguage, Promise<void>>();

const HIGHLIGHT_LANGUAGES = new Set<string>([
  "javascript",
  "typescript",
  "python",
  "shellscript",
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
]);

const LANGUAGE_ALIASES: Readonly<Record<string, BundledLanguage>> = {
  bash: "shellscript",
  cjs: "javascript",
  "c++": "cpp",
  cts: "typescript",
  js: "javascript",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  py: "python",
  rs: "rust",
  sh: "shellscript",
  shell: "shellscript",
  ts: "typescript",
  yml: "yaml",
  zsh: "shellscript",
};

export function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: [],
    });
  }
  return highlighterPromise;
}

export async function highlightCode(code: string, lang: string): Promise<string> {
  const highlighter = await getHighlighter();
  const canonicalLang = LANGUAGE_ALIASES[lang] ?? lang;
  const resolvedLang = HIGHLIGHT_LANGUAGES.has(canonicalLang) ? canonicalLang as BundledLanguage : "text";
  if (resolvedLang !== "text" && !highlighter.getLoadedLanguages().includes(resolvedLang)) {
    let load = languageLoads.get(resolvedLang);
    if (!load) {
      load = highlighter.loadLanguage(resolvedLang);
      languageLoads.set(resolvedLang, load);
    }
    try {
      await load;
    } finally {
      if (languageLoads.get(resolvedLang) === load) languageLoads.delete(resolvedLang);
    }
  }

  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    themes: {
      dark: "github-dark",
      light: "github-light",
    },
  });
}
