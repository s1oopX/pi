const OLD_LINE = /<div class="line-num1">(\d+)<\/div>/g;
const NEW_LINE = /<div class="line-num2">(\d+)<\/div>/g;

export function addDiffLineAnchors(markup: string, oldLabel: string, newLabel: string): string {
  return markup
    .replace(OLD_LINE, (_match, line: string) => lineAnchor("old", "line-num1", line, oldLabel))
    .replace(NEW_LINE, (_match, line: string) => lineAnchor("new", "line-num2", line, newLabel));
}

function lineAnchor(side: "old" | "new", className: string, line: string, label: string): string {
  return `<button type="button" class="diff-line-anchor ${className}" data-diff-side="${side}" data-diff-line="${line}" aria-label="${label} ${line}" title="${label} ${line}">${line}</button>`;
}
