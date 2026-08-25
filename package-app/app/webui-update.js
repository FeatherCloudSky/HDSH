// HelloDeepseekHarness — WebUI 单独更新模块(纯 Node,不依赖 Electron)
// 职责:检测官方 npm 上 @deepseek-ai/dsh-web-frontend 的最新版本、下载 tarball、
//       解压校验、原子替换运行时内置 dist 目录。所有路径由调用方(main.js)传入,
//       本模块只做文件与网络,便于独立冒烟测试。
// 约定:WebUI 资产 = 运行时 node_modules/@deepseek-ai/dsh-web-frontend/dist 目录;
//       dsh web 经 require.resolve("@deepseek-ai/dsh-web-frontend/dist/index.html")
//       服务该目录,因此替换 dist 即"单独更新 WebUI",无需重装框架。
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawnSync } = require('child_process');

const PACKAGE_NAME = '@deepseek-ai/dsh-web-frontend';
const REGISTRY_BASE = 'https://registry.npmjs.org';
const UA = 'HDSH-webui-updater/1.3.0';
const TAR_EXE = process.env.SystemRoot
  ? path.join(process.env.SystemRoot, 'System32', 'tar.exe')
  : 'tar.exe';

// ================= 版本比较(与客户端插件 parseVersion/compareVersions 保持一致) =================
function parseVersion(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/^[^0-9]*/, '');
  const m = s.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-_.+](.+))?$/);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)], pre: m[4] ? m[4].split(/[.+-]/) : null };
}
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn) return -1;
    if (yn) return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
// 框架兼容线:major.minor 相同才允许单独更新(避免前端与服务端 API 不匹配)
function sameLine(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  return !!(pa && pb && pa.core[0] === pb.core[0] && pa.core[1] === pb.core[1]);
}

// ================= 轻量 HTTP(跟随重定向,JSON) =================
function httpGetJson(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(httpGetJson(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return resolve({ ok: false, error: 'HTTP ' + res.statusCode });
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          resolve({ ok: true, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (e) {
          resolve({ ok: false, error: '响应解析失败' });
        }
      });
      res.on('error', (e) => resolve({ ok: false, error: e.message || '网络错误' }));
    });
    req.on('error', (e) => resolve({ ok: false, error: e.message || '网络错误' }));
    req.setTimeout(timeoutMs || 15000, () => { req.destroy(); resolve({ ok: false, error: '请求超时' }); });
  });
}

// ================= 流式下载(跟随重定向,带进度回调) =================
function downloadFile(url, destPath, onProgress, timeoutMs) {
  return new Promise((resolve) => {
    const doGet = (u, redirectsLeft) => {
      const req = https.get(u, { headers: { 'User-Agent': UA } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return resolve({ ok: false, error: '重定向过多' });
          return doGet(new URL(res.headers.location, u).toString(), redirectsLeft - 1);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return resolve({ ok: false, error: 'HTTP ' + res.statusCode });
        }
        const total = Number(res.headers['content-length']) || 0;
        let received = 0;
        let lastReport = 0;
        try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch (_) {}
        const out = fs.createWriteStream(destPath);
        res.on('data', (c) => {
          received += c.length;
          const now = Date.now();
          if (onProgress && (now - lastReport > 200 || received === total)) {
            lastReport = now;
            try {
              onProgress({ percent: total ? Math.round((received / total) * 100) : 0, transferred: received, total });
            } catch (_) {}
          }
        });
        res.pipe(out);
        out.on('finish', () => { out.close(() => resolve({ ok: true, bytes: received })); });
        out.on('error', (e) => { try { fs.unlinkSync(destPath); } catch (_) {} resolve({ ok: false, error: e.message || '写入失败' }); });
        res.on('error', (e) => { try { fs.unlinkSync(destPath); } catch (_) {} resolve({ ok: false, error: e.message || '下载失败' }); });
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message || '下载失败' }));
      req.setTimeout(timeoutMs || 300000, () => { req.destroy(); resolve({ ok: false, error: '下载超时' }); });
    };
    doGet(url, 5);
  });
}

// ================= 检查最新版本 =================
// 返回:{ ok, latest, source, tags }
// 策略:npm 上 latest 标签可能停留在旧发布线(如 0.0.1-rc.5),而活跃 rc 线在
//       next(如 0.1.1-rc.2)。因此从所有 dist-tags 候选(latest/next/其余)里
//       取版本号最高者,避免把"旧标签"误报为可降级/可更新。
async function checkLatest() {
  const res = await httpGetJson(REGISTRY_BASE + '/@deepseek-ai/dsh-web-frontend', 15000);
  if (!res.ok) return { ok: false, error: res.error || '无法访问 npm registry' };
  const tags = (res.data && res.data['dist-tags']) || {};
  let best = null;
  let bestTag = null;
  for (const [tag, ver] of Object.entries(tags)) {
    if (typeof ver !== 'string') continue;
    if (best === null || compareVersions(ver, best) > 0) {
      best = ver;
      bestTag = tag;
    }
  }
  return { ok: true, latest: best, source: best ? 'npm(' + bestTag + ')' : '', tags };
}

// ================= 解压 + 校验 =================
// tgz 内部结构: package/package.json + package/dist/... → 返回 { ok, version, distDir, pkgDir }
function extractAndVerify(tgzPath, stagingDir) {
  try { fs.mkdirSync(stagingDir, { recursive: true }); } catch (_) {}
  const r = spawnSync(TAR_EXE, ['-xzf', tgzPath, '-C', stagingDir], {
    windowsHide: true, stdio: 'pipe', encoding: 'utf8', timeout: 120000
  });
  if (r.error) return { ok: false, error: '启动解压失败: ' + r.error.message };
  if (r.status !== 0) {
    return { ok: false, error: '解压失败(exit ' + r.status + '): ' + String(r.stderr || r.stdout || '').trim().slice(0, 300) };
  }
  const pkgDir = path.join(stagingDir, 'package');
  const distDir = path.join(pkgDir, 'dist');
  if (!fs.existsSync(path.join(distDir, 'index.html')) || !fs.existsSync(path.join(distDir, 'assets'))) {
    return { ok: false, error: '下载内容不完整(缺少 index.html / assets)' };
  }
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version || null;
  } catch (_) {}
  if (!version) return { ok: false, error: '无法读取包版本信息' };
  return { ok: true, version, distDir, pkgDir };
}

// ================= 原子替换目录 =================
// from(新目录,改名后成为 to) → to(旧目录先改名 .old 再删除);失败自动回滚
function swapDir(from, to) {
  const old = to + '.old-' + Date.now();
  let movedOld = false;
  try {
    if (fs.existsSync(to)) {
      fs.renameSync(to, old);
      movedOld = true;
    }
    fs.renameSync(from, to);
    if (movedOld) fs.rmSync(old, { recursive: true, force: true });
    return { ok: true };
  } catch (e) {
    try { if (movedOld && !fs.existsSync(to)) fs.renameSync(old, to); } catch (_) {}
    try { if (fs.existsSync(from)) fs.rmSync(from, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, error: '替换目录失败: ' + ((e && e.message) || e) };
  }
}

// ================= 获取当前生效版本 =================
// pkgRoot: 运行时 node_modules/@deepseek-ai/dsh-web-frontend 目录
function getCurrentVersion(pkgRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
    return (pkg && pkg.version) || null;
  } catch (_) { return null; }
}

// ================= 阶段一:获取并暂存(下载 → 解压校验,不替换) =================
// opts: { version, workDir, onProgress, tgzPath? } → { ok, version, distDir, pkgDir, stagingDir }
async function fetchStaging(opts) {
  const { version, workDir, onProgress, tgzPath: presetTgz } = opts || {};
  const notify = (phase, data) => { try { if (onProgress) onProgress(phase, data || {}); } catch (_) {} };
  if (!version || !workDir) return { ok: false, error: '参数缺失' };
  const tmpDir = path.join(workDir, 'tmp');
  const tgzPath = presetTgz || path.join(tmpDir, 'dsh-web-frontend-' + version + '.tgz');
  const stagingDir = path.join(tmpDir, 'extract-' + version);

  if (!presetTgz) {
    const url = REGISTRY_BASE + '/@deepseek-ai/dsh-web-frontend/-/dsh-web-frontend-' + version + '.tgz';
    notify('downloading', { percent: 0, transferred: 0, total: 0 });
    const dl = await downloadFile(url, tgzPath, (p) => notify('downloading', p));
    if (!dl.ok) { try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {} return { ok: false, error: '下载失败: ' + dl.error }; }
  }

  notify('extracting', {});
  try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
  const ex = extractAndVerify(tgzPath, stagingDir);
  if (!ex.ok) return { ok: false, error: ex.error };
  if (ex.version !== version) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, error: '版本校验失败(期望 ' + version + ',实际 ' + ex.version + ')' };
  }
  return { ok: true, version, distDir: ex.distDir, pkgDir: ex.pkgDir, stagingDir };
}

// ================= 阶段二:应用暂存(原子替换 dist + 同步版本 + 清理) =================
// opts: { pkgRoot, distDir, pkgDir, stagingDir } → { ok, version?, dist?, error? }
function applyStaging(opts) {
  const { pkgRoot, distDir, pkgDir, stagingDir } = opts || {};
  if (!pkgRoot || !distDir) return { ok: false, error: '参数缺失' };
  let version = null;
  try {
    version = JSON.parse(fs.readFileSync(path.join(pkgDir || stagingDir, 'package.json'), 'utf8')).version || null;
  } catch (_) {}
  const targetDist = path.join(pkgRoot, 'dist');
  const sw = swapDir(distDir, targetDist);
  if (!sw.ok) {
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
    return { ok: false, error: sw.error };
  }
  try {
    const pkgJson = path.join(pkgDir || stagingDir, 'package.json');
    if (fs.existsSync(pkgJson)) fs.copyFileSync(pkgJson, path.join(pkgRoot, 'package.json'));
  } catch (_) {}
  try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (_) {}
  return { ok: true, version, dist: targetDist };
}

// ================= 完整安装流程(下载 → 解压校验 → 原子替换) =================
// opts: {
//   version: 目标版本(必填), pkgRoot: 前端包目录(必填),
//   workDir: 临时工作目录(用户数据区,必填), onProgress: (phase, data) 回调
//   skipDownload: 已有 tgz 时跳过下载(测试用)
// }
async function installWebui(opts) {
  const { version, pkgRoot, workDir, onProgress, tgzPath: presetTgz } = opts || {};
  const notify = (phase, data) => { try { if (onProgress) onProgress(phase, data || {}); } catch (_) {} };
  if (!version || !pkgRoot || !workDir) return { ok: false, error: '参数缺失' };
  if (!fs.existsSync(pkgRoot)) return { ok: false, error: '运行时前端包目录不存在: ' + pkgRoot };

  const st = await fetchStaging({ version, workDir, onProgress, tgzPath: presetTgz });
  if (!st.ok) return st;

  notify('installing', {});
  const ap = applyStaging({ pkgRoot, distDir: st.distDir, pkgDir: st.pkgDir, stagingDir: st.stagingDir });
  if (!ap.ok) return ap;

  notify('done', { version });
  return { ok: true, version, dist: ap.dist };
}

module.exports = {
  PACKAGE_NAME,
  REGISTRY_BASE,
  parseVersion,
  compareVersions,
  sameLine,
  checkLatest,
  downloadFile,
  extractAndVerify,
  swapDir,
  getCurrentVersion,
  fetchStaging,
  applyStaging,
  installWebui
};
