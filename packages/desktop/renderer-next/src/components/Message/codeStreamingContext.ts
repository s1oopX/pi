import { createContext } from "react";

// Signals to descendant CodeBlocks that they are inside the actively streaming
// assistant turn. While true, code blocks defer syntax highlighting and render
// plain monospace text instead — the message re-renders on every token, so
// re-running shiki each time is wasted work. Highlighting runs once the turn
// finishes and this flips to false (Codex-style "light up when complete").
export const CodeStreamingContext = createContext(false);
