<p align="center">
  <a href="https://github.com/s1oopX/pi">
    <img alt="pi logo" src="https://pi.dev/logo-auto.svg" width="128">
  </a>
</p>

# Pi Studio Dev

**Pi Studio Dev** 是 [Pi Studio](https://github.com/earendil-works/pi) 的社区 fork，专为个人开发者优化。原项目 Pi Studio 是一个强大的自扩展 AI 编程助手，Pi Studio Dev 在此基础上针对个人开发场景进行了定制和增强。

## 与上游的核心差异

Pi Studio Dev 聚焦于个人开发者的日常使用体验，以下是主要优化方向：

- **开箱即用**：简化配置流程，降低上手门槛，让个人开发者可以快速用上 AI 编程助手。
- **轻量化**：去除面向团队协作和企业场景的冗余功能，保持核心体验的简洁高效。
- **Windows 优先**：针对 Windows 11/10 平台进行专项适配和优化，确保桌面端体验流畅。
- **个人工作流增强**：后续将添加更多面向独立开发者的功能，如本地优先的会话管理、一键式项目初始化等。

> 更多差异化功能正在规划中，欢迎通过 Issue 提出建议。

## 功能

Pi Studio Dev 在原项目基础上，新增了面向个人开发者的实用功能：

- **项目快速启动**：欢迎页一键创建 Next.js、Express API、Node.js CLI 三种项目骨架，自动执行 `npm install` 与 `git init`，完成后直接打开新项目。
- **AI 服务商快速添加**：自定义提供商页面预置 DeepSeek、通义千问（Qwen）、Moonshot（Kimi）三个国内常用服务商，选择后只需填入 API 密钥并点击「获取」即可加载该服务商的真实模型列表。
- **镜像源切换**：设置中新增「镜像源」分区，可读取并切换 npm、pip、cargo 的 registry，预设官方源与清华、阿里等国内镜像；切换会写入各工具自己的配置文件，对本机所有项目生效。

## 快速开始

### 下载安装

1. 打开 [GitHub Releases](https://github.com/s1oopX/pi/releases/latest) 页面，找到最新的发布版本。
2. 在发布版本的 Assets 列表中，下载安装包：
   - 文件名格式：`PiStudio-{version}.exe`（例如 `PiStudio-0.82.1-dev.1.exe`）
3. 双击下载的 `.exe` 文件启动安装程序，按照向导完成安装。

> **提示**：下载时 Windows 可能会弹出 SmartScreen 警告。这是因为该应用尚未在 Microsoft Store 上架，属于正常现象。点击 **"更多信息"** > **"仍要运行"** 即可继续安装。

### 从源码构建

如果你更希望从源码构建，请参考 [CONTRIBUTING.md](CONTRIBUTING.md) 中的开发环境搭建说明。

## 系统要求

- **操作系统**：Windows 11 / Windows 10（64 位）
- **内存**：至少 4 GB RAM；建议 8 GB 或以上以流畅处理大型项目
- **网络**：需要网络连接以调用 AI 模型 API

## 项目结构

本项目基于 Pi 单体仓库（monorepo），包含以下核心包：

| 包 | 说明 |
|---|---|
| **coding-agent** | 交互式 AI 编程助手 CLI |
| **agent** | Agent 运行时，支持工具调用与状态管理 |
| **ai** | 统一多提供商 LLM API（OpenAI、Anthropic、Google 等） |
| **tui** | 终端 UI 库，支持增量渲染 |
| **desktop** | 桌面应用（面向 Windows 优化） |

## 链接

- **本仓库**：[github.com/s1oopX/pi](https://github.com/s1oopX/pi)
- **上游项目**：[github.com/earendil-works/pi](https://github.com/earendil-works/pi)
- **上游官网**：[pi.dev](https://pi.dev)

## 致谢

本项目 fork 自 [earendil-works/pi](https://github.com/earendil-works/pi)，感谢原作者的杰出工作和开源精神。Pi Studio 的架构设计和工程实践为 AI 编程助手领域树立了标杆。

## 许可证

MIT