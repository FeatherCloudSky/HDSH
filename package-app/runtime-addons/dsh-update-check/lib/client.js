// HDSH 内置更新检测 — 浏览器半边
// 设置 → 通用设置的「更新检测」栏目:
//  - 框架(本应用):一键自动更新。点击「检查框架更新」→ 发现新版本 → 点击
//    「立即更新」→ 自动下载(转圈 + 进度条 + 提示)→ 自动安装 → 应用自动重启,
//    全程无需用户手动前往官网下载。驱动:Electron 主进程 electron-updater,
//    事件经 window.hdsh.onUpdateEvent 回报。
//  - WebUI(官方 DeepSeek Harness 界面):检测官方仓库最新版本并打开发布页
//    (WebUI 组件随框架安装包分发,随框架更新一并升级)。
window.__ModuleLoader__.load({
	id: "dsh-update-check",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		let react = require("react");

		// ---- 样式 ----
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
.updchk-status{font-size:12px;color:var(--dsw-alias-label-secondary,#6b7280);display:flex;align-items:center;gap:8px}
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
.updchk-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2,#d1d5db);border-top-color:var(--dsw-alias-brand-primary,#4d6bfe);border-radius:50%;display:inline-block;animation:updchk-spin .8s linear infinite;flex:none}
.updchk-spinner-big{width:18px;height:18px;border-width:2.5px}
@keyframes updchk-spin{to{transform:rotate(360deg)}}
.updchk-progress{height:6px;border-radius:99px;background:var(--dsw-alias-border-l1,#e5e7eb);overflow:hidden;margin-top:4px}
.updchk-progress i{display:block;height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary,#4d6bfe);transition:width .2s ease}
.updchk-tip{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
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

		// ---- 版本对比(兼容 v/ver/dsh- 前缀与 rc 预发布段;用于 WebUI 检查) ----
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

		// ---- 网络(浏览器 fetch;GitHub/npm 官方 API 开放 CORS;仅 WebUI 检查使用) ----
		async function fetchJson(url) {
			try {
				const res = await fetch(url, { headers: { "User-Agent": "dsh-update-check" } });
				if (!res.ok) return { ok: false, error: "HTTP " + res.status };
				return { ok: true, data: await res.json() };
			} catch (e) {
				return { ok: false, error: "网络请求失败" };
			}
		}

		async function checkWebui() {
			let current = null;
			try {
				if (window && window.hdsh && window.hdsh.getVersions) {
					const v = await window.hdsh.getVersions();
					current = (v && v.webui) || null;
				}
			} catch (e) { /* ignore */ }
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
				current: current,
				latest: latest,
				source: source,
				updateAvailable: !!(latest && current && compareVersions(latest, current) > 0),
				error: error,
				repoUrl: "https://github.com/deepseek-ai/deepseek-harness/tags",
				repoLabel: "官方仓库"
			};
		}

		// ---- 框架一键自动更新:订阅 electron-updater 事件 → 组件状态机 ----
		function subscribeUpdater(setState) {
			if (!window || !window.hdsh || !window.hdsh.onUpdateEvent) return () => {};
			return window.hdsh.onUpdateEvent((ev) => {
				setState((prev) => {
					switch (ev.type) {
						case "checking-for-update":
							return { ...prev, phase: "checking", error: null };
						case "update-available":
							return { ...prev, phase: "checked", latest: ev.version, error: null };
						case "update-not-available":
							return { ...prev, phase: "checked", latest: null, error: null };
						case "download-progress":
							return { ...prev, phase: "downloading", percent: typeof ev.percent === "number" ? ev.percent : prev.percent, error: null };
						case "update-downloaded":
							// 下载完成 → 提示后自动安装并重启
							setTimeout(() => {
								if (window.hdsh && window.hdsh.installUpdate) window.hdsh.installUpdate().catch(() => {});
							}, 1800);
							return { ...prev, phase: "installing", error: null };
						case "error":
							return { ...prev, phase: "error", error: ev.message || "更新失败" };
						default:
							return prev;
					}
				});
			});
		}

		function doCheckFramework(setState) {
			setState({ phase: "checking", current: null, latest: null, percent: 0, error: null, dismissed: false });
			if (window && window.hdsh && window.hdsh.getVersions) {
				window.hdsh.getVersions().then((v) => {
					setState((prev) => ({ ...prev, current: (v && v.framework) || null }));
				}).catch(() => {});
			}
			if (window && window.hdsh && window.hdsh.checkUpdate) {
				window.hdsh.checkUpdate().catch((e) => {
					setState((prev) => ({ ...prev, phase: "error", error: String((e && e.message) || e) }));
				});
			} else {
				setState((prev) => ({ ...prev, phase: "error", error: "更新通道不可用" }));
			}
		}

		function doUpdateFramework(setState) {
			setState((prev) => ({ ...prev, phase: "downloading", percent: 0, error: null }));
			if (window.hdsh && window.hdsh.downloadUpdate) {
				window.hdsh.downloadUpdate().catch((e) => {
					setState((prev) => ({ ...prev, phase: "error", error: String((e && e.message) || e) }));
				});
			}
		}

		function doCheckWebui(setState) {
			setState({ phase: "checking", result: null, error: null, msg: null, dismissed: false });
			checkWebui().then((res) => {
				if (!res) return setState({ phase: "error", result: null, error: "无响应", msg: null, dismissed: false });
				if (res.error) return setState({ phase: "error", result: res, error: res.error, msg: null, dismissed: false });
				setState({ phase: "checked", result: res, error: null, msg: null, dismissed: false });
			}).catch((e) => {
				setState({ phase: "error", result: null, error: String((e && e.message) || e), msg: null, dismissed: false });
			});
		}

		function openRepo(result) {
			if (window && window.hdsh && window.hdsh.openUrl && result && result.repoUrl) {
				window.hdsh.openUrl(result.repoUrl).catch(() => {});
			}
		}

		// ---- 框架组渲染(转圈 + tips + 进度条) ----
		function renderFrameworkGroup(state, setState) {
			const h = react.createElement;
			const busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "installing";
			const els = [];
			els.push(h("div", { className: "updchk-line" },
				h("div", { className: "updchk-info" },
					h("div", { className: "updchk-name" }, "本框架(HelloDeepseekHarness / HDSH)"),
					h("div", { className: "updchk-repo" }, "发布源:github.com/FeatherCloudSky/HDSH Releases")
				),
				h("button", { className: "updchk-btn", disabled: busy, onClick: () => doCheckFramework(setState) },
					state.phase === "checking" ? "检查中…" : "检查框架更新")
			));
			els.push(h("div", { className: "updchk-note" }, "一键自动更新:发现新版本后点击「立即更新」,自动下载、安装并重启应用,无需手动前往官网下载。"));

			if (state.phase === "idle") {
				els.push(h("div", { className: "updchk-status" }, "未检查 · 点击上方按钮开始"));
			} else if (state.phase === "checking") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner" }),
					"正在检查更新…"));
			} else if (state.phase === "checked") {
				const cur = state.current ? "v" + state.current : "未知";
				if (state.latest) {
					els.push(h("div", { className: "updchk-vers" }, "当前版本:" + cur + "　·　最新版本:v" + state.latest));
					if (!state.dismissed) {
						els.push(h("div", { className: "updchk-confirm" },
							h("span", { className: "updchk-warn" }, "⚠ 发现新版本,是否立即更新?"),
							h("button", { className: "updchk-btn updchk-btn-primary", onClick: () => doUpdateFramework(setState) }, "立即更新"),
							h("button", { className: "updchk-btn", onClick: () => setState((prev) => ({ ...prev, dismissed: true })) }, "暂不更新")
						));
					} else {
						els.push(h("div", { className: "updchk-status updchk-warn" }, "已忽略本次更新提醒(可再次点击按钮重新检测)"));
					}
				} else {
					els.push(h("div", { className: "updchk-status updchk-ok" }, "✓ 已是最新版本 " + cur));
				}
			} else if (state.phase === "downloading") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner updchk-spinner-big" }),
					h("span", null, "正在下载更新… " + (typeof state.percent === "number" ? state.percent + "%" : ""))));
				els.push(h("div", { className: "updchk-progress" },
					h("i", { style: { width: (typeof state.percent === "number" ? state.percent : 0) + "%" } })));
				els.push(h("div", { className: "updchk-tip" }, "下载期间请保持应用开启,可继续使用其它功能"));
			} else if (state.phase === "installing") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner updchk-spinner-big" }),
					h("span", null, "下载完成,正在安装…")));
				els.push(h("div", { className: "updchk-tip" }, "安装完成后应用将自动重启,请稍候"));
			} else if (state.phase === "error") {
				els.push(h("div", { className: "updchk-status updchk-err" }, "✗ " + (state.error || "更新失败")));
				els.push(h("button", { className: "updchk-link", onClick: () => openRepo({ repoUrl: "https://github.com/FeatherCloudSky/HDSH/releases/latest", repoLabel: "HDSH 发布页" }) }, "打开 HDSH 发布页 ↗"));
			}
			return h("div", { className: "updchk-group" }, els);
		}

		// ---- WebUI 组渲染 ----
		function renderWebuiGroup(state, setState) {
			const h = react.createElement;
			const busy = state.phase === "checking";
			const result = state.result;
			const els = [];
			els.push(h("div", { className: "updchk-line" },
				h("div", { className: "updchk-info" },
					h("div", { className: "updchk-name" }, "WebUI(官方 DeepSeek Harness 界面)"),
					h("div", { className: "updchk-repo" }, "官方仓库:github.com/deepseek-ai/deepseek-harness")
				),
				h("button", { className: "updchk-btn", disabled: busy, onClick: () => doCheckWebui(setState) },
					state.phase === "checking" ? "检查中…" : "检查 WebUI 更新")
			));
			els.push(h("div", { className: "updchk-note" }, "WebUI 为官方 DeepSeek Harness 的浏览器界面组件,随本框架安装包一起分发,随框架更新一并升级。"));

			if (state.phase === "idle") {
				els.push(h("div", { className: "updchk-status" }, "未检查 · 点击上方按钮开始"));
			} else if (state.phase === "checking") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner" }),
					"正在检查更新…"));
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
					els.push(h("div", { className: "updchk-status updchk-warn" }, "⚠ 官方 WebUI 有新版本,将随下次框架更新一并升级"));
				} else {
					els.push(h("div", { className: "updchk-status updchk-ok" }, "✓ 已是最新版本"));
				}
				if (result && result.repoUrl) {
					els.push(h("button", { className: "updchk-link", onClick: () => openRepo(result) }, "打开" + (result.repoLabel || "仓库") + " ↗"));
				}
			}
			return h("div", { className: "updchk-group" }, els);
		}

		function UpdateRow() {
			const h = react.createElement;
			const [framework, setFramework] = react.useState({ phase: "idle", current: null, latest: null, percent: 0, error: null, dismissed: false });
			const [webui, setWebui] = react.useState({ phase: "idle", result: null, error: null, msg: null, dismissed: false });
			react.useEffect(() => subscribeUpdater(setFramework), []);
			return h("div", { className: "updchk-row" },
				h("div", { className: "updchk-head" },
					h("div", { className: "updchk-title" }, "更新检测"),
					h("div", { className: "updchk-desc" }, "一键自动更新框架;检测 WebUI 官方最新版本。发现新版本时会询问是否更新。")
				),
				renderFrameworkGroup(framework, setFramework),
				renderWebuiGroup(webui, setWebui)
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
