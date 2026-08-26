// WhaleBox 鲸盒 独立 App — 主进程
// 职责:内置 node 拉起 dsh web 服务(端口 8898)、用户数据目录管理、
//       无边框玻璃窗口、窗口控制 IPC、单实例防重复、关窗即停服。
// 启动策略:窗口先行(内嵌启动画面),服务后台拉起,就绪即换真实界面。
const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { autoUpdater } = require('electron-updater');
const webuiUpdate = require('./webui-update.js');

const APP_NAME = 'WhaleBox';
app.setName(APP_NAME);
app.setAppUserModelId('WhaleBox');

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
<div class="t">WhaleBox 鲸盒</div><div class="tip hide" id="tip">正在初始化…</div>
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
  return path.join(__dirname, '..', 'runtime-staging');
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
// WebUI 生效版本:内置运行时中官方 @deepseek-ai/dsh-web-frontend 的版本
// (单独更新会替换该包的 dist 并同步其 package.json,因此它反映真实生效版本)
function webuiVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(runtimeDir(), 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend', 'package.json'), 'utf8'));
    return (pkg && pkg.version) || null;
  } catch (_) { return null; }
}
// 服务端版本(@deepseek-ai/dsh-web-app):WebUI 前端必须与其完全同版本配套。
// 实证:服务端 0.1.0-rc.7 搭配前端 0.1.0-rc.8 / 0.1.1-rc.2 时界面报
// "window.__ModuleLoader__ bootstrap facade is missing" 打不开。
function serverVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(
      path.join(runtimeDir(), 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-app', 'package.json'), 'utf8'));
    return (pkg && pkg.version) || null;
  } catch (_) { return null; }
}
// WebUI 前端包目录(单独更新的替换目标)
function webuiPkgRoot() {
  return path.join(runtimeDir(), 'dsh', 'node_modules', '@deepseek-ai', 'dsh-web-frontend');
}
// WebUI 更新临时工作目录(用户数据区,可写;安装目录资源不可靠)
function webuiWorkDir() {
  return path.join(DSH_HOME(), 'webui-update');
}
// 框架更新安装包下载目录(userData 区,可写)
const UPDATES_DIR = () => path.join(USER_DATA, 'updates');
// WebUI 备份目录:每次安装前把当前 dist 备份到 <webuiWorkDir>/backup/<版本>/dist,
// 供启动自检在"前端版本与服务端不匹配"时恢复(防止坏更新后界面打不开)。
function webuiBackupDir() {
  return path.join(webuiWorkDir(), 'backup');
}
// 启动自检:前端版本必须与服务端完全同版本;不匹配(如装了跨线前端或文件被改坏)
// 时,优先从备份恢复同版本 dist;无备份则记录日志并交给界面提示(检查 WebUI 更新
// 会显示"恢复为框架内置版本")。此函数同步、快速,在服务拉起前调用。
function ensureWebuiCompatible() {
  try {
    const front = webuiVersion();
    const server = serverVersion();
    if (!front || !server) return;
    if (webuiUpdate.versionsEqual(front, server)) return;
    console.log('[webui] 版本不匹配 front=' + front + ' server=' + server + ',尝试恢复');
    const backup = path.join(webuiBackupDir(), server, 'dist');
    if (!fs.existsSync(backup) || !fs.existsSync(path.join(backup, 'index.html'))) {
      console.log('[webui] 无可用备份(' + backup + '),跳过自动恢复');
      return;
    }
    const dist = path.join(webuiPkgRoot(), 'dist');
    // 复制恢复(保留备份供下次使用):旧 dist 先改名,复制失败自动回滚
    const old = dist + '.bad-' + Date.now();
    let moved = false;
    try {
      if (fs.existsSync(dist)) { fs.renameSync(dist, old); moved = true; }
      fs.cpSync(backup, dist, { recursive: true });
      if (moved) fs.rmSync(old, { recursive: true, force: true });
    } catch (e) {
      try { if (moved && !fs.existsSync(dist)) fs.renameSync(old, dist); } catch (_) {}
      console.log('[webui] 恢复失败: ' + (e && e.message));
      return;
    }
    try {
      const pkgJson = path.join(webuiBackupDir(), server, 'package.json');
      if (fs.existsSync(pkgJson)) fs.copyFileSync(pkgJson, path.join(webuiPkgRoot(), 'package.json'));
    } catch (_) {}
    console.log('[webui] 已从备份恢复前端 ' + server);
  } catch (e) { console.log('[webui] 自检异常: ' + (e && e.message)); }
}
// 下载框架安装包到「下载」文件夹并打开该文件夹(PowerShell 下载,自动跟随重定向)
// 确保 dsh-update-check 包在 profile 回退 node_modules 中可见
// (web profile 的模块解析路径为 profiles/web → profiles/node_modules,
//  dsh 在此维护指向运行时 node_modules 的 junction 回退;首次启动建链,
//  失败时退化为复制)
function ensureUpdateCheckInProfile() {
  try {
    const src = path.join(runtimeDir(), 'dsh', 'node_modules', 'dsh-update-check');
    if (!fs.existsSync(src)) { console.log('[updchk] src missing: ' + src); return; }
    const nm = path.join(DSH_HOME(), 'profiles', 'node_modules');
    const link = path.join(nm, 'dsh-update-check');
    if (fs.existsSync(link)) { console.log('[updchk] link exists'); return; }
    fs.mkdirSync(nm, { recursive: true });
    try {
      fs.symlinkSync(src, link, 'junction');
      console.log('[updchk] junction created: ' + link);
    } catch (_) {
      try { fs.cpSync(src, link, { recursive: true }); console.log('[updchk] copied fallback'); } catch (__) { console.log('[updchk] copy failed'); }
    }
  } catch (e) { console.log('[updchk] failed: ' + (e && e.message)); }
}

// 下载框架安装包到「下载」文件夹并打开该文件夹(PowerShell 下载,自动跟随重定向)
function downloadFramework(url, fileName) {
  return new Promise((resolve) => {
    if (!url || !/^https?:/i.test(String(url))) return resolve({ ok: false, message: '缺少安装包下载地址' });
    const safe = String(fileName || 'WhaleBox-Setup.exe').replace(/[^0-9A-Za-z.\-() ]/g, '');
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
// 开发模式:项目下 dev-data/ 便于测试;打包后:%APPDATA%\WhaleBox\dsh-home
const DSH_HOME = () => {
  if (!app.isPackaged) return path.join(__dirname, '..', 'dev-data', 'dsh-home');
  return path.join(app.getPath('appData'), 'WhaleBox', 'dsh-home');
};

// userData 重定向(Chromium 缓存/会话等)
const udArg = process.argv.find(a => a.startsWith('--userdata-dir='));
const USER_DATA = udArg ? udArg.slice(15) : (app.isPackaged
  ? path.join(app.getPath('appData'), 'WhaleBox', 'user-data')
  : path.join(__dirname, '..', 'dev-data', 'user-data'));;
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

  // 启动自检:前端与服务端版本必须匹配,不匹配时从备份恢复(防止坏更新后界面打不开)
  ensureWebuiCompatible();
  // 内置更新检测:在 profile 回退 node_modules 建立包链接
  ensureUpdateCheckInProfile();

  console.log('[svc] starting: ' + nodeExe + ' ' + dshBin + ' web --no-open --port ' + PORT);
  const env = { ...process.env, DSH_HOME: home, DSH_WEB_URL: WEB_URL };
  // Windows 下隐藏窗口跑服务(无任何命令行窗口闪现)
  const opts = { env, stdio: 'ignore', windowsHide: true, detached: false };
  // 追加 --patch 覆盖:内置更新检测插件行(文件缺失时跳过,兼容纯官方运行时)。
  // 注意 --patch 必须放在 --no-open/--port 之前:web 子命令的 passThroughOptions
  // 会让位置参数之后的选项透传给 web 应用解析(--no-open/--port 由 web 应用解析,
  // 先出现会把 8898 当作位置参数,导致其后的 --patch 被透传而报 unknown option)。
  // --no-open:dsh web 默认会用系统默认浏览器打开 WebUI;本应用由玻璃窗口内嵌显示,
  // 不需要外开浏览器,故显式关闭(WebUI 仍在窗口内加载)。
  const svcArgs = [dshBin, 'web'];
  if (fs.existsSync(HDSH_PATCH_FILE())) svcArgs.push('--patch', HDSH_PATCH_FILE());
  svcArgs.push('--no-open', '--port', String(PORT));
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

// 旧品牌(HelloDeepseekHarness)用户数据目录:直接覆盖升级时,把旧数据整目录迁到新品牌目录
// (dsh-home 会话/配置 + user-data);复制保留旧目录作备份,迁移成功后打标记不再重复。
const OLD_APP_DATA = path.join(app.getPath('appData'), 'HelloDeepseekHarness');

function migrateOldAppData() {
  const root = path.join(app.getPath('appData'), 'WhaleBox');
  try { fs.mkdirSync(root, { recursive: true }); } catch (_) {}
  const flagPath = path.join(root, MIGRATED_FLAG + '-appdata');
  if (fs.existsSync(flagPath)) return; // 已迁移过
  if (!fs.existsSync(OLD_APP_DATA)) {
    try { fs.writeFileSync(flagPath, 'none'); } catch (_) {}
    return;
  }
  console.log('[migrate] copying old app data from ' + OLD_APP_DATA + ' -> ' + root);
  try {
    const cp = spawnSync('robocopy', [OLD_APP_DATA, root, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NC', '/NS'], { stdio: 'ignore', timeout: 180000 });
    console.log('[migrate] appdata robocopy exit=' + cp.status);
    // robocopy 0-7 都是成功;>=8 才是失败
    if (cp.status !== void 0 && cp.status < 8) {
      fs.writeFileSync(flagPath, OLD_APP_DATA);
      console.log('[migrate] appdata done');
    }
  } catch (e) { console.error('[migrate] appdata failed: ' + e.message); }
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

  // ---- 一键自动更新(electron-updater,发布源为 GitHub Releases 的 latest.yml) ----
  // 仅打包版可用;事件统一转发给渲染进程,由设置页 UI 展示转圈/提示/进度。
  autoUpdater.autoDownload = false;         // 用户点击「立即更新」后才下载
  autoUpdater.autoInstallOnAppQuit = false; // 更新由 UI 显式触发
  {
    const sendUpdateEvent = (type, data) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('hdsh:updater-event', Object.assign({ type }, data || {}));
      }
    };
    autoUpdater.on('checking-for-update', () => sendUpdateEvent('checking-for-update'));
    autoUpdater.on('update-available', (info) => sendUpdateEvent('update-available', { version: info && info.version }));
    autoUpdater.on('update-not-available', (info) => sendUpdateEvent('update-not-available', { version: info && info.version }));
    autoUpdater.on('download-progress', (p) => sendUpdateEvent('download-progress', {
      percent: Math.max(0, Math.min(100, Math.round((p && p.percent) || 0))),
      transferred: p && p.transferred,
      total: p && p.total,
      bytesPerSecond: p && p.bytesPerSecond
    }));
    autoUpdater.on('update-downloaded', (info) => sendUpdateEvent('update-downloaded', { version: info && info.version }));
    autoUpdater.on('error', (err) => sendUpdateEvent('error', { message: String((err && err.message) || err) }));

    ipcMain.handle('hdsh:updater-check', () => {
      if (!app.isPackaged) return sendUpdateEvent('error', { message: '自动更新仅在安装版中可用(开发模式跳过)' });
      return autoUpdater.checkForUpdates().catch((e) =>
        sendUpdateEvent('error', { message: String((e && e.message) || e) }));
    });
    ipcMain.handle('hdsh:updater-download', () =>
      autoUpdater.downloadUpdate().catch((e) =>
        sendUpdateEvent('error', { message: String((e && e.message) || e) })));
    ipcMain.handle('hdsh:updater-install', () => {
      autoUpdater.quitAndInstall();
      return { ok: true };
    });
  }

  // ---- WebUI 单独更新(不重装框架;替换运行时 dsh-web-frontend/dist) ----
  // 检查/下载/安装三阶段;进度与结果经 hdsh:webui-event 推给渲染进程。
  // WebUI 资产 = 运行时 @deepseek-ai/dsh-web-frontend/dist,由 dsh web 直接服务,
  // 替换后重启 dsh web 服务并 reload 窗口即生效。
  let lastWebuiStaging = null; // 会话内暂存:{ version, distDir, pkgDir, stagingDir }
  const sendWebuiEvent = (type, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const payload = Object.assign({ type }, data || {});
      mainWindow.webContents.send('hdsh:webui-event', payload);
    }
  };
  ipcMain.handle('hdsh:webui-check', async () => {
    const current = webuiVersion();
    const server = serverVersion();
    const chk = await webuiUpdate.checkLatest(server);
    if (!chk.ok) return { ok: false, current, server, error: chk.error || '检查失败' };
    // 可"单独更新"的目标 = 与当前服务端完全同版本的前端(重装/修复语义)。
    // 官方更高版本的前端需要配套新框架,不能单独安装(实证:跨版本前端会
    // 导致界面报 "window.__ModuleLoader__ bootstrap facade is missing")。
    const compatibleLatest = chk.compatibleLatest;
    const officialLatest = chk.officialLatest;
    const updateAvailable = !!(compatibleLatest && !webuiUpdate.versionsEqual(compatibleLatest, current));
    const needFrameworkUpdate = !!(officialLatest && current && webuiUpdate.compareVersions(officialLatest, current) > 0
      && !(compatibleLatest && webuiUpdate.versionsEqual(compatibleLatest, officialLatest)));
    return {
      ok: true,
      current,
      server,
      compatibleLatest,
      officialLatest,
      officialSource: chk.officialSource || '',
      updateAvailable,
      needFrameworkUpdate,
      repoUrl: 'https://github.com/deepseek-ai/deepseek-harness/tags',
      repoLabel: '官方仓库'
    };
  });
  ipcMain.handle('hdsh:webui-download', async (_e, payload) => {
    const version = payload && payload.version;
    if (!version || typeof version !== 'string') {
      sendWebuiEvent('error', { message: '缺少目标版本' });
      return { ok: false, error: '缺少目标版本' };
    }
    // 安全:前端只能安装与当前服务端(dsh-web-app)完全同版本的界面。
    // 跨版本(如 0.1.1-rc.2 前端配 0.1.0-rc.7 服务端)会导致 boot 注入契约不匹配、
    // 界面打不开,必须走框架更新。
    const server = serverVersion();
    if (!server || !webuiUpdate.versionsEqual(server, version)) {
      sendWebuiEvent('error', { message: '该版本需要配套的新框架,请通过「检查框架更新」升级框架后自动获得' });
      return { ok: false, error: '版本与当前框架服务端不匹配' };
    }
    const st = await webuiUpdate.fetchStaging({
      version,
      workDir: webuiWorkDir(),
      onProgress: (phase, data) => sendWebuiEvent(phase === 'downloading' ? 'downloading' : 'extracting', data)
    });
    if (!st.ok) {
      sendWebuiEvent('error', { message: st.error || '获取失败' });
      return { ok: false, error: st.error };
    }
    lastWebuiStaging = st;
    sendWebuiEvent('downloaded', { version: st.version });
    return { ok: true, version: st.version };
  });
  ipcMain.handle('hdsh:webui-install', async () => {
    if (!lastWebuiStaging) {
      sendWebuiEvent('error', { message: '尚未下载更新内容,请先下载' });
      return { ok: false, error: '尚未下载' };
    }
    const st = lastWebuiStaging;
    sendWebuiEvent('installing', { version: st.version });
    // 1) 停服务(释放文件占用,避免替换冲突)
    stopService();
    // 2) 安装前备份当前 dist 到用户数据区(启动自检可据此恢复)
    const before = webuiVersion();
    if (before) {
      try {
        const bdir = path.join(webuiBackupDir(), before);
        fs.rmSync(bdir, { recursive: true, force: true });
        fs.mkdirSync(bdir, { recursive: true });
        fs.cpSync(path.join(webuiPkgRoot(), 'dist'), path.join(bdir, 'dist'), { recursive: true });
        try {
          fs.copyFileSync(path.join(webuiPkgRoot(), 'package.json'), path.join(bdir, 'package.json'));
        } catch (_) {}
      } catch (e) { console.log('[webui] 备份失败: ' + (e && e.message)); }
    }
    // 3) 原子替换 dist 并同步版本
    const ap = webuiUpdate.applyStaging({
      pkgRoot: webuiPkgRoot(),
      distDir: st.distDir,
      pkgDir: st.pkgDir,
      stagingDir: st.stagingDir
    });
    if (!ap.ok) {
      sendWebuiEvent('error', { message: ap.error || '安装失败' });
      lastWebuiStaging = null;
      return { ok: false, error: ap.error };
    }
    lastWebuiStaging = null;
    // 4) 重启服务使新界面生效;窗口刷新
    let restarted = false;
    try {
      restarted = await startService();
    } catch (_) { restarted = false; }
    if (mainWindow && !mainWindow.isDestroyed() && restarted) {
      try { mainWindow.loadURL(WEB_URL); } catch (_) {}
    }
    sendWebuiEvent('done', { version: ap.version });
    return { ok: true, version: ap.version, restarted };
  });

  // ---- 统一更新(框架 + WebUI 一次检查、一键完成) ----
  // 检查:框架走 electron-updater(latest.yml),WebUI 走官方 npm;结果分行返回
  // 版本号,由设置页统一展示。更新:先修复 WebUI(如与前端不匹配)→ 多连接
  // 加速下载框架安装包 → SHA-512 校验 → 退出应用并静默安装(新框架自带配套
  // 新 WebUI)。加速下载不可用时自动回退 electron-updater 标准通道。
  let lastCheck = null;          // 最近一次统一检查结果(含 updateInfo,不下发渲染进程)
  let pendingInstaller = null;   // 待运行的新版安装包路径(应用退出后执行)
  let installerSpawned = false;

  const sendAllEvent = (type, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('hdsh:update-all-event', Object.assign({ type }, data || {}));
    }
  };

  async function checkAllUpdates() {
    // 框架:electron-updater 检查(开发模式跳过)
    const fw = { current: frameworkVersion(), latest: null, updateAvailable: false, skipped: false, error: null };
    let updateInfo = null;
    if (!app.isPackaged) {
      fw.skipped = true;
    } else {
      try {
        const r = await autoUpdater.checkForUpdates();
        updateInfo = (r && r.updateInfo) || null;
        fw.latest = (updateInfo && updateInfo.version) || null;
        fw.updateAvailable = !!(fw.latest && fw.current && webuiUpdate.compareVersions(fw.latest, fw.current) > 0);
      } catch (e) {
        fw.error = String((e && e.message) || e);
      }
    }
    // WebUI:官方 npm 检查(前端必须与服务端同版本;官方更高版本随框架更新附带)
    const wb = {
      current: webuiVersion(), server: serverVersion(),
      officialLatest: null, officialSource: '', mismatch: false, repairVersion: null,
      needFrameworkUpdate: false, error: null
    };
    try {
      const chk = await webuiUpdate.checkLatest(wb.server);
      if (chk.ok) {
        wb.officialLatest = chk.officialLatest;
        wb.officialSource = chk.officialSource || '';
        wb.mismatch = !!(wb.current && wb.server && !webuiUpdate.versionsEqual(wb.current, wb.server));
        wb.repairVersion = wb.mismatch ? wb.server : null;
        wb.needFrameworkUpdate = !!(chk.officialLatest && wb.server
          && webuiUpdate.compareVersions(chk.officialLatest, wb.server) > 0);
      } else {
        wb.error = chk.error || '检查失败';
      }
    } catch (e) {
      wb.error = String((e && e.message) || e);
    }
    const actions = [];
    if (wb.mismatch && wb.repairVersion) actions.push('webui-repair');
    if (fw.updateAvailable) actions.push('framework-update');
    lastCheck = { framework: fw, webui: wb, actions, updateInfo };
    // 渲染进程只拿摘要(updateInfo 含下载地址等,留在主进程)
    return {
      ok: true,
      framework: { current: fw.current, latest: fw.latest, updateAvailable: fw.updateAvailable, skipped: fw.skipped, error: fw.error },
      webui: { current: wb.current, server: wb.server, officialLatest: wb.officialLatest, officialSource: wb.officialSource, mismatch: wb.mismatch, repairVersion: wb.repairVersion, needFrameworkUpdate: wb.needFrameworkUpdate, error: wb.error },
      actions,
      anyUpdate: actions.length > 0
    };
  }

  // 修复 WebUI:下载与当前服务端配套的前端并原子替换(与单独更新同一实现)
  async function repairWebuiNow(version) {
    sendAllEvent('repairing', { version });
    const st = await webuiUpdate.fetchStaging({
      version,
      workDir: webuiWorkDir(),
      onProgress: (phase, data) => sendAllEvent(phase === 'downloading' ? 'repair-downloading' : 'extracting', data)
    });
    if (!st.ok) throw new Error(st.error || '获取 WebUI 更新失败');
    stopService();
    // 安装前备份当前 dist(启动自检可据此恢复)
    const before = webuiVersion();
    if (before) {
      try {
        const bdir = path.join(webuiBackupDir(), before);
        fs.rmSync(bdir, { recursive: true, force: true });
        fs.mkdirSync(bdir, { recursive: true });
        fs.cpSync(path.join(webuiPkgRoot(), 'dist'), path.join(bdir, 'dist'), { recursive: true });
        try { fs.copyFileSync(path.join(webuiPkgRoot(), 'package.json'), path.join(bdir, 'package.json')); } catch (_) {}
      } catch (e) { console.log('[webui] 备份失败: ' + (e && e.message)); }
    }
    const ap = webuiUpdate.applyStaging({
      pkgRoot: webuiPkgRoot(),
      distDir: st.distDir,
      pkgDir: st.pkgDir,
      stagingDir: st.stagingDir
    });
    if (!ap.ok) throw new Error(ap.error || '应用 WebUI 更新失败');
    try { await startService(); } catch (_) {}
    if (mainWindow && !mainWindow.isDestroyed()) {
      try { mainWindow.loadURL(WEB_URL); } catch (_) {}
    }
  }

  // SHA-512 校验(latest.yml 中为 base64)
  function verifyFileSha512(file, expectedB64) {
    return new Promise((resolve) => {
      if (!expectedB64) return resolve(true);
      try {
        const h = crypto.createHash('sha512');
        const s = fs.createReadStream(file);
        s.on('data', (c) => { try { h.update(c); } catch (_) {} });
        s.on('end', () => { try { resolve(h.digest('base64') === expectedB64); } catch (_) { resolve(false); } });
        s.on('error', () => resolve(false));
      } catch (_) { resolve(false); }
    });
  }

  // 多连接加速下载框架安装包;失败返回 fallback:true(调用方回退标准通道)
  async function acceleratedFrameworkDownload(updateInfo) {
    const files = (updateInfo && updateInfo.files) || [];
    const exe = files.find((f) => f && typeof f.url === 'string' && /\.exe(\?|$)/i.test(f.url));
    if (!exe) return { ok: false, fallback: true, error: '未找到安装包下载地址' };
    let dest;
    try {
      fs.mkdirSync(UPDATES_DIR(), { recursive: true });
      // 清理旧安装包
      try {
        for (const f of fs.readdirSync(UPDATES_DIR())) {
          if (f !== path.basename(new URL(exe.url).pathname)) {
            try { fs.rmSync(path.join(UPDATES_DIR(), f), { force: true }); } catch (_) {}
          }
        }
      } catch (_) {}
      dest = path.join(UPDATES_DIR(), path.basename(new URL(exe.url).pathname));
    } catch (e) {
      return { ok: false, fallback: true, error: '创建下载目录失败: ' + ((e && e.message) || e) };
    }
    const r = await webuiUpdate.downloadFileParallel(exe.url, dest, (p) => sendAllEvent('downloading', p), { connections: 6 });
    if (!r.ok) {
      try { fs.rmSync(dest, { force: true }); } catch (_) {}
      return { ok: false, fallback: true, error: r.error || '下载失败' };
    }
    sendAllEvent('verifying', { version: updateInfo.version });
    if (!(await verifyFileSha512(dest, exe.sha512 || (updateInfo && updateInfo.sha512)))) {
      try { fs.rmSync(dest, { force: true }); } catch (_) {}
      return { ok: false, fallback: true, error: '安装包校验失败' };
    }
    return { ok: true, file: dest, version: updateInfo.version };
  }

  function quitAndRunInstaller(file) {
    pendingInstaller = file;
    installerSpawned = false;
    sendAllEvent('installing', { version: (lastCheck && lastCheck.framework.latest) || null });
    app.quit();
  }

  ipcMain.handle('hdsh:check-all', async () => {
    try { return await checkAllUpdates(); } catch (e) {
      return { ok: false, error: String((e && e.message) || e), actions: [], anyUpdate: false };
    }
  });
  ipcMain.handle('hdsh:update-all-run', async () => {
    try {
      const chk = lastCheck || await checkAllUpdates();
      // 1) WebUI 修复(与前端不匹配时;完成后界面已刷新)
      if (chk.actions.indexOf('webui-repair') !== -1) {
        await repairWebuiNow(chk.webui.repairVersion);
      }
      // 2) 框架更新(新框架自带配套新 WebUI)
      if (chk.actions.indexOf('framework-update') !== -1 && chk.updateInfo) {
        const dl = await acceleratedFrameworkDownload(chk.updateInfo);
        if (dl.ok) {
          quitAndRunInstaller(dl.file);
          return { ok: true, mode: 'accelerated', version: dl.version };
        }
        // 回退:electron-updater 标准下载(事件经 hdsh:updater-event,UI 已订阅)
        sendAllEvent('fallback', { message: dl.error || '加速通道不可用' });
        autoUpdater.downloadUpdate().catch((e) =>
          sendAllEvent('error', { message: String((e && e.message) || e) }));
        return { ok: true, mode: 'standard' };
      }
      return { ok: true, mode: chk.actions.length ? 'done' : 'none' };
    } catch (e) {
      const msg = String((e && e.message) || e);
      sendAllEvent('error', { message: msg });
      return { ok: false, error: msg };
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
    migrateOldAppData();
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

  app.on('before-quit', () => {
    app.isQuitting = true;
    stopService();
    // 一键更新:应用完全退出后静默运行新版安装包(NSIS /S 静默;--updated
    // 告知安装器这是更新安装,与 electron-updater 行为一致)
    if (pendingInstaller && !installerSpawned) {
      installerSpawned = true;
      try {
        const child = spawn(pendingInstaller, ['/S', '--updated'], { detached: true, stdio: 'ignore', windowsHide: true });
        child.unref();
      } catch (e) { console.error('[update] 启动安装包失败: ' + (e && e.message)); }
    }
  });
}
