// HelloDeepseekHarness 独立 App — 主进程
// 职责:内置 node 拉起 dsh web 服务(端口 8898)、用户数据目录管理、
//       无边框玻璃窗口、窗口控制 IPC、单实例防重复、关窗即停服。
// 启动策略:窗口先行(内嵌启动画面),服务后台拉起,就绪即换真实界面。
const { app, BrowserWindow, ipcMain, screen } = require('electron');
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
const SPLASH_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:transparent;font-family:'Segoe UI Variable','Segoe UI',system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center}
.card{display:flex;flex-direction:column;align-items:center;gap:16px;padding:44px 60px;border-radius:24px;
background:rgba(245,242,234,.92);border:1px solid rgba(160,150,130,.35);box-shadow:0 20px 60px rgba(0,0,0,.18)}
.logo{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6D8BFF,#4D6BFE 60%,#3B56D9);
box-shadow:inset 0 1px 0 rgba(255,255,255,.45),0 2px 8px rgba(77,107,254,.45);position:relative}
.logo::after{content:'';position:absolute;left:50%;top:50%;width:17px;height:10px;border-radius:50% 50% 45% 45%;
background:#fff;transform:translate(-50%,calc(-50% - 1px))}
.t{font-size:14px;font-weight:600;color:#262c3e;letter-spacing:.3px}
.m{font-size:12px;color:#7a8095;margin:-6px 0 0}
.bar{width:180px;height:4px;border-radius:99px;background:rgba(38,44,62,.10);overflow:hidden}
.bar i{display:block;height:100%;width:40%;border-radius:99px;background:#4D6BFE;animation:s 1.1s ease-in-out infinite}
@keyframes s{0%{transform:translateX(-110%)}100%{transform:translateX(320%)}}
.err .m{color:#b3403a}.err .bar i{animation:none;width:100%;background:#c25650}
</style></head><body><div class="card"><div class="logo"></div>
<div class="t">HelloDeepseekHarness</div><div class="m" id="msg">正在启动本地服务…</div>
<div class="bar"><i></i></div></div></body></html>`;
const SPLASH_URL = 'data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML);

function showSplashError(win) {
  if (!win || win.isDestroyed()) return;
  win.webContents.executeJavaScript(
    `document.querySelector('.card').classList.add('err');
     document.getElementById('msg').textContent = '服务启动失败,请重启应用';`
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

  console.log('[svc] starting: ' + nodeExe + ' ' + dshBin + ' web --port ' + PORT);
  const env = { ...process.env, DSH_HOME: home, DSH_WEB_URL: WEB_URL };
  // Windows 下隐藏窗口跑服务(无任何命令行窗口闪现)
  const opts = { env, stdio: 'ignore', windowsHide: true, detached: false };
  try {
    serviceProc = spawn(nodeExe, [dshBin, 'web', '--port', String(PORT)], opts);
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
