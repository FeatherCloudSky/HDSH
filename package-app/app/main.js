// HelloDeepseekHarness 独立 App — 主进程
// 职责:内置 node 拉起 dsh web 服务(端口 8898)、用户数据目录管理、
//       无边框玻璃窗口、窗口控制 IPC、单实例防重复、关窗即停服。
// 启动策略:窗口先行(内嵌启动画面),服务后台拉起,就绪即换真实界面。
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { spawn, spawnSync } = require('child_process');

const APP_NAME = 'HelloDeepseekHarness';
app.setName(APP_NAME);
app.setAppUserModelId('HelloDeepseekHarness');

// 端口可配置(测试用;正式固定 8898)
const PORT = Number(process.env.DSH_PORT || 8898);
const WEB_URL = `http://127.0.0.1:${PORT}`;

// ================= 内嵌启动画面 =================
// 窗口先于服务就绪显示,消除"点了图标没反应"的空窗期。
// 透明底 + 居中圆角卡片,与主界面悬浮窗形态一致。
// 鲸鱼 logo 运行时读入并内嵌为 data URI(启动画面是 data URL,无法引用相对路径)
const LOGO_URI = 'data:image/png;base64,' +
  fs.readFileSync(path.join(__dirname, 'assets', 'deepseek-512.png')).toString('base64');
const SPLASH_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font-family:'Segoe UI Variable','Segoe UI',system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center}
.card{display:flex;flex-direction:column;align-items:center;gap:16px;padding:44px 60px;border-radius:24px;
background:rgba(245,242,234,.92);border:1px solid rgba(160,150,130,.35);box-shadow:0 20px 60px rgba(0,0,0,.18)}
.logo{width:44px;height:44px;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(77,107,254,.35)}
.logo img{width:100%;height:100%;display:block}
.t{font-size:14px;font-weight:600;color:#262c3e;letter-spacing:.3px}
.tip{font-size:12px;color:#7a8095;margin:-6px 0 0;min-height:1.4em;transition:opacity .6s ease}
.tip.hide{opacity:0}
.bar{width:180px;height:4px;border-radius:99px;background:rgba(38,44,62,.10);overflow:hidden}
.bar i{display:block;height:100%;width:40%;border-radius:99px;background:#4D6BFE;animation:s 1.1s ease-in-out infinite}
@keyframes s{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
.err .tip{color:#b3403a}.err .bar i{animation:none;width:100%;background:#c25650}
</style></head><body><div class="card"><div class="logo"><img src="${LOGO_URI}" alt=""></div>
<div class="t">HelloDeepseekHarness</div><div class="tip hide" id="tip">正在初始化…</div>
<div class="bar"><i></i></div></div>
<script>
var tips=['正在初始化…','正在拉起本地运行时…','正在唤醒 DeepSeek Harness…','正在准备工具链…','正在连接本地服务…','稍等片刻，即将就绪…','正在加载界面…'];
var i=0,el=document.getElementById('tip');
el.classList.remove('hide');
var iv=setInterval(function(){
  el.classList.add('hide');
  setTimeout(function(){
    i=(i+1)%tips.length;
    el.textContent=tips[i];
    el.classList.remove('hide');
  },600);
},3200);
</script>
</body></html>`;
const SPLASH_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML);

function showSplashError(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    `document.querySelector('.card').classList.add('err');
     document.getElementById('tip').textContent = '服务启动失败,请重启应用';
     document.getElementById('tip').classList.remove('hide');`
  ).catch(() => {});
}

// ================= 路径解析 =================
// 开发模式:resources 在项目下 runtime-staging/;打包后:process.resourcesPath
function runtimeDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'runtime');
  return path.join(__dirname, '..', '..', 'runtime-staging');
}
const NODE_EXE = () => path.join(runtimeDir(), 'node', 'node.exe');
const DSH_BIN = () => path.join(runtimeDir(), 'dsh', 'lib', 'bin.js');

// ================= 内置更新检测 =================
// --patch 覆盖文件:向 dsh 组合追加本应用内置的更新检测插件行(dsh-update-check)。
// 打包后该文件经 electron-builder extraResources 落到 resources/(真实文件),
// 因为 dsh 服务由纯 node.exe 拉起、无法读取 app.asar 内部文件。
const HDSH_PATCH_FILE = () => app.isPackaged
  ? path.join(process.resourcesPath, 'hdsh-update-check.patch.yml')
  : path.join(__dirname, 'hdsh-update-check.patch.yml');

// 框架版本:应用自身 package.json(打包后为 app.asar/package.json)
function frameworkVersion() {
  try { return require('./package.json').version; } catch (_) { return null; }
}
// WebUI 版本:内置运行时中官方 @deepseek-ai/dsh-web-app 的版本
function webuiVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(runtimeDir(), 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'package.json'), 'utf8'));
    return (pkg && pkg.version) || null;
  } catch (_) { return null; }
}
// 下载框架安装包到「下载」文件夹并打开该文件夹(PowerShell 下载,自动跟随重定向)
// 确保 dsh-update-check 包在 profile 回退 node_modules 中可见
// (web profile 的模块解析路径为 profiles/web → profiles/node_modules,
//  dsh 在此维护指向运行时 node_modules 的 junction 回退;首次启动建链,
//  失败时退化为复制)
function ensureUpdateCheckInProfile() {
  try {
    const src = path.join(runtimeDir(), 'dsh', 'node_modules', 'dsh-update-check');
    if (!fs.existsSync(src)) return;
    const nm = path.join(DSH_HOME(), 'profiles', 'node_modules');
    const link = path.join(nm, 'dsh-update-check');
    if (fs.existsSync(link)) return;
    fs.mkdirSync(nm, { recursive: true });
    try {
      fs.symlinkSync(src, link, 'junction');
    } catch (_) {
      try { fs.cpSync(src, link, { recursive: true }); } catch (__) {}
    }
  } catch (_) {}
}

// 下载框架安装包到「下载」文件夹并打开该文件夹(PowerShell 下载,自动跟随重定向)
function downloadFramework(url, fileName) {
  return new Promise((resolve) => {
    if (!url || !/^https?:/i.test(String(url))) return resolve({ ok: false, message: '缺少安装包下载地址' });
    const safe = String(fileName || 'HelloDeepseekHarness-Setup.exe').replace(/[^0-9A-Za-z.\-() ]/g, '');
    const script = "$ProgressPreference='SilentlyContinue'; "
      + "$dl=Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'; "
      + 'if(-not(Test-Path $dl)){New-Item -ItemType Directory -Force -Path $dl|Out-Null}; '
      + "$u='" + String(url).replace(/'/g, "''") + "'; "
      + "$f=Join-Path $dl '" + safe + "'; "
      + 'Invoke-WebRequest -Uri $u -OutFile $f -UseBasicParsing -TimeoutSec 300';
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' });
    proc.on('error', (e) => resolve({ ok: false, message: '启动 PowerShell 失败: ' + e.message }));
    proc.on('exit', (code) => {
      if (code !== 0) return resolve({ ok: false, message: '下载失败(退出码 ' + code + ')' });
      try {
        spawn('explorer.exe', [path.join(os.homedir(), 'Downloads')], { windowsHide: true, stdio: 'ignore' });
      } catch (_) {}
      resolve({ ok: true, message: '安装包已下载到「下载」文件夹(' + safe + ')并已打开。请关闭应用后运行安装程序完成升级。' });
    });
  });
}

// 用户数据目录(会话/设置/插件),独立于安装目录 → 覆盖安装/卸载都不丢
// 开发模式:项目下 dev-data/ 便于测试;打包后:%APPDATA%\HelloDeepseekHarness\dsh-home
const DSH_HOME = () => {
  if (!app.isPackaged) return path.join(__dirname, '..', '..', 'dev-data', 'dsh-home');
  return path.join(app.getPath('appData'), 'HelloDeepseekHarness', 'dsh-home');
};

// userData 重定向(Chromium 缓存/会话等)
const udArg = process.argv.find(a => a.startsWith('--userdata-dir='));
const USER_DATA = udArg ? udArg.slice(15) : (app.isPackaged
  ? path.join(app.getPath('appData'), 'HelloDeepseekHarness', 'user-data')
  : path.join(__dirname, '..', '..', 'dev-data', 'user-data'));
try { app.setPath('userData', USER_DATA); } catch (_) {}

// ================= 服务生命周期 =================
// 就绪探测用原生 http(回环地址毫秒级返回);此前用 PowerShell 探测,
// 每次拉起 powershell.exe 要 1~3 秒,是启动慢的最大元凶。
let serviceProc = null;
let serviceStarting = false;

function probeService(timeoutMs = 1000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/', timeout: timeoutMs }, (res) => {
      res.resume();
      finish(true);
    });
    req.on('timeout', () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startService() {
  if (await probeService()) { console.log('[svc] already up'); return true; }
  if (serviceStarting) return false;
  serviceStarting = true;

  const nodeExe = NODE_EXE();
  const dshBin = DSH_BIN();
  if (!fs.existsSync(nodeExe) || !fs.existsSync(dshBin)) {
    console.error('[svc] runtime missing: node=' + nodeExe + ' dsh=' + dshBin);
    serviceStarting = false;
    return false;
  }

  // 确保 DSH_HOME 存在
  const home = DSH_HOME();
  try { fs.mkdirSync(home, { recursive: true }); } catch (_) {}

  // 内置更新检测:在 profile 回退 node_modules 建立包链接
  ensureUpdateCheckInProfile();

  console.log('[svc] starting: ' + nodeExe + ' ' + dshBin + ' web --port ' + PORT);
  const env = { ...process.env, DSH_HOME: home, DSH_WEB_URL: WEB_URL };
  // Windows 下隐藏窗口跑服务(无任何命令行窗口闪现)
  const opts = { env, stdio: 'ignore', windowsHide: true, detached: false };
  // 追加 --patch 覆盖:内置更新检测插件行(文件缺失时跳过,兼容纯官方运行时)。
  // 注意 --patch 必须放在 --port 之前:web 子命令的 passThroughOptions 会让
  // 位置参数之后的选项透传给 web 应用解析(--port 由 web 应用解析,先出现会
  // 把 8898 当作位置参数,导致其后的 --patch 被透传而报 unknown option)。
  const svcArgs = [dshBin, 'web'];
  if (fs.existsSync(HDSH_PATCH_FILE())) svcArgs.push('--patch', HDSH_PATCH_FILE());
  svcArgs.push('--port', String(PORT));
  try {
    serviceProc = spawn(nodeExe, svcArgs, opts);
  } catch (e) {
    console.error('[svc] spawn failed: ' + e.message);
    serviceStarting = false;
    return false;
  }
  serviceProc.on('error', (e) => { console.error('[svc] error: ' + e.message); });
  serviceProc.on('exit', (code) => {
    console.log('[svc] exited code=' + code);
    serviceProc = null;
  });

  // 等待服务就绪(最长 30s;原生探测很便宜,150ms 高频轮询,就绪即刻返回)
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    await sleep(150);
    if (await probeService(800)) { serviceStarting = false; console.log('[svc] ready'); return true; }
  }
  serviceStarting = false;
  console.error('[svc] timeout');
  return false;
}

function stopService() {
  if (serviceProc && !serviceProc.killed) {
    try { serviceProc.kill(); } catch (_) {}
    // Windows 下确保子进程树也被清理(worker 等)
    try {
      spawnSync('taskkill', ['/pid', String(serviceProc.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch (_) {}
    serviceProc = null;
  }
}

// ================= 首次启动:迁移现有用户数据 =================
const MIGRATED_FLAG = 'migrated-from';
// 旧版启动器的数据位置:按当前用户主目录动态解析,不硬编码任何机器路径
const LEGACY_HOME = path.join(os.homedir(), '.dsh');

function migrateLegacyData() {
  const home = DSH_HOME();
  try { fs.mkdirSync(home, { recursive: true }); } catch (_) {}
  const flagPath = path.join(home, MIGRATED_FLAG);
  if (fs.existsSync(flagPath)) return; // 已迁移过

  if (!fs.existsSync(LEGACY_HOME)) {
    try { fs.writeFileSync(flagPath, 'none'); } catch (_) {}
    return;
  }

  console.log('[migrate] copying legacy data from ' + LEGACY_HOME + ' -> ' + home);
  try {
    const cp = spawnSync('robocopy', [LEGACY_HOME, home, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS'], { stdio: 'ignore', timeout: 120000 });
    console.log('[migrate] robocopy exit=' + cp.status);
    // robocopy 0-7 都是成功(1=复制了文件);>=8 才是失败
    if (cp.status !== void 0 && cp.status < 8) {
      fs.writeFileSync(flagPath, LEGACY_HOME);
      console.log('[migrate] done');
    }
  } catch (e) { console.error('[migrate] failed: ' + e.message); }
}

// ================= 单实例锁 =================
const isDevInstance = process.argv.includes('--dev');
const gotLock = isDevInstance ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  const shotArg = process.argv.find(a => a.startsWith('--screenshot='));
  const SHOT_PATH = shotArg ? shotArg.slice(13) : null;
  let mainWindow = null;

  function createWindow() {
    const { workArea } = screen.getPrimaryDisplay();
    let w = 1600, h = 900;
    if (workArea.width < w + 80) w = workArea.width - 80;
    if (workArea.height < h + 80) h = workArea.height - 80;
    w = Math.max(w, 640); h = Math.max(h, 480);
    const x = Math.round((workArea.width - w) / 2 + workArea.x);
    const y = Math.round((workArea.height - h) / 2 + workArea.y);

    mainWindow = new BrowserWindow({
      width: w, height: h, x, y,
      frame: false,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      roundedCorners: false, // 关闭 Win11 系统圆角:系统 ~8px 裁切与 CSS 28px 外框圆角
                             // 嵌套出第二道弧线,导致圆角下部露出不透明的底色残边
      icon: path.join(__dirname, 'assets', 'deepseek.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.setAutoHideMenuBar(true);

    // F11 切换真全屏
    mainWindow.webContents.on('before-input-event', (_e, input) => {
      if (input.type === 'keyDown' && input.key === 'F11') {
        _e.preventDefault();
        if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
        else mainWindow.setFullScreen(true);
      }
    });

    // 冷启动失败自动重载一次(仅针对主界面;启动画面是 data URL 不会失败)
    let failCount = 0;
    mainWindow.webContents.on('did-fail-load', (_e, code, _desc, url) => {
      if (!String(url || '').startsWith(WEB_URL) || code === -3 || failCount >= 3) return;
      failCount++;
      setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); }, 1200);
    });

    // 窗口状态同步(最大化/全屏)
    const sendState = (fullscreenOverride) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window-state', {
          maximized: mainWindow.isMaximized(),
          fullscreen: fullscreenOverride !== void 0 ? fullscreenOverride : mainWindow.isFullScreen()
        });
      }
    };
    mainWindow.on('maximize', () => sendState());
    mainWindow.on('unmaximize', () => sendState());
    mainWindow.on('enter-full-screen', () => sendState(true));
    mainWindow.on('leave-full-screen', () => sendState(false));
    mainWindow.once('ready-to-show', () => mainWindow.show());

    mainWindow.webContents.on('did-finish-load', () => {
      sendState();
      // 截图模式只认主界面(忽略启动画面的 finish-load)
      const url = (mainWindow.webContents.getURL() || '');
      if (!url.startsWith(WEB_URL)) return;
      if (SHOT_PATH) {
        setTimeout(async () => {
          try {
            const img = await mainWindow.webContents.capturePage();
            fs.writeFileSync(SHOT_PATH, img.toPNG());
            console.log('[shot] saved ' + SHOT_PATH);
          } catch (e) { console.log('[shot] failed: ' + e.message); }
          app.quit();
        }, 3000);
      }
    });

    // 先加载启动画面(毫秒级),服务就绪后再换真实界面
    mainWindow.loadURL(SPLASH_URL);
    return mainWindow;
  }

  // ---- 窗口控制 IPC ----
  ipcMain.on('win:minimize', () => { if (mainWindow) mainWindow.minimize(); });
  ipcMain.on('win:maximize-toggle', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('win:close', () => { if (mainWindow) mainWindow.close(); });

  // ---- 内置更新检测 IPC(preload 经 contextBridge 暴露为 window.hdsh) ----
  ipcMain.handle('hdsh:get-versions', () => ({ framework: frameworkVersion(), webui: webuiVersion() }));
  ipcMain.handle('hdsh:download-framework', (_e, payload) =>
    downloadFramework(payload && payload.url, payload && payload.fileName));
  ipcMain.handle('hdsh:open-url', async (_e, url) => {
    if (!url || !/^https?:/i.test(String(url))) return { ok: false, message: '非法链接' };
    try {
      await shell.openExternal(String(url));
      return { ok: true };
    } catch (e) {
      return { ok: false, message: String((e && e.message) || e) };
    }
  });

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 1. 迁移旧数据(仅首次;之后只是两次存在性检查,不阻塞)
    migrateLegacyData();
    // 2. 先开窗口(显示启动画面),不等服务
    createWindow();
    // 3. 后台拉起服务,就绪即换真实界面
    (async () => {
      let ok = await startService();
      if (!ok && !app.isQuitting) ok = await startService(); // 重试一次,兜住慢冷启动
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (ok) mainWindow.loadURL(WEB_URL);
      else showSplashError(mainWindow);
    })();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  // 关窗即停服(服务与界面同生共死)
  app.on('window-all-closed', () => {
    stopService();
    app.quit();
  });

  app.on('before-quit', () => { app.isQuitting = true; stopService(); });
}
