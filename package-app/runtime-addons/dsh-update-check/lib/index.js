// HDSH 内置更新检测 — 宿主半边(空插件)
// 所有特权逻辑(版本读取/安装包下载/打开链接)位于 Electron 主进程,
// 经 preload contextBridge 暴露为 window.hdsh;浏览器半边见
// package.json 的 dsh.client 声明(lib/client.js)。
export function apply() {}
