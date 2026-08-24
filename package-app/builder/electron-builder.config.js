// electron-builder config — HelloDeepseekHarness 1.0.0
const path = require('path');

// 本地 Electron 目录(避免重新下载)。发布源码时请勿硬编码本机路径:
// 通过环境变量 ELECTRON_DIST 指定,或留空让 electron-builder 自动下载。
const electronDist = process.env.ELECTRON_DIST || undefined;

module.exports = {
  appId: 'io.github.feathercloudsky.hdsh',
  productName: 'HelloDeepseekHarness',
  copyright: 'Copyright (c) 2026 FeatherCloudSky',
  afterPack: path.join(__dirname, 'afterPack-icon.js'),
  directories: {
    output: 'dist',
    buildResources: 'build',
    app: path.join(__dirname, '..', 'app')
  },
  // app dir files
  files: [
    'main.js',
    'preload.js',
    'assets/**/*',
    'package.json'
  ],
  // bundled runtime (no node install needed): runtime-staging -> resources/runtime
  // NOTE: from 必须指向 runtime-staging 根目录,而非 dsh。
  // electron-builder 的 createFilter 会排除“相对于 from 的根级 node_modules”,
  // 若 from=dsh 则其 node_modules 是根级、被整个丢弃;from 指向父目录后,
  // dsh/node_modules 成为子目录,可被完整复制。产物布局仍为 runtime/{node,dsh}。
  extraResources: [
    {
      from: path.join(__dirname, '..', 'runtime-staging'),
      to: 'runtime',
      filter: ['**/*']
    }
  ],
  // reuse local Electron binary to avoid re-download (see electronDist above)
  electronDist,
  electronVersion: '43.4.1',
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ],
    icon: path.join(__dirname, '..', 'app', 'assets', 'deepseek.ico'),
    executableName: 'HelloDeepseekHarness'
    // NOTE: signAndEditExecutable must stay enabled (default) so the whale
    // icon gets injected into the exe; winCodeSign comes from npmmirror
    // (see ELECTRON_BUILDER_BINARIES_MIRROR in build.bat)
  },
  nsis: {
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'HelloDeepseekHarness',
    uninstallDisplayName: 'HelloDeepseekHarness',
    language: 2052,
    artifactName: 'HelloDeepseekHarness-Setup-${version}.${ext}',
    deleteAppDataOnUninstall: false,
    runAfterFinish: true,
    installerIcon: path.join(__dirname, '..', 'app', 'assets', 'deepseek.ico'),
    uninstallerIcon: path.join(__dirname, '..', 'app', 'assets', 'deepseek.ico'),
    // VC++ runtime check (custom NSIS script)
    include: path.join(__dirname, 'nsis', 'custom.nsh')
  }
};
