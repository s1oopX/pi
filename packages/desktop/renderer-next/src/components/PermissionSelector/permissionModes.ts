import type { PermissionMode } from "../../store";

export interface PermissionModeOption {
  mode: PermissionMode;
  label: string;
  description: string;
}

export const PERMISSION_MODE_OPTIONS: PermissionModeOption[] = [
  {
    mode: "full",
    label: "Full access",
    description: "Run all tool actions without asking.",
  },
  {
    mode: "auto",
    label: "Auto approve",
    description: "Ask only for potentially risky operations.",
  },
  {
    mode: "ask",
    label: "Ask every time",
    description: "Ask before commands or file changes.",
  },
];

export function optionForPermissionMode(mode: PermissionMode): PermissionModeOption {
  return PERMISSION_MODE_OPTIONS.find((option) => option.mode === mode) ?? PERMISSION_MODE_OPTIONS[2];
}
