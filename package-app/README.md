# HelloDeepseekHarness 源码工程

Electron 壳 + electron-builder 打包配置。内置运行时（Node.js + dsh）体积较大且为第三方二进制，**不入库**，按下方说明自行准备。

## 目录结构

```
package-app/
├── app/                      Electron 壳源码（main.js / preload.js / assets）
├── builder/                  electron-builder 配置与构建脚本
│   ├── electron-builder.config.js
│   ├── afterPack-icon.js     构建后注入鲸鱼图标（rcedit）
│   ├── build.bat             一键构建脚本
│   └── nsis/custom.nsh       自定义 NSIS 脚本（OS / VC++ 运行库检查）
├── runtime-addons/           随包客户端插件源码（dsh-update-check 等，需装入内置运行时）
├── runtime-staging/          内置运行时（不入库，见下文准备方法），打包为 resources/runtime
└── smoke-service.js          冒烟测试：验证 staged 运行时可启动 8898 服务
```

## 准备内置运行时（runtime-staging）

```bat
mkdir runtime-staging\node
mkdir runtime-staging\dsh

rem 1) Node.js v22 win-x64：将 node.exe 放入 runtime-staging\node\
rem    （从 https://nodejs.org 的 zip 发行版中提取即可）

rem 2) dsh CLI：
cd runtime-staging\dsh
npm install @deepseek-ai/dsh@0.1.0-rc.7

rem 3) 内置更新检测客户端包（随包插件，见 runtime-addons/）：
rem    dsh-update-check 需装入运行时 node_modules，使 dsh web --patch
rem    挂载的组合行可被解析：
mkdir runtime-staging\dsh\node_modules\dsh-update-check
copy runtime-addons\dsh-update-check\* runtime-staging\dsh\node_modules\dsh-update-check\
xcopy /E /I runtime-addons\dsh-update-check\lib runtime-staging\dsh\node_modules\dsh-update-check\lib
```

完成后目录应包含 `runtime-staging\node\node.exe` 与 `runtime-staging\dsh\lib\bin.js`。
可用冒烟脚本验证：`node smoke-service.js`（预期输出 `SERVICE UP`）。

## 构建

环境要求：Node.js 18+、npm。

```bat
cd builder
npm install
build.bat
```

说明：

- 构建产物输出到 `builder/dist/`（安装包 + win-unpacked）；
- `electron-builder.config.js` 中 `electronDist` 通过环境变量 `ELECTRON_DIST` 指定本地 Electron 目录（避免重新下载），不设置时自动联网下载；
- 网络受限时可通过环境变量 `ELECTRON_BUILDER_BINARIES_MIRROR` 指定 winCodeSign 等二进制下载镜像（如 `https://npmmirror.com/mirrors/electron-builder-binaries/`）、`ELECTRON_MIRROR` 指定 Electron 下载镜像；
- 本项目**不做代码签名**（无证书）；如遇 SmartScreen 提示属正常现象。

## 版本记录

- **1.4.0**：统一更新检测 + 框架更新提速。主进程新增 `hdsh:check-all` / `hdsh:update-all-run` IPC 与 `hdsh:update-all-event` 事件：一次检查框架（electron-updater）与 WebUI（npm），分行返回版本号；一键更新按序执行「修复 WebUI（如与前端不匹配）→ 多连接加速下载框架安装包 → SHA-512 校验 → 退出应用静默安装（`/S --updated`）」；`webui-update.js` 新增 `downloadFileParallel`（6 线程 Range 分块下载，不支持 Range 自动退化单流，`minChunkSize` 可配）；加速通道失败自动回退 electron-updater 标准通道（事件仍走 `hdsh:updater-event`）；客户端插件重构为单一「更新检测」组件（框架/WebUI 分行显示、一键更新、统一进度状态机）。
- **1.3.1**：修复 WebUI 单独更新的跨版本不兼容。实测确认前端必须与服务端（`dsh-web-app`）完全同版本（rc.7 服务端搭配 rc.8/0.1.1-rc.2 前端均报 `window.__ModuleLoader__ bootstrap facade is missing` 打不开）；`checkLatest` 新增 `compatibleLatest`（与 serverVersion 完全同版本的前端）与 `officialLatest`（官方最新线），main.js `webui-check` 返回配套判断、`webui-download` 严格校验 `version === serverVersion`；新增安装前备份（`webui-update/backup/<版本>/`）与启动自检 `ensureWebuiCompatible()`（前端与服务端不匹配时从备份复制恢复，保留备份）。
- **1.3.0**：WebUI 单独更新（设置 → 通用设置 → 检查 WebUI 更新 → 立即更新）：新增纯 Node 模块 `app/webui-update.js`（npm registry 检查 `@deepseek-ai/dsh-web-frontend` / tarball 下载 / tar 解压校验 / 原子替换运行时 dist），主进程新增 `hdsh:webui-check / webui-download / webui-install` IPC 与 `hdsh:webui-event` 事件，preload 扩展 `window.hdsh`（webuiCheck / webuiDownload / webuiInstall / onWebuiEvent）；客户端插件 WebUI 组升级为完整状态机（下载进度 → 应用 → 重启服务生效）；builder `files` 白名单新增 `webui-update.js`；修复 dev 模式 `runtimeDir / DSH_HOME / USER_DATA` 路径（统一指向 `package-app/` 下）。
- **1.2.0**：一键自动更新。主进程集成 electron-updater（check/download/install IPC + 事件转发），preload 扩展 `window.hdsh`（checkUpdate / downloadUpdate / installUpdate / onUpdateEvent）；客户端插件 `dsh-update-check` 升级为事件驱动的状态机 UI（转圈 + 进度条 + 提示）；app 依赖新增 electron-updater；builder 配置新增 `publish: github`（构建生成 latest.yml + blockmap，发布时需随安装包一并上传）。
- **1.1.0**：内置更新检测（设置 → 通用设置）：WebUI 与框架版本检查、发现新版本询问是否更新、框架更新自动下载安装包。Electron 主进程新增 `hdsh` IPC + preload contextBridge（`window.hdsh`）；更新检测 UI 为随包客户端插件 `runtime-addons/dsh-update-check`，经 `dsh web --patch`（`app/hdsh-update-check.patch.yml`）挂载；主进程启动时在 profile 回退 `node_modules` 建立该包的 junction。
- **1.0.1**：electron-builder 升级至 26.15.3，修复 Windows 11 24H2+ 全新安装时 NSIS 安装器在 System.dll 崩溃的问题（上游 multiUser.nsh 越界读，已在 26.9.0 修复）；custom.nsh 增加 64 位注册表视图修正与静默模式适配。
- **1.0.0**：首发。
