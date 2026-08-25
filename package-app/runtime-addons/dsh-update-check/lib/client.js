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

		// ---- 框架标准通道事件(electron-updater;一键更新回退到标准下载时使用) ----
		function subscribeUpdater(setState) {
			if (!window || !window.hdsh || !window.hdsh.onUpdateEvent) return () => {};
			return window.hdsh.onUpdateEvent((ev) => {
				setState((prev) => {
					switch (ev.type) {
						case "download-progress":
							return { ...prev, phase: "downloading", percent: typeof ev.percent === "number" ? ev.percent : prev.percent, error: null };
						case "update-downloaded":
							// 标准通道下载完成 → 提示后自动安装并重启
							setTimeout(() => {
								if (window.hdsh && window.hdsh.installUpdate) window.hdsh.installUpdate().catch(() => {});
							}, 1800);
							return { ...prev, phase: "installing", error: null };
						case "error":
							if (prev.phase === "downloading" || prev.phase === "installing") {
								return { ...prev, phase: "error", error: ev.message || "更新失败" };
							}
							return prev;
						default:
							return prev;
					}
				});
			});
		}

		// ---- 统一更新事件(主进程编排:修复 WebUI → 加速下载 → 校验 → 安装) ----
		function subscribeAll(setState) {
			if (!window || !window.hdsh || !window.hdsh.onUpdateAllEvent) return () => {};
			return window.hdsh.onUpdateAllEvent((ev) => {
				setState((prev) => {
					switch (ev.type) {
						case "repairing":
							return { ...prev, phase: "repairing", repairVersion: ev.version || prev.repairVersion, error: null };
						case "repair-downloading":
							return { ...prev, phase: "repairing", percent: typeof ev.percent === "number" ? ev.percent : prev.percent, error: null };
						case "extracting":
							return { ...prev, phase: "repairing", percent: 100, error: null };
						case "downloading":
							return { ...prev, phase: "downloading", percent: typeof ev.percent === "number" ? ev.percent : prev.percent, speed: typeof ev.bytesPerSecond === "number" ? ev.bytesPerSecond : null, error: null };
						case "verifying":
							return { ...prev, phase: "verifying", error: null };
						case "installing":
							return { ...prev, phase: "installing", error: null };
						case "fallback":
							return { ...prev, phase: "downloading", percent: 0, tip: "加速通道不可用,已切换标准通道下载…", error: null };
						case "done":
							return { ...prev, phase: "done", error: null };
						case "error":
							return { ...prev, phase: "error", error: ev.message || "更新失败" };
						default:
							return prev;
					}
				});
			});
		}

		function doCheckAll(setState) {
			setState({ phase: "checking", check: null, percent: 0, speed: null, tip: null, error: null, dismissed: false, repairVersion: null });
			const hdsh = (window && window.hdsh) || {};
			if (!hdsh.checkAll) {
				return setState({ phase: "error", check: null, error: "当前版本不支持统一更新,请先升级框架", dismissed: false });
			}
			hdsh.checkAll().then((res) => {
				if (!res || !res.ok) {
					return setState({ phase: "error", check: res || null, error: (res && res.error) || "检查失败", dismissed: false });
				}
				setState({ phase: "ready", check: res, error: null, dismissed: false });
			}).catch((e) => {
				setState({ phase: "error", check: null, error: String((e && e.message) || e), dismissed: false });
			});
		}

		function doRunAll(setState) {
			const hdsh = (window && window.hdsh) || {};
			if (!hdsh.runUpdateAll) {
				return setState((prev) => ({ ...prev, phase: "error", error: "更新通道不可用" }));
			}
			setState((prev) => ({ ...prev, phase: "preparing", percent: 0, speed: null, error: null, tip: null, dismissed: false }));
			hdsh.runUpdateAll().catch((e) => {
				setState((prev) => ({ ...prev, phase: "error", error: String((e && e.message) || e) }));
			});
		}

		function openRepo(result) {
			if (window && window.hdsh && window.hdsh.openUrl && result && result.repoUrl) {
				window.hdsh.openUrl(result.repoUrl).catch(() => {});
			}
		}

		// ---- 统一渲染:一次检查,分行显示框架 / WebUI 版本号,一键完成全部更新 ----
		function renderUnified(state, setState) {
			const h = react.createElement;
			const busy = ["checking", "preparing", "repairing", "downloading", "verifying", "installing"].indexOf(state.phase) !== -1;
			const els = [];
			els.push(h("div", { className: "updchk-line" },
				h("div", { className: "updchk-info" },
					h("div", { className: "updchk-name" }, "框架(HelloDeepseekHarness)+ WebUI(官方界面)"),
					h("div", { className: "updchk-repo" }, "框架源:HDSH Releases · WebUI 源:官方 npm")
				),
				h("button", { className: "updchk-btn", disabled: busy, onClick: () => doCheckAll(setState) },
					state.phase === "checking" ? "检查中…" : "一键检查更新")
			));
			els.push(h("div", { className: "updchk-note" }, "一次检查框架与 WebUI 的新版本(分开显示版本号),检测到任一新版本都会提示;一键更新自动完成:先修复 WebUI(如需)→ 下载新框架(多连接加速)→ 校验 → 静默安装并重启。"));

			if (state.phase === "idle") {
				els.push(h("div", { className: "updchk-status" }, "未检查 · 点击上方按钮开始"));
			} else if (state.phase === "checking") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner" }),
					"正在检查框架与 WebUI 更新…"));
			} else if (state.phase === "error") {
				els.push(h("div", { className: "updchk-status updchk-err" }, "✗ " + (state.error || "更新失败")));
				els.push(h("button", { className: "updchk-link", onClick: () => openRepo({ repoUrl: "https://github.com/FeatherCloudSky/HDSH/releases/latest", repoLabel: "HDSH 发布页" }) }, "打开 HDSH 发布页 ↗"));
			} else if (state.phase === "ready") {
				const c = state.check || {};
				const fw = c.framework || {};
				const wb = c.webui || {};
				// 框架行
				let fwText;
				if (fw.skipped) fwText = "开发模式,跳过检查";
				else if (fw.error) fwText = "检查失败(" + fw.error + ")";
				else if (fw.updateAvailable) fwText = "当前 v" + fw.current + " · 最新 v" + fw.latest;
				else fwText = "当前 v" + (fw.current || "?") + " · 已是最新";
				els.push(h("div", { className: "updchk-vers" },
					h("span", null, "【框架】" + fwText),
					fw.error ? h("span", { className: "updchk-err" }, "　✗")
						: fw.updateAvailable ? h("span", { className: "updchk-warn" }, "　⚠ 可更新")
						: h("span", { className: "updchk-ok" }, "　✓")
				));
				// WebUI 行
				let wbText;
				let wbCls = "updchk-ok";
				let wbMark = "✓";
				if (wb.error) {
					wbText = "检查失败(" + wb.error + ")";
					wbCls = "updchk-err"; wbMark = "✗";
				} else if (wb.mismatch && wb.repairVersion) {
					wbText = "当前 " + wb.current + " · 与服务端 " + wb.server + " 不匹配,将修复为 v" + wb.repairVersion;
					wbCls = "updchk-warn"; wbMark = "⚠";
				} else if (wb.needFrameworkUpdate && wb.officialLatest) {
					if (fw.updateAvailable) {
						wbText = "当前 " + wb.current + " · 官方最新 " + wb.officialLatest + "(将随框架 v" + fw.latest + " 一并安装)";
					} else {
						wbText = "当前 " + wb.current + " · 官方最新 " + wb.officialLatest + "(需配套新框架,请等待框架发布)";
						wbCls = "updchk-warn"; wbMark = "⚠";
					}
				} else {
					wbText = "当前 " + (wb.current || "?") + " · 已与服务端配套";
				}
				els.push(h("div", { className: "updchk-vers" },
					h("span", null, "【WebUI】" + wbText),
					h("span", { className: wbCls }, "　" + wbMark)
				));
				// 更新确认 / 状态
				if (c.anyUpdate) {
					if (!state.dismissed) {
						const items = [];
						if (fw.updateAvailable) items.push("框架 → v" + fw.latest);
						if (wb.mismatch && wb.repairVersion) items.push("WebUI 修复 → v" + wb.repairVersion);
						els.push(h("div", { className: "updchk-confirm" },
							h("span", { className: "updchk-warn" }, "⚠ 发现 " + items.length + " 项更新:" + items.join("、") + ",是否一键更新?"),
							h("button", { className: "updchk-btn updchk-btn-primary", onClick: () => doRunAll(setState) }, "一键更新"),
							h("button", { className: "updchk-btn", onClick: () => setState((prev) => ({ ...prev, dismissed: true })) }, "暂不更新")
						));
					} else {
						els.push(h("div", { className: "updchk-status updchk-warn" }, "已忽略本次更新提醒(可再次点击按钮重新检测)"));
					}
				} else {
					els.push(h("div", { className: "updchk-status updchk-ok" }, "✓ 框架与 WebUI 均为最新"));
				}
			} else if (state.phase === "preparing") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner" }), "正在准备更新…"));
			} else if (state.phase === "repairing") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner updchk-spinner-big" }),
					h("span", null, "正在修复 WebUI" + (state.repairVersion ? "(→ v" + state.repairVersion + ")" : "") + "… " + (state.percent > 0 ? state.percent + "%" : ""))));
				els.push(h("div", { className: "updchk-progress" },
					h("i", { style: { width: (state.percent || 0) + "%" } })));
				els.push(h("div", { className: "updchk-tip" }, "下载与当前框架服务端配套的界面并替换"));
			} else if (state.phase === "downloading") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner updchk-spinner-big" }),
					h("span", null, "正在下载框架更新… " + (typeof state.percent === "number" ? state.percent + "%" : "")
						+ (state.speed ? "(" + (state.speed / 1048576).toFixed(1) + " MB/s)" : ""))));
				els.push(h("div", { className: "updchk-progress" },
					h("i", { style: { width: (typeof state.percent === "number" ? state.percent : 0) + "%" } })));
				els.push(h("div", { className: "updchk-tip" }, state.tip || "多连接加速下载,期间可继续使用其它功能"));
			} else if (state.phase === "verifying") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner updchk-spinner-big" }), "正在校验安装包完整性…"));
			} else if (state.phase === "installing") {
				els.push(h("div", { className: "updchk-status" },
					h("span", { className: "updchk-spinner updchk-spinner-big" }),
					h("span", null, "下载完成,正在安装…")));
				els.push(h("div", { className: "updchk-tip" }, "应用将自动重启并完成安装,请稍候"));
			} else if (state.phase === "done") {
				els.push(h("div", { className: "updchk-status updchk-ok" }, "✓ 更新完成"));
			}
			return h("div", { className: "updchk-group" }, els);
		}

		function UpdateRow() {
			const h = react.createElement;
			const [st, setSt] = react.useState({ phase: "idle", check: null, percent: 0, speed: null, tip: null, error: null, dismissed: false, repairVersion: null });
			react.useEffect(() => subscribeUpdater(setSt), []);
			react.useEffect(() => subscribeAll(setSt), []);
			return h("div", { className: "updchk-row" },
				h("div", { className: "updchk-head" },
					h("div", { className: "updchk-title" }, "更新检测"),
					h("div", { className: "updchk-desc" }, "一键检查并更新框架与 WebUI:检测到任一新版本都会提示(分开显示版本号),一键完成全部更新操作。")
				),
				renderUnified(st, setSt)
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
