# WhaleBox 1.5.0

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.5.0 更新（2026-08-26）

- **启动不再打开系统浏览器**：内置 dsh web 默认会用系统默认浏览器打开 WebUI；本应用由玻璃窗口内嵌显示，故启动服务时显式传入 `--no-open`，关闭外开浏览器（WebUI 仍在窗口内加载）。
- **修复圆角外围深色直角**：`#root` 内容区外层的矩形 box-shadow 会填充到圆角外侧的方形角落，形成「圆角外围一圈深色直角」；已移除全部外层投影（明暗两套主题），仅保留内侧 1px 高光描边。

---

# WhaleBox 1.4.0

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.4.0 更新（2026-08-25）

- **统一更新检测**：设置 → 通用设置 的「更新检测」重构为单一组件——「一键检查更新」同时检查框架（WhaleBox Releases）与 WebUI（官方 npm）的新版本，**分行显示版本号**（框架：当前/最新；WebUI：当前/服务端/官方最新），检测到任一新版本都会提示
- **一键更新**：发现更新后点「一键更新」自动完成全部操作，无需逐项处理：
  1. WebUI 与服务端不匹配时先自动修复（下载配套界面 → 原子替换 → 重启本地服务）
  2. 框架有新版本时自动下载安装包 → 校验 → 退出应用 → 静默安装（新框架自带配套新 WebUI）→ 完成后可重新启动应用
- **框架更新提速**（此前单线程下载 ~180MB 安装包过慢）：
  - **多连接分块下载**：6 线程 Range 并发拉取安装包（服务器不支持断点分块时自动退化为单流），实测同网络下显著快于单线程
  - **SHA-512 完整性校验**：下载完成后按 latest.yml 中的哈希校验，防止损坏
  - **静默安装**：校验通过后退出应用并静默运行安装包（`/S --updated`），与 electron-updater 行为一致
  - **自动回退**：加速通道不可用时自动切换 electron-updater 标准通道（含差量下载能力）
- **兼容性说明**：WebUI 前端仍必须与框架服务端完全同版本（v1.3.1 策略不变）；官方更高版本的界面随框架更新一并安装，不单独跨版本更新
- 源码工程 `package-app/` 同步更新（`main.js` 统一更新编排 / `webui-update.js` 多连接下载器 / `preload.js` 新桥接 / `dsh-update-check` 插件统一 UI）；版本升至 1.4.0

---

# WhaleBox 1.3.1

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.3.1 更新（2026-08-25）

- **修复 WebUI 单独更新的跨版本不兼容**（1.3.0 引入）：此前「检查 WebUI 更新」会把前端升到官方最新（如 0.1.1-rc.2），但新版前端需要配套的新服务端 API，与内置服务端（如 0.1.0-rc.7）不匹配，导致界面报 `window.__ModuleLoader__ bootstrap facade is missing` 打不开
  - 实测确认：服务端 0.1.0-rc.7 搭配前端 0.1.0-rc.8 / 0.1.1-rc.2 均无法启动界面，**前端必须与服务端完全同版本**
  - **新策略**：WebUI「单独更新」仅允许安装与当前服务端（`@deepseek-ai/dsh-web-app`）**完全同版本**的前端，语义为修复/重装框架配套界面；官方更高版本的前端明确提示"需要配套新框架，请使用「检查框架更新」升级"
- **启动自检自动恢复**：应用启动时校验前端与服务端版本，若不匹配（如装了跨版本前端）自动从安装前备份恢复配套界面，避免坏更新后界面打不开
- **安装前备份**：每次应用 WebUI 更新前，把当前 dist 与版本信息备份到用户数据目录（`dsh-home/webui-update/backup/<版本>/`）
- 源码工程 `package-app/` 同步更新；版本升至 1.3.1

---

# WhaleBox 1.3.0

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.3.0 更新（2026-08-24）

- **WebUI 单独更新**：设置 → 通用设置 → 检查 WebUI 更新，发现新版本后点击「立即更新」，应用自动下载官方新版界面（转圈 + 进度条）、解压校验、原子替换并重启本地服务，几秒钟生效——**无需重装框架**
  - 版本来源：官方 npm `@deepseek-ai/dsh-web-frontend`（dist-tags 取版本最高者，避免 latest 旧标签误报；仅允许与当前框架同 major.minor 的版本，防止界面与服务端 API 不匹配）
  - 更新对象：运行时 `node_modules/@deepseek-ai/dsh-web-frontend/dist`（dsh web 经 `require.resolve` 服务该目录），替换后重启 dsh web 服务并刷新窗口
  - 实现方式：新增纯 Node 模块 `app/webui-update.js`（registry 检查 / tarball 下载 / tar 解压校验 / 原子替换），主进程新增 `hdsh:webui-check / webui-download / webui-install` IPC 与 `hdsh:webui-event` 事件，preload 扩展 `window.hdsh`（webuiCheck / webuiDownload / webuiInstall / onWebuiEvent）；客户端插件 WebUI 组升级为完整状态机（检查 → 下载进度 → 应用 → 完成）
- 修复 dev 模式路径：`runtimeDir / DSH_HOME / USER_DATA` 的开发分支统一指向 `package-app/` 下（此前多一层目录导致 dev 启动找不到内置运行时、junction 建错位置）
- 源码工程 `package-app/` 同步更新：builder `files` 白名单新增 `webui-update.js`，插件与 app 版本升至 1.3.0

---

# WhaleBox 1.2.0

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.2.0 更新（2026-08-24）

- **一键自动更新**：设置 → 通用设置 → 检查框架更新，发现新版本后点击「立即更新」，应用自动下载（转圈 + 进度条 + 提示文字反馈）、安装并重启，全程无需手动前往官网下载安装包
  - 基于 electron-updater（GitHub Releases 发布源，latest.yml 差分更新），未签名场景已处理 SmartScreen/MOTW
  - 下载进度实时展示（百分比 + 进度条），安装阶段提示「应用将自动重启」
- **WebUI 检测**：保留官方仓库（deepseek-ai/deepseek-harness）版本检测与发布页入口；WebUI 组件随框架安装包分发，随框架更新一并升级
- **实现方式**：主进程集成 autoUpdater（check/download/install IPC + 事件转发），preload 扩展 `window.hdsh`（checkUpdate / downloadUpdate / installUpdate / onUpdateEvent）；客户端插件 `dsh-update-check` 升级为事件驱动的状态机 UI
- 源码工程 `package-app/` 同步更新：app 依赖新增 electron-updater，builder 配置新增 `publish: github`（构建生成 latest.yml + blockmap）

---

# WhaleBox 1.1.0

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.1.0 更新（2026-08-24）

- **内置更新检测**：设置 → 通用设置 新增「更新检测」栏目，两个独立按钮分别检测 WebUI（官方 deepseek-ai/deepseek-harness 仓库）与本框架（FeatherCloudSky/WhaleBox 仓库）的新版本；发现新版本时会询问是否立即更新
  - WebUI 更新：打开官方仓库标签页查看最新版本（WebUI 组件随框架安装包分发）
  - 框架更新：自动下载最新安装包到「下载」文件夹并打开，关闭应用后运行安装程序即可升级
  - 版本来源：WebUI 取官方 GitHub `dsh-v*` 标签（备用 npm `next` 标记）；框架取 WhaleBox Releases
- **实现方式**：Electron 主进程新增 `hdsh` IPC（当前版本读取 / 安装包下载 / 打开链接），preload 经 contextBridge 暴露为 `window.hdsh`；更新检测 UI 为随包客户端插件（`dsh-update-check`），经 `dsh web --patch` 组合覆盖挂入设置页
- 源码工程 `package-app/` 同步更新：新增 `runtime-addons/dsh-update-check`（更新检测包）与 `app/hdsh-update-check.patch.yml`（组合覆盖）

---

# WhaleBox 1.0.3

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.0.3 更新（2026-08-24）

- **鲸鱼 logo 替换**：启动画面与窗口标题栏品牌 logo 改为 DeepSeek 鲸鱼真实图标（`deepseek-512.png`）
- **启动画面动态提示**：加载过程循环播放多条小贴士，带 0.6 秒渐显渐隐过渡动画

---

# WhaleBox 1.0.2

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.0.2 更新（2026-08-23）

- **大幅优化启动速度**：就绪探测由 PowerShell 改为原生 HTTP（每次探测从 1~3 秒降到毫秒级），轮询加密；窗口先行显示内嵌启动画面，服务后台拉起、就绪即切入主界面，消除点击图标后的长时间空窗
- **修复圆角下部不透明**：关闭 Windows 11 系统圆角（`roundedCorners: false`），避免系统小半径裁切与界面 28px 外框圆角嵌套出第二道弧线、露出不透明底色残边

---

# WhaleBox 1.0.1

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 1.0.1 更新（2026-08-22）

- **修复安装器崩溃**：在 Windows 11 24H2 及更新版本上，全新安装时安装器可能在启动瞬间崩溃（事件查看器显示 `System.dll` 模块 `0xc0000005` 崩溃、窗口不出现）。根因是 electron-builder ≤26.8 的 NSIS 模板存在越界读缺陷，本次升级 electron-builder 至 26.15.3（上游已在 26.9.0 修复）。受影响的用户请改用本版本安装包
- **修复 VC++ 运行库检查误报**：安装器为 32 位进程，此前读取 64 位注册表视图会被重定向导致漏检/误报，现已切换到 64 位视图
- 静默安装（`/S`）模式下不再尝试弹窗，改为日志输出
- 源码工程 `package-app/` 随仓库发布，支持从源码自行构建

---

# WhaleBox 1.0.0

> 非官方 Windows 一键安装包：将 DeepSeek Harness（dsh）WebUI 封装为独立桌面应用，内置完整 Node.js 与 dsh 运行时，无需任何前置环境，双击即用。

## 特性

- **一键安装**：NSIS 安装向导，自动创建桌面快捷方式与开始菜单项
- **无边框玻璃窗口**：顶部品牌胶囊（含「非官方」标识）+ 悬浮窗口控制按钮组，明暗自适应
- **零依赖**：内置 Node.js 与 dsh 运行时，无需预装任何环境
- **数据保留**：卸载不删除用户数据（会话、配置、插件）
- **关窗即停**：关闭窗口自动停止后台服务，无残留进程

## 本次发布说明

- 应用界面与文档均已标注「**非官方社区版**」，与 DeepSeek 官方无隶属、赞助或背书关系
- **隐私修复**：移除代码中硬编码的用户名与本机路径，旧数据迁移改为按当前用户目录自动解析
- 移除本地开发环境残留的审批通知钩子，恢复官方 dsh 运行时原样
- 清理打包残留文件（损坏的图标备份等）
- 作者署名：FeatherCloudSky

## 构建声明

本项目（Electron 外壳、构建配置、安装打包流程）由 **DeepSeek**（AI 编码助手）构建完成。内置运行时 `@deepseek-ai/dsh` 为 DeepSeek 官方开源组件（MIT License，随包保留其 LICENSE 文件）。

## 注意事项

- 安装包**未做代码签名**，Windows SmartScreen 提示时请选择「更多信息 → 仍要运行」；个别杀毒软件可能误报，属未签名程序的常见现象
- 首次使用需联网（AI 服务调用）
- 系统要求：Windows 10 / 11（x64）
- 服务端口固定为 `127.0.0.1:8898`

## 许可证

本项目采用 MIT License。内置第三方组件遵循各自许可证（Electron、dsh 等均为 MIT 系许可）。
