import { describe, expect, it } from "vitest";
import {
  COMMAND_PALETTE_ENTRIES,
  filterCommandPaletteEntries,
  findCommandPaletteEdge,
  localizeCommandPaletteEntries,
  moveCommandPaletteSelection,
  type CommandPaletteEntry,
} from "./commandPaletteState";

describe("command palette state", () => {
  it("matches all query terms across labels, descriptions, and keywords", () => {
    expect(filterCommandPaletteEntries(COMMAND_PALETTE_ENTRIES, "workspace recent").map(({ id }) => id))
      .toEqual(["switch-workspace"]);
    expect(filterCommandPaletteEntries(COMMAND_PALETTE_ENTRIES, "prompt input").map(({ id }) => id))
      .toEqual(["focus-composer"]);
    expect(filterCommandPaletteEntries(COMMAND_PALETTE_ENTRIES, "provider configure").map(({ id }) => id))
      .toEqual(["open-settings"]);
  });

  it("prioritizes label matches without mutating the source list", () => {
    const entries: CommandPaletteEntry[] = [
      { id: "focus-composer", label: "Focus Input", description: "Search helper", keywords: [] },
      { id: "focus-thread-search", label: "Search Threads", description: "Thread search", keywords: [] },
    ];

    expect(filterCommandPaletteEntries(entries, "search").map(({ id }) => id))
      .toEqual(["focus-thread-search", "focus-composer"]);
    expect(entries.map(({ id }) => id)).toEqual(["focus-composer", "focus-thread-search"]);
  });

  it("localizes command copy and supports Chinese search terms", () => {
    const localized = localizeCommandPaletteEntries(COMMAND_PALETTE_ENTRIES, "zh-CN");

    expect(localized.find(({ id }) => id === "open-settings")?.label).toBe("打开设置");
    expect(filterCommandPaletteEntries(localized, "工作区 最近").map(({ id }) => id))
      .toEqual(["switch-workspace"]);
    expect(filterCommandPaletteEntries(localized, "打开 设置").map(({ id }) => id))
      .toEqual(["open-settings"]);
    expect(filterCommandPaletteEntries(localized, "open settings").map(({ id }) => id))
      .toEqual(["open-settings"]);
    expect(filterCommandPaletteEntries(localized, "fresh agent session").map(({ id }) => id))
      .toEqual(["new-thread"]);

    const disabled = localizeCommandPaletteEntries([
      { ...COMMAND_PALETTE_ENTRIES[1], disabled: true, disabledReason: "Agent backend is not ready" },
    ], "zh-CN");
    expect(disabled[0].disabledReason).toBe("智能体后端尚未就绪");
  });

  it("wraps keyboard selection and skips disabled commands", () => {
    const entries: CommandPaletteEntry[] = [
      { ...COMMAND_PALETTE_ENTRIES[0] },
      { ...COMMAND_PALETTE_ENTRIES[1], disabled: true },
      { ...COMMAND_PALETTE_ENTRIES[2] },
    ];

    expect(findCommandPaletteEdge(entries, "first")).toBe(0);
    expect(findCommandPaletteEdge(entries, "last")).toBe(2);
    expect(moveCommandPaletteSelection(entries, 0, 1)).toBe(2);
    expect(moveCommandPaletteSelection(entries, 2, 1)).toBe(0);
    expect(moveCommandPaletteSelection(entries, 0, -1)).toBe(2);
  });

  it("returns no selection when every result is disabled", () => {
    const entries = COMMAND_PALETTE_ENTRIES.slice(0, 2).map((entry) => ({ ...entry, disabled: true }));
    expect(findCommandPaletteEdge(entries, "first")).toBe(-1);
    expect(findCommandPaletteEdge(entries, "last")).toBe(-1);
    expect(moveCommandPaletteSelection(entries, 0, 1)).toBe(-1);
  });
});
