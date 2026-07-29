import { useCallback, useEffect, useState } from "react";
import { useI18n } from "../../i18n";
import * as api from "../../ipc/api";
import type { RemoteTransport, SshAuth, SshConnection, SshConnectionInput, SshConnectionList } from "../../ipc/api";
import { useStore } from "../../store";
import { showToast } from "../Toast";
import { SettingsSectionIcon } from "./SettingsSectionIcon";

interface ConnectionDraft {
  id?: string;
  name: string;
  transport: RemoteTransport;
  alias: string;
  hostname: string;
  port: string;
  auth: SshAuth;
  identityFile: string;
  remotePath: string;
  piCommand: string;
  autoConnect: boolean;
}

function newDraft(transport: RemoteTransport = "ssh", hostname = ""): ConnectionDraft {
  return {
    name: transport === "wsl" ? hostname : "",
    transport,
    alias: "",
    hostname,
    port: transport === "ssh" ? "22" : "",
    auth: "none",
    identityFile: "",
    remotePath: "~",
    piCommand: transport === "wsl" ? "~/.pi/studio/bin/pi" : "pi",
    autoConnect: false,
  };
}

function editDraft(connection: SshConnection): ConnectionDraft {
  return { ...connection, port: connection.port === undefined ? "" : String(connection.port) };
}

function connectionInput(draft: ConnectionDraft): SshConnectionInput {
  return {
    ...(draft.id ? { id: draft.id } : {}),
    name: draft.name,
    transport: draft.transport,
    alias: draft.alias,
    hostname: draft.hostname,
    ...(draft.port.trim() ? { port: Number(draft.port) } : {}),
    auth: draft.auth,
    identityFile: draft.identityFile,
    remotePath: draft.remotePath,
    piCommand: draft.piCommand,
    autoConnect: draft.autoConnect,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ConnectionsSettings() {
  const { t } = useI18n();
  const [data, setData] = useState<SshConnectionList | null>(null);
  const [draft, setDraft] = useState<ConnectionDraft>(newDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.listSshConnections());
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  function updateDraft<K extends keyof ConnectionDraft>(key: K, value: ConnectionDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function useWslDistribution(distribution: string): void {
    const saved = data?.connections.find(
      (connection) => connection.transport === "wsl" && connection.hostname === distribution,
    );
    setDraft(saved ? editDraft(saved) : newDraft("wsl", distribution));
  }

  async function testConnection(input: SshConnectionInput, key: string): Promise<void> {
    setBusy(`test:${key}`);
    try {
      const result = await api.testSshConnection(input);
      showToast(t("{transport} connection succeeded: {message}", "{transport} 连接成功：{message}", {
        transport: input.transport === "wsl" ? "WSL" : "SSH",
        message: result.message,
      }), "success");
    } catch (testError) {
      showToast(t("Remote connection failed: {message}", "远程连接失败：{message}", {
        message: errorMessage(testError),
      }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function installPi(): Promise<void> {
    const input = connectionInput(draft);
    const target = input.alias || input.hostname || input.name;
    if (!window.confirm(t(
      "Install or repair Pi on {target}? Pi Studio will download a checksum-verified private Node.js runtime and install the exact matching @earendil-works/pi-coding-agent package under ~/.pi/studio with lifecycle scripts disabled. No sudo is used.",
      "在 {target} 上安装或修复 Pi？Pi Studio 会下载经过校验和验证的私有 Node.js 运行时，并在 ~/.pi/studio 下安装与当前版本精确匹配的 @earendil-works/pi-coding-agent，同时禁用生命周期脚本。不会使用 sudo。",
      { target },
    ))) return;
    setBusy("install");
    try {
      const result = await api.installSshPi(input);
      updateDraft("piCommand", result.piCommand);
      showToast(t(
        "Pi {version} installed with Node.js {nodeVersion}. Save the connection to use it.",
        "已使用 Node.js {nodeVersion} 安装 Pi {version}。请保存连接以使用它。",
        { version: result.version, nodeVersion: result.nodeVersion },
      ), "success");
    } catch (installError) {
      showToast(t("Could not install Pi: {message}", "安装 Pi 失败：{message}", {
        message: errorMessage(installError),
      }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function connect(connection: SshConnection): Promise<void> {
    if (useStore.getState().isStreaming) {
      showToast(t("Finish or stop the current run before connecting.", "请先完成或停止当前运行，再连接远程工作区。"), "warning");
      return;
    }
    setBusy(`connect:${connection.id}`);
    try {
      const result = await api.connectSshConnection(connection.id);
      setData((current) => current && { ...current, activeConnectionId: connection.id });
      void useStore.getState().resetForWorkspace(result.cwd);
      useStore.getState().closeSettings();
      showToast(t("Connected to {name}", "已连接到 {name}", { name: connection.name }), "success");
    } catch (connectError) {
      showToast(t("Could not connect: {message}", "连接失败：{message}", {
        message: errorMessage(connectError),
      }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function save(connectAfterSave: boolean): Promise<void> {
    setBusy(connectAfterSave ? "save-connect" : "save");
    try {
      const result = await api.saveSshConnection(connectionInput(draft));
      setData((current) => current && { ...current, connections: result.connections });
      setDraft(editDraft(result.connection));
      showToast(t("Remote connection saved", "远程连接已保存"), "success");
      if (connectAfterSave) await connect(result.connection);
    } catch (saveError) {
      showToast(t("Could not save connection: {message}", "保存连接失败：{message}", {
        message: errorMessage(saveError),
      }), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(connection: SshConnection): Promise<void> {
    if (!window.confirm(t("Delete {name}?", "删除 {name}？", { name: connection.name }))) return;
    setBusy(`delete:${connection.id}`);
    try {
      const result = await api.deleteSshConnection(connection.id);
      setData((current) => current && { ...current, connections: result.connections });
      if (draft.id === connection.id) setDraft(newDraft());
      showToast(t("Remote connection deleted", "远程连接已删除"), "success");
    } catch (deleteError) {
      showToast(t("Could not delete connection: {message}", "删除连接失败：{message}", {
        message: errorMessage(deleteError),
      }), "error");
    } finally {
      setBusy(null);
    }
  }

  const disabled = busy !== null;

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">
        <SettingsSectionIcon route="connections" />
        {t("Connections", "连接")}
      </h3>
      <p className="settings-section-desc">
        {t(
          "Run Pi in an OpenSSH host or local WSL distribution. The agent, shell and workspace stay in that Linux environment; Git and isolated parallel worktrees run there, while selected artifacts are copied into Pi Studio's private local cache.",
          "通过 OpenSSH 主机或本地 WSL 发行版运行 Pi。智能体、命令和工作区都留在该 Linux 环境；Git 与隔离的并行工作树也在其中运行，只有选中的产物会复制到 Pi Studio 的私有本地缓存。",
        )}
      </p>

      {error && <div className="settings-error">{error}</div>}
      {data && (
        <div className="settings-group">
          <span className="settings-group-label">{t("Detected WSL distributions", "检测到的 WSL 发行版")}</span>
          <p className="settings-group-desc">
            {data.wslError
              ? data.wslError
              : data.wslDistributions.length === 0
                ? t("No user WSL distributions were found.", "未检测到用户 WSL 发行版。")
                : t(
                    "Choose a distribution to create or edit a direct local connection. No SSH server is required.",
                    "选择发行版即可创建或编辑本地直连；无需 SSH 服务器。",
                  )}
          </p>
          {data.wslDistributions.length > 0 && (
            <div className="settings-radio-group">
              {data.wslDistributions.map((distribution) => (
                <button
                  className="settings-btn"
                  type="button"
                  key={distribution}
                  disabled={disabled}
                  onClick={() => useWslDistribution(distribution)}
                >
                  {distribution}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="settings-group">
        <span className="settings-group-label">
          {draft.id ? t("Edit remote connection", "编辑远程连接") : t("New remote connection", "新建远程连接")}
        </span>
        <p className="settings-group-desc">
          {draft.transport === "wsl"
            ? t(
                "WSL connects through wsl.exe directly. Install / Repair Pi provisions Studio's managed runtime inside the distribution without sudo.",
                "WSL 通过 wsl.exe 直接连接。“安装 / 修复 Pi”会在发行版内无 sudo 配置 Studio 托管运行时。",
              )
            : t(
                "Password prompts are not supported. Use SSH config, an agent, or an identity file. Install / Repair Pi provisions Studio's managed Linux runtime without sudo.",
                "不支持密码提示。请使用 SSH config、密钥代理或身份文件。“安装 / 修复 Pi”会无 sudo 配置 Studio 托管 Linux 运行时。",
              )}
        </p>
        <div className="form-row">
          <label className="form-label" htmlFor="remote-transport">{t("Connection type", "连接类型")}</label>
          <select
            id="remote-transport"
            className="form-select"
            value={draft.transport}
            onChange={(event) => updateDraft("transport", event.target.value as RemoteTransport)}
          >
            <option value="ssh">OpenSSH</option>
            <option value="wsl">WSL</option>
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="ssh-name">{t("Display name", "显示名称")}</label>
          <input id="ssh-name" className="form-input" value={draft.name} onChange={(event) => updateDraft("name", event.target.value)} placeholder="Dev box" />
        </div>
        {draft.transport === "ssh" && (
          <div className="form-row">
            <label className="form-label" htmlFor="ssh-alias">{t("Alias (optional)", "Alias（可选）")}</label>
            <input id="ssh-alias" className="form-input" value={draft.alias} onChange={(event) => updateDraft("alias", event.target.value)} placeholder="devbox" />
          </div>
        )}
        <div className="form-row">
          <label className="form-label" htmlFor="ssh-host">
            {draft.transport === "wsl" ? t("WSL distribution", "WSL 发行版") : t("Hostname", "Hostname")}
          </label>
          <input
            id="ssh-host"
            className="form-input"
            value={draft.hostname}
            list={draft.transport === "wsl" ? "wsl-distributions" : undefined}
            onChange={(event) => updateDraft("hostname", event.target.value)}
            placeholder={draft.transport === "wsl" ? "Ubuntu" : "user@example.com"}
          />
          <datalist id="wsl-distributions">
            {data?.wslDistributions.map((distribution) => <option value={distribution} key={distribution} />)}
          </datalist>
        </div>
        {draft.transport === "ssh" && (
          <div className="form-row">
            <label className="form-label" htmlFor="ssh-port">{t("SSH port (optional)", "SSH 端口（可选）")}</label>
            <input id="ssh-port" className="form-input" type="number" min="1" max="65535" value={draft.port} onChange={(event) => updateDraft("port", event.target.value)} placeholder="22" />
          </div>
        )}
        {draft.transport === "ssh" && (
          <div className="form-row">
            <label className="form-label" htmlFor="ssh-auth">{t("Authentication", "认证")}</label>
            <select id="ssh-auth" className="form-select" value={draft.auth} onChange={(event) => updateDraft("auth", event.target.value as SshAuth)}>
              <option value="none">{t("No Auth / SSH config", "无认证 / SSH config")}</option>
              <option value="identity">{t("Identity file", "身份文件")}</option>
            </select>
          </div>
        )}
        {draft.transport === "ssh" && draft.auth === "identity" && (
          <div className="form-row">
            <label className="form-label" htmlFor="ssh-identity">{t("Identity file path", "身份文件路径")}</label>
            <input id="ssh-identity" className="form-input" value={draft.identityFile} onChange={(event) => updateDraft("identityFile", event.target.value)} placeholder="~/.ssh/id_ed25519" />
          </div>
        )}
        <div className="form-row">
          <label className="form-label" htmlFor="ssh-path">{t("Remote workspace path", "远程工作区路径")}</label>
          <input id="ssh-path" className="form-input" value={draft.remotePath} onChange={(event) => updateDraft("remotePath", event.target.value)} placeholder="~/work/project" />
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="ssh-pi-command">{t("Pi command", "Pi 命令")}</label>
          <input id="ssh-pi-command" className="form-input" value={draft.piCommand} onChange={(event) => updateDraft("piCommand", event.target.value)} placeholder="pi" />
        </div>
        <label className="settings-toggle">
          <input type="checkbox" checked={draft.autoConnect} onChange={(event) => updateDraft("autoConnect", event.target.checked)} />
          <span>
            <strong>{t("Connect automatically at startup", "启动时自动连接")}</strong>
            <small>{t("Only one saved connection can auto-connect.", "只能有一个已保存连接自动连接。")}</small>
          </span>
        </label>
        <div className="settings-radio-group">
          <button className="settings-btn" type="button" disabled={disabled} onClick={() => void testConnection(connectionInput(draft), draft.id ?? "draft")}>
            {busy?.startsWith("test:") ? t("Testing…", "正在测试…") : t("Test", "测试")}
          </button>
          <button className="settings-btn" type="button" disabled={disabled} onClick={() => void installPi()}>
            {busy === "install" ? t("Installing Pi…", "正在安装 Pi…") : t("Install / Repair Pi", "安装 / 修复 Pi")}
          </button>
          <button className="settings-btn" type="button" disabled={disabled} onClick={() => void save(false)}>
            {busy === "save" ? t("Saving…", "正在保存…") : t("Save", "保存")}
          </button>
          <button className="settings-btn settings-btn-primary" type="button" disabled={disabled} onClick={() => void save(true)}>
            {busy === "save-connect" ? t("Connecting…", "正在连接…") : t("Save & Connect", "保存并连接")}
          </button>
          <button className="settings-btn" type="button" disabled={disabled} onClick={() => setDraft(newDraft())}>
            {t("Clear", "清空")}
          </button>
        </div>
      </div>

      <h4 className="settings-subsection-title">{t("Saved remote connections", "已保存远程连接")}</h4>
      {loading && !data && <div className="settings-empty">{t("Loading connections…", "正在加载连接…")}</div>}
      {!loading && data?.connections.length === 0 && (
        <div className="settings-empty">{t("No remote connections saved.", "尚未保存远程连接。")}</div>
      )}
      {data && data.connections.length > 0 && (
        <div className="resource-list">
          {data.connections.map((connection) => {
            const active = data.activeConnectionId === connection.id;
            return (
              <div className="resource-row" key={connection.id}>
                <div className="resource-copy">
                  <span className="resource-name">
                    {connection.name}{active ? ` · ${t("Active", "已连接")}` : ""}
                  </span>
                  <span className="resource-description">
                    {connection.transport === "wsl"
                      ? `WSL · ${connection.hostname}`
                      : connection.alias
                        ? `${connection.alias} → ${connection.hostname}`
                        : connection.hostname}
                    {connection.transport === "ssh" && connection.port ? `:${connection.port}` : ""}
                    {connection.autoConnect ? ` · ${t("auto-connect", "自动连接")}` : ""}
                  </span>
                  <span className="resource-path">{connection.remotePath}</span>
                </div>
                <div className="settings-radio-group">
                  <button className="settings-btn-sm" type="button" disabled={disabled} onClick={() => setDraft(editDraft(connection))}>
                    {t("Edit", "编辑")}
                  </button>
                  <button className="settings-btn-sm" type="button" disabled={disabled} onClick={() => void testConnection(connection, connection.id)}>
                    {busy === `test:${connection.id}` ? t("Testing…", "测试中…") : t("Test", "测试")}
                  </button>
                  <button className="settings-btn-sm settings-btn-primary" type="button" disabled={disabled} onClick={() => void connect(connection)}>
                    {busy === `connect:${connection.id}` ? t("Connecting…", "连接中…") : t("Connect", "连接")}
                  </button>
                  <button className="settings-btn-sm settings-btn-danger-link" type="button" disabled={disabled || active} onClick={() => void remove(connection)}>
                    {t("Delete", "删除")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
