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

## 快速开始

从 [GitHub Releases](https://github.com/s1oopX/pi/releases) 页面下载最新版本安装包即可开始使用。

## 系统要求

- **操作系统**：Windows 11 / Windows 10（64 位）
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