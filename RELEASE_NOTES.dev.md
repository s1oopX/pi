# Pi Studio Dev v0.82.1-dev.1

首个面向个人开发者的社区 fork 发布。本版本在上游 Pi Studio 基础上，新增三项开箱即用的功能，并对 Windows 平台做了适配。

## 新功能

### 项目快速启动

欢迎页一键创建项目骨架，无需手动 `npm init` 或查阅模板：

- **Next.js 15**（App Router + TypeScript）
- **Express API**（TypeScript + tsx）
- **Node.js CLI**（Commander + TypeScript）

点击模板卡片 → 选择父文件夹并输入项目名 → 自动复制模板、执行 `npm install` 与 `git init` → 完成后直接打开新项目。

### AI 服务商快速添加

自定义提供商页面预置三个国内常用服务商，免去手填 base URL：

- **DeepSeek**（`https://api.deepseek.com`）
- **通义千问 Qwen**（`https://dashscope.aliyuncs.com/compatible-mode/v1`）
- **Moonshot Kimi**（`https://api.moonshot.cn/v1`）

选择预置后只需填入 API 密钥，点击「获取」会向服务商实时拉取真实模型列表——模型 ID 不写死，服务商增删模型时无需更新本应用。

### 镜像源切换

设置中新增「镜像源」分区，覆盖三个包管理器：

| 管理器 | 配置文件 | 预设源 |
|---|---|---|
| npm | `~/.npmrc` | 官方源、npmmirror（阿里） |
| pip | `pip.conf` / `pip.ini` | 官方源（PyPI）、清华 TUNA、阿里云 |
| cargo | `~/.cargo/config.toml` | 官方源（crates.io）、清华 TUNA |

切换会写入各工具自己的配置文件，保留原有注释、auth token 与无关配置；对默认源的选择不会为不存在的配置文件创建空文件。

## 安全与正确性修复

本发布在审查中修复了若干缺陷：

- 项目模板的 `template` 与项目名参数现经白名单与路径校验，无法通过 `..` 进行路径穿越。
- Windows 上 `npm install` 现通过 `cmd.exe` 调用，修复了此前必然报 `ENOENT` 的问题。
- 镜像源切换不再丢失 `~/.cargo/config.toml` 中 `[source.crates-io]` 的用户自定义键。
- 镜像源读取改用 npm 的 last-wins 语义，UI 显示与 npm 实际使用的源一致。
- 修复了未定义 CSS token 导致的设置项 hover 边框失效。

## Fork 基础设施

- 上游专用的 npm 发布、模型目录发布、issue 分析等自动化作业已加上仓库守卫，在本 fork 上不再误触发。
- Windows SmartScreen 首次运行提示的处理方式见[下载安装说明](README.zh-CN.md#下载安装)。

## 系统要求

- Windows 11 / Windows 10（64 位）
- 至少 4 GB 内存（建议 8 GB）
- 需要网络连接以调用 AI 模型 API

## 下载

见 [Releases 页面](https://github.com/s1oopX/pi/releases/latest)。

## 致谢

本项目 fork 自 [earendil-works/pi](https://github.com/earendil-works/pi)，感谢原作者的杰出工作。
