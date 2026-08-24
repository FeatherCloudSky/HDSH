// HDSH 内置更新检测 — 浏览器半边
// 注册 设置→通用设置 的「更新检测」行:两个独立按钮分别检查 WebUI
// (官方 deepseek-ai/deepseek-harness 仓库)与本框架(FeatherCloudSky/HDSH)
// 的新版本;发现新版本时询问用户是否更新。
// 当前版本经 window.hdsh.getVersions()(Electron 主进程读取);
// 最新版本由本页面 fetch GitHub/npm(官方 API 均开放 CORS);
// 更新动作经 window.hdsh.downloadFramework / openUrl。
window.__ModuleLoader__.load({
	id: "dsh-update-check",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");

		// ---- 样式(注入 <style>,与其它随包插件一致) ----
		const CSS = `
.updchk-row{display:flex;flex-direction:column;gap:10px;padding:10px 0;width:100%;box-sizing:border-box}
.updchk-head{display:flex;flex-direction:column;gap:2px}
.updchk-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#262c3e)}
.updchk-desc{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#6b7280)}
.updchk-group{display:flex;flex-direction:column;gap:7px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.04))}
.updchk-line{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.updchk-info{display:flex;flex-direction:column;gap:2px;min-width:0}
.updchk-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#262c3e)}
.updchk-repo{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
.updchk-note{font-size:11.5px;line-height:1.5;color:var(--dsw-alias-label-secondary,#6b7280)}
.updchk-vers{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280)}
.updchk-status{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280)}
.updchk-ok{color:var(--dsw-alias-state-success-primary,#16a34a)}
.updchk-err{color:var(--dsw-alias-state-error-primary,#dc2626)}
.updchk-warn{color:var(--dsw-alias-state-warn-primary,#d97706)}
.updchk-btn{flex:none;border:1px solid var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-2,#fff);color:var(--dsw-alias-label-primary,#1f2937);border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer;transition:opacity .15s ease}
.updchk-btn:hover{border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:var(--dsw-alias-brand-primary,#4d6bfe)}
.updchk-btn:disabled{opacity:.55;cursor:default}
.updchk-btn-primary{background:var(--dsw-alias-brand-primary,#4d6bfe);border-color:var(--dsw-alias-brand-primary,#4d6bfe);color:#fff}
.updchk-btn-primary:hover{color:#fff;opacity:.9}
.updchk-confirm{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px dashed var(--dsw-alias-state-warn-primary,#d97706);border-radius:8px;padding:8px 10px;background:rgba(217,119,6,.06)}
.updchk-link{background:none;border:none;padding:0;font-size:11.5px;color:var(--dsw-alias-brand-primary,#4d6bfe);cursor:pointer;text-decoration:underline;align-self:flex-start}
`;
		(function () {
			const tagId = "dsh-update-check/style";
			if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=\"" + tagId + "\"]") === null) {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-update-check";
				tag.dataset.pluginCss = tagId;
				tag.textContent = CSS;
				document.head.appendChild(tag);
			}
		})();

		// ---- 版本对比(兼容 v/ver/dsh- 前缀与 rc 预发布段) ----
		function parseVersion(raw) {
			if (typeof raw !== "string") return null;
			const s = raw.trim().replace(/^[^0-9]*/, "");
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

		// ---- 网络(浏览器 fetch;GitHub/npm 官方 API 开放 CORS) ----
		async function fetchJson(url) {
			try {
				const res = await fetch(url, { headers: { "User-Agent": "dsh-update-check" } });
				if (!res.ok) return { ok: false, error: "HTTP " + res.status };
				return { ok: true, data: await res.json() };
			} catch (e) {
				return { ok: false, error: "网络请求失败" };
			}
		}

		async function currentVersions() {
			try {
				if (typeof window !== "undefined" && window.hdsh && window.hdsh.getVersions) {
					const v = await window.hdsh.getVersions();
					return { webui: (v && v.webui) || null, framework: (v && v.framework) || null };
				}
			} catch (e) { /* fallthrough */ }
			return { webui: null, framework: null };
		}

		async function checkWebui() {
			const cur = await currentVersions();
			let latest = null;
			let source = "";
			let error = null;
			const r1 = await fetchJson("https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=30");
			if (r1.ok && Array.isArray(r1.data)) {
				const t = r1.data.find((x) => x && typeof x.name === "string" && /^dsh-v/i.test(x.name));
				if (t) {
					latest = String(t.name).replace(/^dsh-v/i, "");
					source = "官方仓库 GitHub 标签";
				}
			}
			if (!latest) {
				const r2 = await fetchJson("https://registry.npmjs.org/@deepseek-ai/dsh-web-app");
				if (r2.ok && r2.data && r2.data["dist-tags"] && r2.data["dist-tags"].next) {
					latest = String(r2.data["dist-tags"].next);
					source = "npm(next 标记)";
				}
				if (!latest) error = (r1.error || "未获取到最新版本");
			}
			return {
				target: "webui",
				current: cur.webui,
				latest: latest,
				source: source,
				updateAvailable: !!(latest && cur.webui && compareVersions(latest, cur.webui) > 0),
				error: error,
				repoUrl: "https://github.com/deepseek-ai/deepseek-harness/tags",
				repoLabel: "官方仓库"
			};
		}

		async function checkFramework() {
			const cur = await currentVersions();
			let latest = null;
			let assetUrl = null;
			let fileName = null;
			let error = null;
			const r1 = await fetchJson("https://api.github.com/repos/FeatherCloudSky/HDSH/releases/latest");
			if (r1.ok && r1.data && r1.data.tag_name) {
				latest = String(r1.data.tag_name);
				const asset = (r1.data.assets || []).find((a) => a && a.browser_download_url);
				if (asset) {
					assetUrl = String(asset.browser_download_url);
					fileName = String(asset.name || "").split("/").pop() || null;
				}
			}
			if (!latest) {
				const r2 = await fetchJson("https://api.github.com/repos/FeatherCloudSky/HDSH/tags?per_page=10");
				if (r2.ok && Array.isArray(r2.data) && r2.data[0] && r2.data[0].name) {
					latest = String(r2.data[0].name);
					const ver = latest.replace(/^[^0-9]*/, "");
					fileName = "HelloDeepseekHarness-Setup-" + ver + ".exe";
					assetUrl = "https://github.com/FeatherCloudSky/HDSH/releases/download/" + latest + "/" + fileName;
				}
				if (!latest) error = (r1.error || "未获取到最新版本");
			}
			return {
				target: "framework",
				current: cur.framework,
				latest: latest,
				source: "GitHub Releases",
				updateAvailable: !!(latest && cur.framework && compareVersions(latest, cur.framework) > 0),
				error: error,
				assetUrl: assetUrl,
				fileName: fileName,
				repoUrl: "https://github.com/FeatherCloudSky/HDSH/releases/latest",
				repoLabel: "HDSH 发布页"
			};
		}

		// ---- 动作 ----
		async function performFramework(result) {
			if (!result.assetUrl) return { ok: false, message: "缺少安装包下载地址" };
			if (window && window.hdsh && window.hdsh.downloadFramework) {
				try {
					return await window.hdsh.downloadFramework({ url: result.assetUrl, fileName: result.fileName });
				} catch (e) {
					return { ok: false, message: String((e && e.message) || e) };
				}
			}
			return { ok: false, message: "下载通道不可用,请手动访问 " + result.repoUrl };
		}
		async function performWebui(result) {
			const url = result.repoUrl || "https://github.com/deepseek-ai/deepseek-harness/tags";
			if (window && window.hdsh && window.hdsh.openUrl) {
				try {
					const r = await window.hdsh.openUrl(url);
					if (r && r.ok) return { ok: true, message: "已打开官方仓库标签页。提示:本应用的 WebUI 组件随框架安装包分发,通常通过「检查框架更新 → 更新框架」获得新版 WebUI。" };
					return { ok: false, message: ((r && r.message) || "打开页面失败") + ";请手动访问 " + url };
				} catch (e) {
					return { ok: false, message: String((e && e.message) || e) };
				}
			}
			return { ok: false, message: "打开页面失败;请手动访问 " + url };
		}

		// ---- 组件 ----
		function doCheck(kind, setState) {
			setState({ phase: "checking", result: null, error: null, msg: null, dismissed: false });
			const task = kind === "webui" ? checkWebui() : checkFramework();
			task.then((res) => {
				if (!res) return setState({ phase: "error", result: null, error: "无响应", msg: null, dismissed: false });
				if (res.error) return setState({ phase: "error", result: res, error: res.error, msg: null, dismissed: false });
				setState({ phase: "checked", result: res, error: null, msg: null, dismissed: false });
			}).catch((e) => {
				setState({ phase: "error", result: null, error: String((e && e.message) || e), msg: null, dismissed: false });
			});
		}

		function doPerform(kind, state, setState) {
			const result = state.result;
			setState({ phase: "updating", result: result, error: null, msg: null, dismissed: false });
			const task = kind === "framework" ? performFramework(result) : performWebui(result);
			task.then((r) => {
				if (r && r.ok) setState({ phase: "done", result: result, error: null, msg: r.message || "更新完成", dismissed: false });
				else setState({ phase: "done", result: result, error: (r && r.message) || "更新失败", msg: null, dismissed: false });
			}).catch((e) => {
				setState({ phase: "done", result: result, error: String((e && e.message) || e), msg: null, dismissed: false });
			});
		}

		function openRepo(result) {
			if (window && window.hdsh && window.hdsh.openUrl && result && result.repoUrl) {
				window.hdsh.openUrl(result.repoUrl).catch(() => {});
			}
		}

		function renderGroup(kind, state, setState) {
			const h = react.createElement;
			const meta = kind === "webui"
				? {
					label: "WebUI(官方 DeepSeek Harness 界面)",
					repo: "官方仓库:github.com/deepseek-ai/deepseek-harness",
					note: "WebUI 为官方 DeepSeek Harness 的浏览器界面组件,随本框架安装包一起分发。",
					btn: "检查 WebUI 更新"
				}
				: {
					label: "本框架(HelloDeepseekHarness / HDSH)",
					repo: "仓库:github.com/FeatherCloudSky/HDSH",
					note: "本框架为 HelloDeepseekHarness 桌面应用,更新以安装包形式发布在 HDSH 仓库。",
					btn: "检查框架更新"
				};
			const result = state.result;
			const busy = state.phase === "checking" || state.phase === "updating";
			const els = [];

			els.push(h("div", { className: "updchk-line" },
				h("div", { className: "updchk-info" },
					h("div", { className: "updchk-name" }, meta.label),
					h("div", { className: "updchk-repo" }, meta.repo)
				),
				h("button", { className: "updchk-btn", disabled: busy, onClick: () => doCheck(kind, setState) },
					state.phase === "checking" ? "检查中…" : meta.btn)
			));
			els.push(h("div", { className: "updchk-note" }, meta.note));

			if (state.phase === "idle") {
				els.push(h("div", { className: "updchk-status" }, "未检查 · 点击上方按钮开始"));
			} else if (state.phase === "checking") {
				els.push(h("div", { className: "updchk-status" }, "正在检查更新…"));
			} else if (state.phase === "error") {
				els.push(h("div", { className: "updchk-status updchk-err" }, "✗ " + (state.error || "检查失败")));
				if (result && result.repoUrl) {
					els.push(h("button", { className: "updchk-link", onClick: () => openRepo(result) }, "打开" + (result.repoLabel || "仓库") + " ↗"));
				}
			} else if (state.phase === "checked") {
				const cur = result && result.current ? result.current : "未知";
				const lat = result && result.latest ? result.latest : "未知";
				els.push(h("div", { className: "updchk-vers" }, "当前版本:" + cur + "　·　最新版本:" + lat + (result && result.source ? "(" + result.source + ")" : "")));
				if (result && result.updateAvailable) {
					if (!state.dismissed) {
						els.push(h("div", { className: "updchk-confirm" },
							h("span", { className: "updchk-warn" }, "⚠ 发现新版本:" + cur + " → " + lat + ",是否立即更新?"),
							h("button", { className: "updchk-btn updchk-btn-primary", onClick: () => doPerform(kind, state, setState) }, "立即更新"),
							h("button", { className: "updchk-btn", onClick: () => setState({ phase: "checked", result: result, dismissed: true }) }, "暂不更新")
						));
					} else {
						els.push(h("div", { className: "updchk-status updchk-warn" }, "已忽略本次更新提醒(可再次点击按钮重新检测)"));
					}
				} else {
					els.push(h("div", { className: "updchk-status updchk-ok" }, "✓ 已是最新版本"));
				}
				if (result && result.repoUrl) {
					els.push(h("button", { className: "updchk-link", onClick: () => openRepo(result) }, "打开" + (result.repoLabel || "仓库") + " ↗"));
				}
			} else if (state.phase === "updating") {
				els.push(h("div", { className: "updchk-status" }, kind === "framework" ? "正在更新…(下载安装包可能需要一些时间,请勿关闭应用)" : "正在打开官方页面…"));
			} else if (state.phase === "done") {
				if (state.msg) els.push(h("div", { className: "updchk-status updchk-ok" }, "✓ " + state.msg));
				else els.push(h("div", { className: "updchk-status updchk-err" }, "✗ " + (state.error || "更新失败")));
			}

			return h("div", { className: "updchk-group" }, els);
		}

		function UpdateRow() {
			const h = react.createElement;
			const [webui, setWebui] = react.useState({ phase: "idle", result: null, error: null, msg: null, dismissed: false });
			const [framework, setFramework] = react.useState({ phase: "idle", result: null, error: null, msg: null, dismissed: false });
			return h("div", { className: "updchk-row" },
				h("div", { className: "updchk-head" },
					h("div", { className: "updchk-title" }, "更新检测"),
					h("div", { className: "updchk-desc" }, "分别检测 WebUI(官方 DeepSeek Harness 仓库)与本框架(FeatherCloudSky/HDSH)的新版本;发现新版本时会询问是否更新。")
				),
				renderGroup("webui", webui, setWebui),
				renderGroup("framework", framework, setFramework)
			);
		}

		exports.inject = ["slots"];
		exports.apply = function (ctx) {
			ctx.slots.inject("settings.general.item", () => ctx.slots.register({
				name: "settings.general.item",
				id: "update-checker",
				order: 30
			}, () => react.createElement(UpdateRow, null)));
		};
		return module.exports;
	}
});
