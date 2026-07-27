import { useState } from "react";
import { useI18n } from "../i18n";
import * as api from "../ipc/api";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import { showToast } from "./Toast";

interface CreateProjectDialogProps {
  open: boolean;
  template: string;
  onClose: () => void;
}

export function CreateProjectDialog({ open, template, onClose }: CreateProjectDialogProps) {
  const { t } = useI18n();
  const [projectName, setProjectName] = useState("");
  const [parentDir, setParentDir] = useState(() => {
    // Default to the user's Desktop or Documents folder; the IPC handler
    // will resolve these platform-appropriate paths.
    return "";
  });
  const [creating, setCreating] = useState(false);

  const targetDir = parentDir && projectName
    ? `${parentDir.replace(/[/\\]$/, "")}/${projectName}`
    : "";
  // NOTE: targetDir is for display only. The main process resolves the real
  // path from parentDir + projectName so the renderer can never inject ".."
  // or absolute paths — see project-templates.js sanitizeProjectName.

  async function handlePickFolder() {
    try {
      const selection = await api.chooseWorkspace();
      if (selection.cwd) {
        setParentDir(selection.cwd);
      }
    } catch {
      // User cancelled or the dialog failed — leave parentDir unchanged.
    }
  }

  async function handleCreate() {
    if (!projectName.trim() || !parentDir) return;
    setCreating(true);
    try {
      const result = await api.createProject({ template, parentDir, projectName });
      if (result.created) {
        await api.openWorkspace(result.path);
        showToast(
          t("Project created at {path}", "项目已创建于 {path}", { path: result.path }),
          "success",
        );
        onClose();
        setProjectName("");
      } else {
        showToast(
          t("Project could not be created.", "无法创建项目。"),
          "error",
        );
      }
    } catch (error) {
      showToast(
        t("Failed to create project: {error}", "创建项目失败：{error}", {
          error: error instanceof Error ? error.message : String(error),
        }),
        "error",
      );
    } finally {
      setCreating(false);
    }
  }

  function handleClose() {
    if (!creating) {
      onClose();
      setProjectName("");
    }
  }

  return (
    <Dialog
      open={open}
      title={t(`Create {template} Project`, `创建 {template} 项目`, { template })}
      onClose={handleClose}
      actions={
        <>
          <button
            className="dialog-btn dialog-btn-secondary"
            type="button"
            onClick={handleClose}
            disabled={creating}
          >
            {t("Cancel", "取消")}
          </button>
          <button
            className="dialog-btn dialog-btn-primary"
            type="button"
            onClick={handleCreate}
            disabled={creating || !projectName.trim() || !parentDir}
          >
            {creating ? t("Creating…", "创建中…") : t("Create", "创建")}
          </button>
        </>
      }
    >
      <div className="create-project-form">
        <div className="create-project-field">
          <label className="form-label" htmlFor="create-project-name">
            {t("Project name", "项目名称")}
          </label>
          <input
            id="create-project-name"
            className="form-input"
            type="text"
            value={projectName}
            placeholder={t("my-project", "my-project")}
            disabled={creating}
            autoFocus
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && projectName.trim() && parentDir && !creating) {
                handleCreate();
              }
            }}
          />
        </div>

        <div className="create-project-field">
          <label className="form-label">
            {t("Parent folder", "父文件夹")}
          </label>
          <div className="create-project-folder-row">
            <span className="create-project-folder-path">
              {parentDir || t("No folder selected", "未选择文件夹")}
            </span>
            <button
              className="dialog-btn dialog-btn-secondary create-project-pick-btn"
              type="button"
              onClick={handlePickFolder}
              disabled={creating}
            >
              <Icon name="folder" size={14} />
              {t("Browse", "浏览")}
            </button>
          </div>
        </div>

        {targetDir && (
          <div className="create-project-preview">
            <Icon name="folder-open" size={14} />
            <span>{targetDir}</span>
          </div>
        )}
      </div>
    </Dialog>
  );
}
