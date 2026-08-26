// WhaleBox 鲸盒 玻璃窗口壳 — 预加载脚本(沙箱内,内嵌样式)
// 职责:向 WebUI 页面注入顶部玻璃横栏(左侧品牌、右侧悬浮胶囊按钮组),
//       按钮真实控制窗口(经 IPC),外观采用毛玻璃质感样式。
const { ipcRenderer, contextBridge } = require('electron');

// 内置更新检测桥:向页面主世界暴露 window.hdsh(沙箱 preload 只能经 IPC 触达主进程)
contextBridge.exposeInMainWorld('hdsh', {
  // 当前版本:{ framework, webui }
  getVersions: () => ipcRenderer.invoke('hdsh:get-versions'),
  // 下载框架安装包到「下载」文件夹并打开:{ url, fileName } → { ok, message }
  downloadFramework: (payload) => ipcRenderer.invoke('hdsh:download-framework', payload),
  // 用系统默认浏览器打开链接:url → { ok, message }
  openUrl: (url) => ipcRenderer.invoke('hdsh:open-url', url),
  // ---- 一键自动更新(electron-updater) ----
  // 检查更新:触发 checkForUpdates,结果经 onUpdateEvent 回报
  checkUpdate: () => ipcRenderer.invoke('hdsh:updater-check'),
  // 下载更新(检查到新版本后调用);进度经 download-progress 事件回报
  downloadUpdate: () => ipcRenderer.invoke('hdsh:updater-download'),
  // 安装并重启(下载完成后调用)→ { ok }
  installUpdate: () => ipcRenderer.invoke('hdsh:updater-install'),
  // 订阅更新事件:cb({ type, ... }) → 返回退订函数
  // type: checking-for-update | update-available | update-not-available
  //       | download-progress | update-downloaded | error
  onUpdateEvent: (cb) => {
    const listener = (_e, data) => { try { cb(data); } catch (_) {} };
    ipcRenderer.on('hdsh:updater-event', listener);
    return () => ipcRenderer.removeListener('hdsh:updater-event', listener);
  },
  // ---- WebUI 单独更新(不重装框架) ----
  // 检查:→ { ok, current, latest, source, updateAvailable, sameLine, error? }
  webuiCheck: () => ipcRenderer.invoke('hdsh:webui-check'),
  // 下载指定版本(下载+解压校验,不生效)→ { ok, version, error? }
  webuiDownload: (version) => ipcRenderer.invoke('hdsh:webui-download', { version }),
  // 应用下载好的更新(替换 dist + 重启服务 + 刷新窗口)→ { ok, version, restarted, error? }
  webuiInstall: () => ipcRenderer.invoke('hdsh:webui-install'),
  // 订阅 WebUI 更新事件:cb({ type, ... }) → 返回退订函数
  // type: downloading({ percent }) | extracting | downloaded({ version })
  //       | installing({ version }) | done({ version }) | error({ message })
  onWebuiEvent: (cb) => {
    const listener = (_e, data) => { try { cb(data); } catch (_) {} };
    ipcRenderer.on('hdsh:webui-event', listener);
    return () => ipcRenderer.removeListener('hdsh:webui-event', listener);
  },
  // ---- 统一更新(框架 + WebUI 一次检查、一键完成) ----
  // 一次检查框架与 WebUI:→ { ok, framework:{current,latest,updateAvailable,skipped,error},
  //   webui:{current,server,officialLatest,mismatch,repairVersion,needFrameworkUpdate,error},
  //   actions:['webui-repair'?,'framework-update'?], anyUpdate }
  checkAll: () => ipcRenderer.invoke('hdsh:check-all'),
  // 一键完成全部更新:修复 WebUI(如需)→ 加速下载框架 → 校验 → 静默安装重启
  runUpdateAll: () => ipcRenderer.invoke('hdsh:update-all-run'),
  // 订阅统一更新事件:cb({ type, ... }) → 返回退订函数
  // type: repairing({ version }) | repair-downloading({ percent }) | extracting
  //       | downloading({ percent, bytesPerSecond }) | verifying | installing
  //       | fallback({ message }) | done | error({ message })
  onUpdateAllEvent: (cb) => {
    const listener = (_e, data) => { try { cb(data); } catch (_) {} };
    ipcRenderer.on('hdsh:update-all-event', listener);
    return () => ipcRenderer.removeListener('hdsh:update-all-event', listener);
  }
});

// 鲸鱼 logo(内嵌 base64;沙箱 preload 无法读取文件系统)
const LOGO_DATA = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAgAAAAIACAYAAAD0eNT6AAAQAElEQVR4nOzdB7gV1bnG8XcQ6SIqIEUUFQSliIpgAwlYEDF2Y4mxt9h7jC2xa9RoLDeJmtg1sZcYexALKEURpIgFRUAQKSICisxd356DHpGyzznT5/97nnUHAW/kAPt7Z5Vv1RZSxff9Nd1jUzc6utHWjcZuNHSjUcWz8rcrf19DAUA85lcaXy/zrPztr9yY5MY4N8Z7njdXSA1PiJ0r8vZ1X09BkV9a7JeOlgKAfJrmxviKMW7pt10wmCzEjgAQA1fw13aPvm70caOngqLPGzsABOa5McGNoW4McmOwCwVfCJEiAERgmYJvYzPxtQaAcvluvKcgDNggEESAohQCV/CbuceOouADQBQIBBGgSFWTK/prucf+bhziRi/xtQSAuFggGOzGvW78y4WBeUKVUbSqwBX9Ou6xp4Kiv5sbdQQASNJCN55UEAaec2HgW6EsBIBVqNixb2/4VvTtjX8tAQDSaLYb/1YQBl53YcAXVogAsAKu8Hd2j1+7cZAb6wsAkCWfunG/G/e5IDBG+BkCwDJc4e/uHue5sZcbtQQAyLIlbjzmxlUuCAwXfkAAqOAKfz8Fhb+fAAB59KIbV7og8LJQ7ADgir694dubvhX+7gIAFMEwN6504wkXBpaooAoZAFzhX13B+v65bnQQAKCIrBXx1Qr2CXyngilUAHCF39rvHuPGmQp68QMA8Jkb17pxuwsC81UQhQkArvjv6x5/dqONAAD4OTs5cKoLAY+rAHIfAFzh39g9/q6gNz8AAKtimwSPdUHgQ+VYbo+5ucLfwI1LFfSPpvgDAMplNeM9V0P+aLVEOZXLGQD3GzbQPW4V0/0AgJqZ7MZv3WzA08qZXM0A2HS/G0+5b9qg+AMAaspqyVNWWyqWlHMjFzMAFVM0dpb/bDfqCgCA8C1ScGzwCjcjsEgZl/kAUHEt74Nu7CIAAKL3vBsHuhAwWxmW6SUAV/x3cI9RovgDAOJjNWdURQ3KrEwGAPdFX82Ni9w3B4m1fgBA/Kz2DHK16EKrScqgzC0BuC/0uu7xsBuZTl4AgNx4zY393JLAdGVIpmYAXPEvTbuI4g8ASI/ScnRFjcqMTASAiin/a9w3n3VjXQEAkC5Wm551teqqrCwJpH4JoOKIn0357yYAANLPmgYdmPaLhVIdAFzxb+Yez7jRXQAAZMdbbuzqQsAcpVRqA4Ar/nZd7yA3ctV5CQBQGKPd2N2FgMlKoVTuAXDFv5N7DBHFHwCQXV3ceN3VtC5KodTNALgvlE33v+jGmgIAIPtsGcCWA95SiqRqBsAVf9vo94oo/gCA/GjixssVN9WmRmoCgPvCHKngFr/c3r0MACishm485mrdgUqJVAQA9wU5zT3ucCOT7RQBAChDbTfudzXvLKVA4nsA3BfiIPe4XwAAFMMSNw7zPO9eJSjRAFCxHvKYglQEAEBRLFawMfBlJSSxAOCK/9buMdiNegIAoHjmubFTUqcDEgkAFef8bbf/OgIAoLi+dKOnCwEfKmaxBwBX/Fu5xzA3WgkAAFjx7+1CwFTFKNZTAK742xv/86L4AwCwlHW9fc7VyDUUo9gCgPuF2Vr/f93oJAAAUFlnNx6vqJWxiCUAuF+Q7fJ/yI2tBQAAlqevG/9yNTOW2hzXDMBlbqSqBSIAACn0SzeuUAwi3wTokkw/Bev+qbx5EACAlLFGQdYj4EVFKNIA4Ip/C/d4240WAgAA5frcjc1cCJitiET9Vm5tDin+AABUjdXO2xShyAJAxQU//QQAAKpj34paGolIlgAqOv2NdKOOAABAdX3rxlZuKWCMQhb6DIAr/g3c41+i+AMAUFNWSx9wtbWhQhbFEsCtotkPAABhsSZB1ylkoS4BuIRyoHs8IAAAELb93FLAIwpJaAHAFf+m7jHOjaYCAABhm+nGpi4EzFQIwlwCsG5/FH8AAKJhNfYyhSSUGQD39t/dPYa6sZoAAEBUvndjWzcLMEw1VOMA4Iq/FX0r/t0FAACiNswFgB6qoTCWAI4RxR8AgLhs7V6+D1cN1WgGgI1/AAAkosYbAms6A8DGPwAA4lfjDYHVngFg4x8AAImq0YbAagUANv4BAJAK1d4QWN0lADb+AQCQvGpvCKzyDID7H6rvHh+60VIAACBpU91o52YCFlTlX6rODMBhovgDAJAWrRTU5iqp0gyAe/uv7R5j3WgvAACQFu+70cnNAixWmao6A7CfKP4AAKTNJgpqdNnKngFwb//2c4e7saUAAEDaWI3u4WYB/HJ+clVmAHYVxR8AgLSy03m7lvuTqxIAficAAJBmZdfqspYA3PT/Nu4xRAAAIO2sO+DQVf2kcmcAePsHACAbyqrZq5wBcG//tut/gmp4cyAAAIiFbQLs6GYB3l/ZTypnBuBEUfwBAMgKq9m/LecnrVDF0b/P3WguAACQFdPdaLmyI4GrmgHYURR/AACyZl0FNXyFVhUADhcAAMiiw1f2gytcAnDT/43cY5objQQAALJmnhut3TLAvOX94MpmAAaK4g8AQFat4cbuK/rBlQWAAwUAALJshbV8uUsAbvrfNv595sbqAgAAWfWdG23cMsD0ZX9gRTMAB4viDwBA1lkt33t5P7CiAMD0PwAA+bDcmv6zJQA3/d/EPWaJ7n8AAOTBEjeauWWAWZW/c3kzAH1E8QcAIC+s1vde3ncuq48AAECe9Fn2O2ov5yf1FwAAyJM+y37HT6b6fd9v6x4fCwAA5MnP9gEsuwTQRwAAIG9+tg+AAAAAQDH8ZImfAAAAQDH0d0v99Zf+ww8BoGL9fwMBAIA8shq/+dJ/qDwD0EcAACDPui39BgEAAIDi2GbpNyr3AegjAACQZz8EgFIfAN/3V3OPRW6sJgAAkFffu1HX87zvly4BtBHFHwCAvLNabzX/hz0AHQUAAIqgVPMJAAAAFEup5teu/A8AACD32tr/IQAAAFAsP5kBaCsAAFAEpQDg+b7fyD3niFMAAAAUQekooM0AtBPFHwCAorCa394CQFsBAIAi6WgBoIUAAECRtLAA0EQAAKBImhAAAAAoHgIAAAAFRAAAAKCA6lkAqCcAAFAkBAAAAAqIJQAAAAqIAAAAQAERAAAAKCACAAAABVTPbgP0BQAAimQRAQAAgAKqJQAAUDgEAAAACogAAABAAREAAAAoIAIAAAAFRAAAAKCACAAAABQQAQAAgAIiAAAAUEC1BQAFN2ee9PY4afqX0obrST27CMg9AgCAQvt0mnThTb5mf/Xj963fUjr/OE8tmwrILZYAABTa1Xf8tPgbCwXnXudr/gIBuUUAAFBYDz0nTf58+T9mywKPv8RdacgvAgCAQpo5R7rnqZUX+BeGCMgtAgCAQnrsxVW/3c+aK02YJCCX2AQIFMQ3CyuGW9desEj69rsff6z2alKbFlKjBiqEr7+Rnnu9vJ87bLSvDm09AXlDAAByxN5W33dj6gxfX7q31y9nq/S0N9lyNF1L2mQDqeNGnjptLLXfQLn01KCfBqCVGT5W+vUeAnKHAABk1JQZQbH/cLKvcR9KEz9Vjc2cHYw33gmmx9doKPXrKf1qN08N6ysXFn0rPfm/8jf3fTQ5CFBrrykgVwgAQEZ84Ar88PeksR/6mviJYjmiNm++9PjL0qsjfV38W09tWynzXnij6l+7t0ZL/XcQkCue7whA6ixZIo35QBo6ytfQd4M38yTZ8sA/Ls3+WviRF/pV/lpusan0xxPZB4B8YQYASJmxbjr/leG+Bg9XqhrRWNG0s/FN1lBmfTylekHK2gTbxsGibJJEMRAAgBSwwjTYiv4I6YtZSp06q0uH/tLLdPE3NpVfXS8NlfbsKyA3CABAQqbNlAa95dbXR/j6bLpSaa3G0oG7eerbU6pbR5k3fEz1VzyfedV3AYBlAOQHAQCI0VdfB+fPB7ui/8lUpdrAPtJh7q0/D4Xf2IbGmjT1mfaF9Oa7Us+uAnKBAADEwHbtP/2Kr1dHSosXK9Vqu0+F0w/11Gsr5YqdoKipWx7w1bWDp/p1BWQeAQCZYb3b7dY2e5OzBjez50kLFvr6bnHQ1OU7G/btxcG37ftWWy2Yuv7JWN2eXsXzp8M+2NddR2q2tmrM/vdfG2lNZ3x9OFmZYJvcbLd7HhsADRtT8wNPtgny7id8HXcASwHIPgIAUuPzmUFzm6kz7OmXply/rFT0w7XyYrC6+5uxQSupZTNrkeupdXNpvRbShq21SraL/+U3fb0yPGg6kxXW6ObyU9yvdV3l0riPFIr/DJY6tZN22FJAphEAEDvrWPfpVFtT9TVparC2uqIrWZNiMwnWeOeDUne9n4aF5m52oFXzIAy0bOaVzsd/9JlbX/7Y1/iPowgr8bjohPwWfztOaWEyLDfc42vdpm6mZH0BmUUjIETu02nSu+9Loyb4GjMxXWfbETj7iPyt+VdmDZV+f0O4H3X160mXnZzP5RIUAzMACJ2tk44cGxT8d8YHU/hIr97dlevibz6N4MTFgoXSeS5UnHyIpx27C8gcAgBCYdOrLw61TW/pP96GH9WrIx21T/43tH0yLZqJTtvoed2dQdA9/oD8HJlMA9uzMdrNHDZpLO2ynRABAgCqbfH3wbnoF4f4GjnOrZSzmJQ5Bw7wSs1+8m7SFEXKugSOmejr1F976txeqIHpX0rX3OH/5HbLR1+UzjnS00brCSFiDwCqzDbtPfu6r+dfZz0/6+672itd+Zt3vznPLy1NxaFnF/e/t6enNi2EKrKW2Off6JfuXVieK04lYIWJGQCUzS6nsXaodswN2bddNxWi+JsFixSbN0fb8Evtk611cDlHR6HSiaCVFX9zrVtuufVCTw3qCSEgAGCl7By73Z/+8Au+Zs0VcmTrzsVpZpNEP4aX3wz6QXRoK+23i0cL4ZWwk0IX/GXlxd/YZ9Arw6TdegkhIABguWxq/7GXfD0zWKv8S4lsCqPbYRZ8s1CJsvsHLv+7r3brSwcN8FzwEiqx3hmX/J9f9ufM0Hd9FwDoxBgGAgB+wnaE2G7+u57wSxfXIL8IAPGyplKX/tUvNQ86kCBQ8sY70lW3V20b2uRpQkgIAPiB7ZS+9cGgmx3yrygX2ixISQBYamJFEOjWUTrpYK/UWbKI3hpd9eJvZobY0bHoCAAobZC650lfT78iFIj1bmiyhnIvbQFgKesdcMIlvg7e3dO+O6tQXh0h/emfHEBLGgGg4Gxn/+2PxHdECulhAWDjNsq975cotezOCVtus7fh3x/rac1Gyr1/PSvd93T1i39RTq7EoZZQSDNnS3+81S8dq6H4F9O4j4rxBlZndaWedb079Upf709SbtklWZf9za9R8TfrNBFCQgAooCf+Jx3vph5HjBUKbNAwFUKjBsoEO+J21rW+ho5S7tjV2CdcGsx01FRTAkBoWAIoELty9893+xVX3KLobAnAbmnsuolyLWtTxlfc5uuC4zz16KLMsw3FtsQY5syGXb+NcDADUBCPvyydeBnF3MghiQAAEABJREFUHz9195P5XwbIYtc4myq3+zWyyi4Esx3+51wX/rJG0yb0AAgLMwA5Z5uM7K3/tZECfsY+nO0im37bKNcaN1Lm+lrYhTi3XOBlYs3bbkW0Pv5vu9AybPRPL/IJW6vmQkgIADlm52Wtw1bUN6Eh2+583Nc2m3tqWF+51bhh9gKANTC6/i5fl58azxvvtJnSjC+D2/hseeirr/1SR1AbdlTY/ius+NrtkUvcxNHsuSptILaf/2mMzXlaryuEhACQU9Z+1Iq/7bwFVmauK4x/uNUVmlO8TOyYr46sbARc1uiJ0hMv26VCCp19Rowa78YEv/S/U+5/T9JaNhNCQgDIoRHvBRuJbPofKMeEj92U8z+CzWd5lOWz4/c8ZTcLhnNt85gPpNdG+KVd+Vm8yttOANSrI4SEAJAzLwyRbrqPDluoOjuideO9vk79df5CwHpu2njYGGWSra8/9JyvI/ep3u/Lwm+l/w6247/Zv9GzCI2r4kQAyJF/Pyvd+zTFH9VnGwI/nOzr9N/k6x77tq2teGb374a16f7lL6p2BM5aID85yJYQ/Nzc6NluA04AhIljgDlgN/j97d8+xR+hsE2jp18ddGxbnJNlpLYZDzOLv5eeebW8v9/2efDs69LRFwe/h3m6ztuuVEZ4CAAZZ7txrZ3vfwYLCM2SJUHP9lNy0p42D7MZ5XRutJbCp13l69YH8rkBuENbIUQEgIy7+na/dLMWEIXPpqvUzMVml9J8qU452rZSptn9HVbgV+TB/0rnXu+XzuPnkf3+ZfU0R1oRADLKpvmuvsPXkBz2DUe62CyT7S85wy0LWCDIqg3XU+a9MuznywC2SdCu1r3/P/leAuyS85bVSSAAZJQ1b3n9bQGxsTfL317q68n/KZM2XC/7G8jeXqY9sDXi+d2fizEL2KU9GwDDRgDIIFvvf+wlAYmwy10u+ItfaiCUJV3aK/OsW9/So3xfzAqWZ4pyvwczAOEjAGTMG+8EO/6BJNktgidfnq0NgnaG3NrYZt2YidLUGdLZrvh/PlOF0NmFtzy3qk4KASBD7IIN2/EPpIFNP9v99U8NUmZsv4Uy78Whvs65PvtNfaqiRxem/6NAAMgIu3DjD7fk51w28uO2h/1SG2HrOJd2dulR1r0zPnsXG9VUj85CBAgAGWC3gl10Mxf7IL3suumz/uRrxiylWtdNmErOmo3acAVwVAgAGXDlbb6mfSEg1exK2DOuifYu+DD07CpkSN8eTP9HhQCQctaNbdQEAZlgU9Pn/dnX0BT3p9i2GwUlS/r2FCJCAEgx6/qV9+YeyB9rTGPXUT+R0n4BPbsE18oi/bbrRve/KBEAUsrW+23q36f+I6PueMTXX1N6ZHXPvswCZMHAPvw+RYkAkFLX3+2XjlkBWfbM4KBlddruEdhlO6l+XSHF1ltX6txOiBABIIXs1q8R7wnIBWtZfdVt6ZoJqF9P6r+DkGJ79+PtP2oEgJSxt/7/+xfz/siXN0er1D7Y9gekxR6/8ORRY1JpnSZSv22EiBEAUubGe3wtWCggd6x98Pk3+qW+FmlgGwF7bSmk0KF7eKpFdYocX+IUeWW4m/ofKyC3JkwKQsDX3ygVDujPFEDatGnB0b+4EABSwqb+ueQHRfDh5OAK2zS0s12/pbTPTkKKHLs/oSwuBICUsKn/tLwVAVGzroHnXp+Oky4H7+7RFyAlenSRNu8gxIQAkAKvjmDqH8Uzxa60vTb5EFBndenEg3jrTFrt2tLxB/D7ECcCQMIWfSvd/ghT/ygmu+XSLhGaOUeJ2qpT0HUOyTl4gJuJWUuIEQEgYY+84Gv2VwIKy24Q/J1bDrAwkKTj3NsnzYGSsUlbaZ+dhZgRABI0a6708AsCCs9CgF0ilGQIWKuxdCxT0LGrV8cFwKM81eJLHzsCQILufNzX4sUC4NgygIWAz2cqMf16Snv0EWJ05uFM/SeFAJCQjz4LWv4C+FEpBNzga9oXSsxR+3jquokQg33dtH/PrkJCCAAJufVBNv4By/PlnKBPQFLLAdaB7rxjPLVoKkSoW0fpsD2Z908SASABr42U3p8kACtgG2Pt7gDbJ5OEhvWli07wVLeOEAFrwHTOkRT/pBEAEnDXE7z9A6tiMwDn/yW5joF2Ha1tTkO4WrqZlctO8dSogZAwAkDM7GrUpI87AVkxZbqbCbjJ1/wFSoT1Bzj/WK/UpAY1Zx0XLz/VU5M1hBQgAMTMzv0DKN+kKW463oUAa5qVBNukdulJLAfUVKvm0p/OYsd/mhAAYjTmA+mDTwWgiia6vzcX3ZxcCOjUTrryNK+0NwBVt+lG0nVne1qHOxdShQAQo8de5O0fqK5xHwUhYMEiJaLd+tJVp3tq3Eiogl/0kK4+g/CURgSAmNjFJ8PGCEANlELATcmFgA1aBdPYzdYWynDMfp5O/w0bKdOKABCTR1n7B0IxYZJ0YYIhwHax/+U8j2trV2KNhsGSCV0V083zHSFSc7+Wjjjf1+LvBSAkHdpKfzzJU4N6SsyD/5Xu/w8foZX16CKddDA7/bOAABCDh5+X7n6SLzMQtg1bB8fKkjxTPmaidNUdyfUrSAt76z92f087dhcyggAQgxMv8zX5cwGIgK3LX35KspvzrGPhlbf7mvCxCsmK/lH78tafNQSAiNkZ5lOu5EsMRKn1usGac9IF6LaHfT01SIVhZ/ptun/LTYUMIgBEzK78ffRFAYhYi4oWs80T3qH/zGDpr//O98dqvTrSnn2l/Xf1VGd1IaMIABGyr+yRF/ql280ARM8azVx6slfq458ku8jo3feVO7bOv3c/T7v1Euf6c4BjgBF67wNR/IEY2d+3c67zE79ts3P7fJ19X3tN6dj9PP3zMk/77ULxzwuuuIjQoGFMrgBx+/ob6bwbfF1wnKctElqbnv9N9v/ur+6qw3bdpN7dPW3dWcghAkBE7Mz/4OECkIDvFkt//D9fZxzmqfdWit3r7yiTarmJi24dpR239rRtt2CtH/lFAIiInQ1emNDFJQCkJUuka/9p5/M9DdxRsflkqjRztjKjdXOVuhpu3tFT102Y3i8SAkBERk1g+h9Ig78/5JeO49pxtTgMGaXUsuK+fsugd0L7DTxttVmwvo9iIgBEZNQEAUiJ59+QJn7i67xjvNJxwSgNHZWO8N/WFflN2kptWng/FH2KPSojAERg/gLpg08FIEU+tqZcV/g67TdeaXNbFKZ/KX30mRI3oJd0/K+4hQ8rxzHACPD2D6ST7cu56nZftz8SzVt6Gqb/bff+kftQ/LFqBIAIvMv6P5BqT/5POuMaP/TNemmY/m/aRHTnQ1lYAojAqAQ6gLVqrlL3s2AE65x16ywz3IdC/XrBW9A3bpliwUL3XBR82xqozHRj1pygc+GMWcGUKZBXtkx34uW+fj3Q0+47BkfgamLefGnsh0rcEt4/UCYCQMiseE6ZrkhZMbfduz27etq4TbCrtyrsbG/pfO9yNwT99FPww8nBsaZJU3xNcs+P3frm3IJfe4r8sBBsF/i88EZwSsA2zVXX0JTs/l+wSEBZCAAhs/a/Uem4obRXv+g2MC2PBQwblYOBvelYMLAwMGmqrwmTpKkzBGSWhduzrvXVr2ewfm4976tq6LvpePVeSABAmQgAIftwcjQfAgN6S8cfkI6NPfbhaN3CbCwNBrZkMPw9acR7wSUoi2iChAx66c2gkB+2p6f+O5T/7337nTRsjFLB/luAchAAQmZvxmGzKf60FP8VsStY7ejRgF7Bf6eFgBFjfRcIpE+nCcgMO8Z764O+nhokHTTA0/ZbuJi7ir9+Fn7T5Bu3tNGgnoCVIgCELIozwAN6Z+9Ij7UU7bqJpyP2kmbNlUaOtQ9Jv/RByRsKsmDy59I1//DVpoV04G6eeq3kToE33knXzjtbBiAAYFUIACGyaXC7iSxs3Too06z72E7b2vB+mCp9dYRfetqlLUCaWRD40z99PfBMMCOwbBCY/VX6Lv5aRMhGGQgAIfoogul/03wd5YadT7Yp1e238ErHEW3ntIWBt8cFNygCafXZ9B+DwMA+Xmlm4Hv3Z/buJ9N37u47AgDKQAAIUVTn5muvplyyo4h9trbhldYsLQwMGubrnfECUsuCwF//le7D9qvR4g1lIACEKKoTAEVg65V9e9rwSscMXxwiPf6yX5peBVA11isEWBUCQIii2u1uBbE655Kzyn6te+9kwysFgYdf8OkzkBIW1LbYVNpysx9v1bM/n7PmSF/ODVrr2l6YcR8JCWq6loBVIgCEyD74olC0AFDZ0s2DdnrgURcExkTYaAkrtvN27vdhG0+bbrSyn/XjaRXbDPvmaGnIO77eGi3EaM1GAspCAAjJV19LS5YoEvMiOFmQNd072fBKGy0fet53hYWe53GwExyXnORVud10owYqddXr1zPY7PnKMOnep3zaSMfAenIA5SAAhMTOukflawLADzZqI517lFe6d/2h53w9/4YQESv+153taZ0mqhHb7Lnr9tIvenh6/CXp3+73jV4Q0VmvhYCysFc0JHaTXlS+4q3pZ9ZdJ7i85R+Xeuq9lRABC1o1Lf6V2RHQA/pLt1/iaevOQkTatMhe4zAkgwAQkigDADMAK2abnc46wtMNv6vZTW74qc7ttYr1/uprsoZ04fGejkt5e+ussivBgXIQAEIya050C9Lz5rPYvSobrSdde5an847x1LKZUEPbdYu+OO/eW7rp9/x+ha2q+zVQXASAkHwZ4R6Ar+YLZdp2c+lvF3s6dj9PDesL1eTHlDk3aCVdf46nLu2FENilRS0IVCgTASAksyJcApjxpVBFA/sEa8179RWqYUiMl9tYULv0ZE+/6CHUkLUnrsXKCspEAAiJtbKNynQCQLVYYTlyH680I8D+gKqxfgtPvKzY1HKfRKf/xtNhe1K9aoLpf1QFASAkUR5rIgDUjK0xX3Omp6P39Uo70VGeOx71de71vl4bqdjsu7N0/K8IAdW10Xp87VA++gCEJMprbS1cWAMVOnxVn02L/vIXUs+unq6/y6dVbZns6zTuI1+3PCB13URqt76nJo1VOh7YuGHQK8BGmAb0khYv9nT7I2x+rSrrkwGUiwAQkqgbm9g+AAJAzVn/gKtO9/TMq9Kdj/ta9K1QhvkLpCGjbPy8KNusyo5bS3v08dS2lUJhYe377z3983FCQFV0aCugbCwBhCTqAMAyQHhsp7QdQbv5fK903h01Y3/2X3hDOuUKX5f9zde0mQqFXQh1yECmtMtlMzGcfEFVEABCEuUSgCEAhM9mA6441SutObM3IBx28c9xf/D19CCF4lf9pZ23FcqwMdP/qCICQEiingH4ZCpToVGxNedbLvDooBaivz/s6+4nw/kze/IhXmn/AVbOmmEBVUEACEnUa8mfTBUiZLMB1k54u25CSB5+XnrjHYXid0d7asYtdytlGzSBqiAAZMTHU4SI2TKAFRqOoYXnpvt8LQx4CaoAABAASURBVFikGrPrhc8/ht+XlaHXBaqKABCS2qspcp9OE2JgSwI3nOuFfrwtyxo3kvbZyRXh47xSw56BO5b379npgTffVSjsiJtd/ISfa+5mR9ZqLKBKCAAhWS2GADCJZYDYWLGxi2o6t1Ph2eayv//B0+F7eerZRaWWvcfu7+nWCz21br7qf/+NENsK29XPB+4mLKPDhgKqjAAQkjhmANgIGK81GkqXnepp/11VWPbmf8lJnhrU+/mP2abJ88qYlp86Q6E6eHdPm20sVLJJW2ZGUHUEgJCsHkNLpUnsA4iddRA8dA+vdH99/XoqnG4dgiC0ItZ7foNVNP/5YrZCd9bhHN2srCMzAKgGAkBIasXwlRz/sZCQrTtLfzrTK7XALZKN2qz6zbJF05X/eBS30zVdK7joCQE6AKI6CAAhqVtHkZs3X6F1WUPV2duu3V2/YWsVxsw5q152WtUbfpOINqfZZs2eXVV4m24koFoIACGxY0pxGPehkCDbaW03C261mQphzMSV//isudJHk1f+c1o1U2ROOtgrfPtb9kOguggAIVkjrgDwERsBk2azPRee4Gm3Xso923dy5wou5LHul1ffseo/j21aKDJ2QZaFgCLr3I6lEFQPASAkjRoqFlxjmw62rn3CrzwdsVf+P3wffVG65P98Tfwk6Hg5Z540Yqx08uXlXavcpkW0X6Ptt5B6baXC2oyjqqgmrgMOSVwzANYM6JuFWu6xLMTPbqxrtran6+/2tTjiC6GSNPw9G9WbfYqjhe+JB3l6d4KvuV+rUGw/Sv26AqqFGYCQrNMkvjfBd8YLKbLDlm4q/PRiHhMsR5M1FDkLxCccWLypcC5JQk0QAEKyVoxtY0eMZR9A2rTfQLryNDakLU+9mN5Q7SKnomzOXGqLzVj/R/URAEKydox9uN8eJ6SQXcd6+amEgGV9F+PSyHEHeKpdkIVN+3V2aS+g2ggAIYnz4piZs7kYKK0sBNhMAHs0fhT1VdmVWVOig3Yrxltxp43j6UCK/CIAhCTum+NGMguQWm1bS5ed4qleDM2hsmDuPMXK7m5oVcYlRVm3JdP/qCECQEisX/pqMX41R7IPINXarS9dejL96s2MWYrdQQPyXxy36CigRggAIWoew3GnpewkQJxTq6g6u6L1ohN4Sxs9Mf6wan0B1l1HuWW3NLYtUEtqRIMAEKLW6ypWq2rTiuTZMa2LCx4CRiVwbNUaNe3dL79fd+5AQBgIACFaL+YAMGIcywBZsFUn6bRDixsCrDlPEntW+m2j3PZm2H4LZpZQcwSAELVeN96/lK+NkHwyQCb07Sn9qr8K6z+vxP8H1e5s6NdTuWPHTLfcVECNEQBCFPcMgPVkHzVByIhDBnrq3V2FNGyM9N4Hil3/HfL3przN5gJCQQAI0XoR3nq2IoOGMQWQJbYUYJsDi+iGe3wtWKhYrd8y6M2QJ0z/IywEgBDZ1aSNYroUaKk33g6uZUU21F4t2BTYsqkKZ/qX0oU3+5q/QLGyNs15YXsauncSEAoCQMjiPpqz8FvpzXeFDLGQaMcD6xawUdD7k6Tz/hxvCMjTLY09uwgIDQEgZBu3UexYBsgeOzJ6zpHFnMqdNFU6/0ZfX8TUIGj8x8qNXlsx/Y/wEABCtnGb+P+CjnhP+vobIWO27iztu7MK6aPPpFOu9CPvZfHsa9KUGcoFa/5jf2aAsBAAQpbEDMASNwHwynAhgw79padO7VRItgzwezcT8PjLisQjL0i3Ppif2bG+PQSEigAQMpvaTaL/+6C3WAbIIutY9/tjvNgvk0qTfzzq66TLfU0Iaare2mSffIWvu57I19+JnbZl+h/h8nyfVjJhO+c6P5F1x/+70Iu9HTHCMfET6cw/8VexRxdp/12qflTSvn6DR/ga7GbCZn+l3LGZxT+fSwBAuLhNOgJ2E1wSAeCpV3wdfwAfEllkR9WO2tfTHY8UOwS8NdqGr03a2nE3T906Sh2XCQO238VuGPxsut2H4Zfe+D+fqVzrtw1/rxE+ZgAi8NpI6Zp/xP9ltaWHu6/01CCn/c+L4PK/+XpztIAf2DXj917tlVoAA2FiD0AENu+gRFhDoBeHCBl2xmFerNdKI/227SaKPyJBAIjAGg2l1s2ViKfdMgBzOtllnd7OP84rvfUBZrdeTP8jGnzMRKRLeyXC1kJHjBUybMPW0pH78KEPqUXT5D5LkH8EgIh0ap/cB/hTg5gCyLo9+iS3lIT02KMPQRDRIQBEpOsmSszb46RpXwgZd/YRntZqLBRU7dq2+19AZAgAEbEP7iSvIX3yf8wCZJ21fj27oPcFQOqztTjRg0gRACLUI8Gbu14aqtjvXkf4OreT9ttFKKCBOxL+EC0CQIR6dEnuL7BdE/zYS8wC5MFvfumVmkuhOKwBUpIziCgGAkCE7EPbjgQm5bGXpHnzhRywpYDaqwkFcUB/3v4RPQJAxLbrpsQscrMA/36WWYA8aNnUzQTsSVEoAmt93LmgN0QiXgSAiG2zebIf2k/8T/pyjpADe/WVNttYyLlf7UbQQzwIABHbomPybTzvf4ZZgLywVsF16wg5tVEbaavNBMSCABCxWu4rvMOWStRLQ/J/W1pR2D0BR+zNG2JeHbI7v7eIDwEgBr27J/uXeombALj7SWYB8mJAr2QbTSEatva/dWcBsSEAxMA29DRZQ4myK4o/niLkxOm/8VSPpYBcOe4A3v4RLwJADDzPZgGUOGYB8mOdJtJR+1Iw8sJOC23cRkCsCAAx2Wnb5D+sR7wXDOTDrtuzFJAHtTz2dSAZBICYtG0ltd9AibvlAV/fLRZygqWA7BvQW1p3HQGxIwDEaLcdkk/5M+dID/6XpYC8sKWAo/fj7TGr7IjwIQP5/UMyCAAx2jElt3s9+oI0ZbqQE7tsx+7xrLJ7HpLuE4LiIgDEaPXa0i96KHHfL5FuvJdZgDyxpQC7PhjZYcuC/XcQkBgCQMwG9E7HdN/4j6XBw4WcaNRAOutwppKz5ORDvNIJISApBICYtWkRXPWZBn97yNeChUJO2J+rPfoIGWAzgWnYFIxiIwAkYJ+d0hH77argfz7GUkCeHLOfp/VbCim2pluqOZoeDkgBAkAC7E1tvXWVCs++Lo0cJ+SILQXUXk1IqdMO9bRGQwGJIwAkZN+d0/MGcP1dvr7+RsiJtq2lQ/fgDTONem0lbdVJQCoQABLSp0fy9wMs9dXX0o33sBSQJ3v1Cy6XQXrYRs3j6fePFCEAJGQ195Xfu196PgzeHC397y0hJ2x3+dlHeKqfgr4TCNhRTab+kSYEgATtvqNS9YHw13/7mjVXyIlma/PGmRb9t6dZE9KHAJCgOqun50SAsSOB197JUkCe2HGznl2EBFmff9o1I40IAAmzi0DSNAswZqL02EtCjpx6qKe11xQSUMt9wp53tFcK+0DaEAASVr+utFffdL0dWG8Ajgbmh20+O+Mw3kCTcNienjZqIyCVCAApMLBPumYBzJW3+Zr8uZATXTexo6dCjKzfx979BKQWASAFbBbA3hTSZNG30iX/R3+APPn1Hu5tdD0hBrbkcu5RzLog3QgAKbHzttKGrZUq07+ULv2rr8XfCzlgR0/PO8ZT3TpChGzd/4LjuOYX6UcASAk7t33iQel7Yxj3kXTL/cU7GTBpijR6YnBrYp7YjvSTDubNNEp29LLd+gJSr7aQGpu0lfptI700VKny0psqXTCz907KPeuFYA2RKt+SaG9y23R1Y3OvtJae9eY6O3aXRo6l8VMU9uwr9d9BQCZ4viOkxpx50rEX+1r4rVLnrCM89d5KufX3h3w9/cqqf16HDaUBvbzSGfussj9fR13ol26ERDis0c/5buq/FhMsyAiWAFLG7gc4bK90foJc+09fw99TLs2co7KKv5nglgX+fLevoy/y9eIQZVK9OkGrYITDLmA650iKP7KFAJBCu/dWandrX3W7r7EfKnfeHqsqmzFL+st9vo6/xNerI5Q5dkztkIFUrJqy0P7HE9lciewhAKRUGjcEmm+/cx92t/r6eIpyZcas6q+ETZ0h/cnNjpx7va8PPlWmHLBrEARQPdbh75KTPK3VWEDmEABSqv0G0i7bKZUWLJIu+IuvKTOUG3VWr3ngshMTZ1zj66b7s7O2bqdP7Ly6XRyEqln6tWubsuO7QLkIACl2xN6eGjdSKlmB+/0NvmbOVi6E2YnxhTekYy729cyrygQ75XD+MSwFVNWx+3vc8IdMIwCkmH0wn3Zoej+YZ3/lCsdf8hECwn4D/mah9Nd/+TrrWl+Tpir1rF89/QHKt89OwV4dIMsIACnXvVNwY2BaTftCpSL32XRlWlSbLt+fJJ1yha87H/dL+yfSzJacdt1eWAU7/nl4Sk/qAFVBAMiAI91SQJsWSq1Zc6VzrvM18RNllm3iatVckXn0RenEy3y9+75SzTafdmkvrIBtmDz9NxR/5AMBIANsp7FtNlo9xX0b7dKg82/0S+1zs2rzDoqU3a1gmyeth8D8BUota2bTspmwjA1aSb8/luKP/CAAZIS14j1yn3R/+Fh3OQsBQ0Ypk7bfIp6vr7XgPf6PvoaNUSo1qBccbeMymx/Z7X6XnuyVGigBeUEAyBDbdGR7AtLOmgXZ/QFZY1Pf1tQlDnO/Dm5aTOtsgF0aZDMB+DEQxfVnA4gLASBjzjjMU9MmSjW7XeLGe3zd9US2rpmwc912UU6c0jwb0LmddObhxQ4Btux28W+90gwckDcEgIxp1MCFAPeh7GXgc/mRF4I17zSvdy9rj194pfvc47R0NuAGF5oq30KYBhaI9t1ZhWR9/S9wsyCbbiQglwgAGWRvZgfulo03M9v1fsqVvj6dpkxovrb0i62ViJfdsskJl/p6Z7xS5bA9PW2zuQrnlF972mJTAblFAMiogwaodDd9FnwxK2iR+9pIZcKBA5ILV3ak8qKbfd3yQLqWT85ys06d2qkwBvaR+vYUkGsEgAyzI0lZOa5lTXCu+Yevfz7ma0nKtwbYBri9+ipRz70unXS5r2kzlQp2FPUPbi28Q1vlnnVFPDrlJ26AMHi+72drpxZ+ws6W29t1Vi6fMbbb3jaX2dGqtLK1+KMvTv7ralfMHv8rT/1S8jZqF0HZHRAfTlYu2R6bm89P959NICzMAGScva1efEK23lasWZB1xXtrtFKrfr109F1Y9G1wouL6u/zSt5NWv25wHt6a4uTRd4ult8cJKARmAHLijXeC8/dZY/ccHLVPerscWovj8R8rFVo0DXalp+FImp1c+N2ffU3J+B0QK7LVZsEmQGsRDeQVASBHnn5F+vtD2fvttIJ2zpHpPGs9+fNgtiJNfnugp/47KHF2G6SFALsQKq9sI2CfrT1ttnGwDwLIEwJAztz9pK+Hn1cm2f3qA3dU6tx0n68XhihVdthSOvkQrzQlnyS7CtpCwIxZyjUr/tYTYdtuXia6cQLlIADk0F9cwXoxZQWrXFvsaWyIAAAQAElEQVS5D9cT3Rtu07WUGlNmSCdckr6/Ji2bBu16k545seJvDZ8+T8mJhajZfQDbdpP6beNl5igusDwEgJyyznJpvWymHIfu4Wn/XZUax/0xnVPd9mZqJyq2TbhRj52W+MMtviZ+qkKxTbgWBGxJhrsCkDUEgJyyc/cX3uRr3EfKrFbNpVN/nY5WrBe74pbm3eH77CQdvleypxbsz5wFz1ETVDi1a0s79ZT23cUrhQIgCwgAOZaXM9s7bSsd4YrbGg2VGGvKk/Z2xpt3kM49yiudZU/Sjff6emmoCms7tzyw87ZeaTkLSDMCQM7ZRTzn/dnXpKnKNCv+di4/iYY4n7iv3clXZOOvid0UeY4LAR03VKLufdrXv59Voa3jfi922kbarReNhZBOBIACsPXZc6/39VkOzmw3bmRrru5DdQevdC4+ahagzr/R10efKVMO3t3TgbspUXZy4ub7fRX9E8aWB3Z2s1j775r+q7xRLASAgpgzLwgBeTqzbTuw+7sgYEfiovDlHOmPt2Z39qRz++ASnyTfPke8J11+m6/Fi1V4q9UK+grYTZ7N1haQOAJAgdhNc7Yx0Jrb5IkVOFt33byjV1oHt2NaNfXfV6UHnvFLwSnLbD/AaYd66tFFiflocrCJ0roHQqrlSd07B7NYW27mPoS5dwgJIQAUjC0HXHizX/pQzqsObv2708ZSl008rd9CZb9tTfxEeu1tX4PeCrrc5YntnbBGS3bHQRKWXnOc9o2UcWvu/mzuur2nnbfjGCHiRwAoIDsdYMe1xkxUIdg9A3Z5jX3A2mbCxg2DdVnrYmeFaeacYLrfjrHlmTVXstmApJrX2GVG197p6813heXYrVdwLwYthxEXAkBB2a1nV/zd14ixQsHsun3QM6BhfSXioeeke57iY2d5bD+L3YsBxIEAUHC3PODrudeFgrHZkAG9Pe3ZV4ncJzD2w+D2yqzvsYjCn870SstYQNQIANB/Bku3PexryRKhYGwWYO+dPPXfPjhiGSfbFHj1HcVZiirXwD7SsfsxC4DoEQBQYh/Cl7slATv3juKxPRG93PTznn09bbSeYmOh8/ZH/NJV1gjY1cNXnU4AQPQIAPjB9C+li27yNa0gt7ph+dq0kHp399Rna8XW195ur7RbLBHc8vi3PxAAED0CAH7im4VuDfIfbA5EYMPWUseNpHbre24E/xyVSVOCUwJFPypo6/+2DwCIGgEAP2N/Iu77D73csXxWoDZuI7V3oWD9VlKrZgr1RMHdT/p6+HkV1u69peMOIAAgegQArNCQUdJ17o0s7+fjUXMWACwINLZeCw2CDoTl3kpofSnmfBW0q7a+DDaKvBflkpM8desoIHIEAKzUlOnSRbf4+mKWAETMbnG8hul/xKSWgJVova70l/O8Uq99ICnWuKj3Vso1m0U583CKP+LDDADK9uzr0u0PsySA+FjDot8f65XejI2dVHn0RV+vDAs2rOaFXW198QleKXADcSEAoEpsh/aVt/maMkNApNpvIJ1/7IqvMx48XBr6rq9RE4JLrrLK7mb43dFe2XsmgLAQAFBlNgPwt3/7emGIgEjY7XgnH1z+dPgHn0qj33djYtBZcOG3SjW7srprB7sAyNNWmwlIBAEA1fbOeOmGe/zSrm0gLMcf4GlAb9WIBYJxH9mdA74mTQ02sybF1vbt2GTb1nYrZfT9FIByEQBQIwvcOuxtj/ilTm5ATdj695mHBQUyCrZ/wMbX3/w45s33NWNWcDW0Pe1a6Oqo697obami2VrS+i3t1+KVntZV0fYxAGlEAEAo3h4n3XgvswGonr13ko7YKx074K0fwVdfB8O+bZcW2R6Duqu7qfu6Uv16wWjoxpquuK/TRGpQT0DmEAAQmkVu3fW+p309OUjcLIiyNHXF8+wjPW26kQDEjACA0NlJgZvv9zX+YwErtNO20rH7e6UNcQDiRwBAZP73lnTHo35pKhVYaq3G0mmHetpiUwFIEAEAkbLjWA8/7+vxl0QDIaj/9m6tf2+vtIYOIFkEAMTCNlPZLW8vDQ1uG0SxNFtbOuM3njq1E4CUIAAgVpM/l/75mK/h7wkFsVdf6dd7eKqzugCkCAEAibAmLbc97JcatiCfdthSOmxPT+uuIwApRABAol4bKd3jlgamzRRywjb32Tp/21YCkGIEAKSC3Svw2Iu+PkuwZStqZpO20uHujb9zewHIAAIAUuXd96Wn/ufrrTFsFswCz5O26erW+fvRzAfIGgIAUsn6sj89yNdLb2b7qte8sg191shnr75e6S57ANlDAECqfb9EGjbalgh8jRhLi+GkNV1LGtDL067bS2s0FIAMIwAgM6yXgPUReGkoewXiZNP83Tv9eHe9l447ewDUEAEAmTTxkyAIvDJcmr9AiIAd39uxu9R/B6/05g8gXwgAyLzBLgQMfdfXO+ODO95RfXaH/XbdpO238LQBx/iAXCMAIDeWuD/JH34qjRznxlhfEyaxZ6AcXdrbFL+nHl2l1s0FoCAIAMitBYuCY4Wjxgethz+n2VCJvdl32ljq1tHT5h2l+nUFoIAIACiML2ZJw8ZIEz/1NWmK9Ok06bvFyjUr7h02lDbdyFNH97TBTXwADAEAhWanCSwMfDI1CAWTpkrTv1Tm2Ln8Ni2CNfz1W3qlp/0zZ/QBrAgBAFjGom9VKQz4mj03OIJoY64bM+codmuvKa2zZvBcu4n7dhNPazcOzuW3bCYu3AFQZQQAoBrs6OFXX/8YCua4b3/lnou/L++v0+q1PTWsLzVww542LV939eBNvvKoW0dcowsgEgQAAAAKqJYAAEDhEAAAACggAgAAAAVEAAAAoIAIAAAAFBABAACAAiIAAABQQAQAAAAKiAAAAEABEQAAACggAgAAAAVEAAAAoIAIAAAAFBABAACAAiIAAABQQBYAFgkAABTJIgsAcwQAAIpkDgEAAIDimVNbBAAAAIqmFAAWCgAAFMlCAgAAAMWzkCUAAACKhz0AAAAUEHsAAAAoIAIAAAAFxB4AAAAKqBQAPhcAACiSSRYAxgsAABTJeM/3/SbuG7MFAACKYq1anufZHoDpAgAARTDdan+tin9gGQAAgGIo1XwCAAAAxVKq+bUr/wMAAMi9nwSASQIAAEXADAAAAAVUqvme/R/f91dzj0VurCYAAJBX37tR1/O870ubAO0b7vGBAABAnn1QUfN/OAVghgoAAOTZD7W+cgAYJAAAkGc/BIDalb5zkAAAQJ79EAC8yt/r+/4k99hAAAAgbz5xYyPP85bYP9Ra5gcHCQAA5NGgpcXfEAAAACiGQZX/ofbKfhAAAOTGoMr/4C37o+wDAAAgdz5x0/9tK39HreX8pEECAAB5MmjZ7yAAAACQf4OW/Y7a5fwkAACQaYOW/Y6fzQC4NYJJ7jFKAAAgD0ZV1PafqLWCn3ynAABAHty5vO/0lvedvu83d4/PV/TjAAAgE75zo7WbAfhi2R9Y7gyA+4kz3GOwAABAlr28vOJvaq3kX7pTAAAgyx5c0Q+scIrfLQM0co9pbjQSAADImvlurOtmAOYv7wdXOAPg/oWv3eMRAQCALHp4RcXfrGwJwDwoAACQRXeu7AdXusvfLQOs7h6fudFcAAAgK2zjn03/+yv6CSudAXD/oh0feEAAACBL7l9Z8TerWgIwdwoAAGTJnav6CasMAC5BvOMeTwgAAGTBExW1e6XK6vTn+/427jFEAAAg7bZ1AWDoqn5SOUsAqvh/9IoAAECavVJO8TdlBYAKVwkAAKTZH8r9iWVf9uOWAeznvuVGdwEAgLR50739b1PuTy57BqDiOMF1AgAAaVSlmfoqXffrZgFqu8d7bmwiAACQFhPd6LCqs/+VVWUPgM0CLHaPKwUAANLkiqoUf1OlGQBTMQvwiRutBAAAkmY3965f8ZJetirNAJiK/4HzBQAA0uD3VS3+psozAEu5mQA7EbC1AABAUoa74l+tWlzlGYBKTnTjewEAgCRYDT5B1VTtAOASxzD3uF0AACAJN7taPFzVVO0lAOOWAZq6xzg3mgoAAMRlphsbuQAwT9VUkyUAmwWw/4CzBQAA4nR2TYq/qdEMwFJsCAQAIDbV3vhXWY1mACphQyAAANGr0ca/ykIJAGwIBAAgFrfXZONfZaEsARg2BAIAECnbd7dpxf67GgtrCWDphsBjBQAAonB0WMXfhBYAjPsPe8w9bhQAAAjTja7GPqEQhbYEsJRbCqjjHiPd6CQAAFBTY93o5gLAdwpRqDMAxv0Hfusev3LjGwEAgJqwWrp/2MXfhB4AjPsPfU/B0UAAAFB9J7qaOlYRCH0JoDK3HHCnexwmAABQVXe54n+4IhJ1AGjgHtYlkP0AAACUz976t3YBILLl9EgDgHEhwIq/hYAGAgAAq2JFf+uopv6XimQPQGUV+wHOFAAAKMeJURd/E3kAMO4X8lfRHwAAgFWx8/53KgaRLwEs5ZYCLGw87MbeAgAAy3rSjb1dAFiiGMQWAIwLAfXd42U3thEAAFjK9srt6Ir/QsUk1gBgKi4NGuJGOwEAgDFu9HHF/0vFKPYAYFwIsOI/yI3WAgCguKYq2PE/VTGLZRPgstwv9AP32M2NrwQAQDHNc2PXJIq/SSQAGPcLHu0e+7oRen9jAABSbrEbe7laOEYJSSwAGPcLf9E9jhEAAMVhu/yPcDXwZSUo0QBg3BfgLvc4TwAAFMOZrvbdq4QlsglweXzfP9A97nGjtgAAyJ/v3TjIFf+HlAKpCQDGhYCB7vGgGw0FAEB+WH///Vzx/69SIlUBwLgQ0MM9nnOjiQAAyL4v3Bjgiv9wpUjqAoBxIaCLe/zHjTYCACC7PlPQ5OdDpUzimwCXp+KI4PZujBYAANlkt+Fum8bib1IZAIz7gk12j94K+iMDAJAlr7ixvatlnymlUhsAjPvCzXGPvm48LQAAssE2+lmHv7lKsVQHAOO+gPPdYy83LlJwhAIAgDSyGnWxG3u42rVIKZfKTYAr4vv+Du7xsBvrCgCA9Jiu4Jjfa8qI1M8AVFbxhd3cjecFAEA6WE3aPEvF32QqABj3BbaU1V8sCQAAkrV0yr9/RW3KlEwtASyrYkngftEvAAAQLzupdnDW3vory3QAMC4ErKWgffAuAgAgejblf6Ar/rOVYZlbAlhWxW+ALQmc4cZ3AgAgGlZjzlQw5Z/p4m8yPwNQmZsN2Ng9bnBjoAAACM+zbpzoCv9HyolcBYClKm4VtCCwsQAAqD4r+Fb4n1XOZH4JYHncb5R1DuzkxqVupL4ZAwAgdax2XO7GZnks/iaXMwCVsSwAAKii3E33L0/uA8BSLAsAAFYht9P9y5PLJYDlYVkAALAC37hxgXI83b88hZkBqMzNBrRyj9+6cYIbawsAUESz3PirG7e4wj9VBVPIALCUCwIN3ONoN053o60AAEUwScGS8G2u8H+jgip0AFjKBYHV3GN/N85yYysBAPJopBvXe9j4NQAAAVdJREFUufEvV/gLf5cMAWAZLgz0UxAE+gsAkHVL3HjKjetc0X9V+AEBYAVcENjMPU5z41A36gkAkCUL3bjXjatd4f9A+BkCwCq4IGBfI7t18NcKlgnWEgAgjaw//0Nu3OfGq67w+8IKEQCqwIWBOu7xSzcOcWOAG3UEAEiSvenbFL8V/f+6ov+tUBYCQDVVXEO8n4KZgV7iawkAcbE3e1vPt6L/gCv684Qqo2iFwIWBZu7R240+FcMaDvG1BYBwWMEf68agivGyK/qzhBqhSEWAQAAANULBjwFFKWIuDDR0j65ubFkxNnejoxsNBQAw890Y78YoN95WcF5/lCv684XIEAASUHGyYD0FQcDGppW+3VIAkE/TFBT6pWNcxfMzduzHjwCQMi4crKkfQ0FbNxq70UjBjMHSZ8PlfF8DAUA85lcaXy/zrPztrxS03S0Ve1fk5wqp8f8AAAD//2futdMAAAAGSURBVAMATBHVzvrXm0EAAAAASUVORK5CYII=';

const TITLEBAR_ID = 'dsh-lg-titlebar';
const BAR_H = 40;                    // 横栏高度(px)
let isMaximized = false;             // 全局窗口状态(重建标题栏时恢复图标)

// ================= 玻璃质感样式(内嵌,避免沙箱读文件) =================
const CSS = `
/* ===== 双层圆角嵌套窗口(毛玻璃质感):
       内容区低不透明度毛玻璃让底层透出;柔和模糊 + 细边框 + 顶部高光 ===== */
html.dsh-lg-host {
  --lg-radius: 20px;
  --lg-glass-bg: rgba(255,255,255,0.38);     /* 内容区毛玻璃底色(低不透明度,背景透出) */
  --lg-glass-blur: blur(14px) saturate(160%); /* 毛玻璃模糊参数(柔和) */
  background: transparent !important;
}
html[data-lg-theme="light"] {
  --lg-glass-bg: rgba(255,255,255,0.38);
}
html[data-lg-theme="dark"] {
  --lg-glass-bg: rgba(20,26,38,0.40);   /* 内容区保持原半透明毛玻璃 */
}
html.dsh-lg-host, html.dsh-lg-host body {
  height: 100% !important;
  overflow: hidden !important;
}
html.dsh-lg-host body {
  background: transparent !important;
}

/* ===== 标题栏:全宽玻璃胶囊(品牌左,控制右,左右等宽) ===== */
#${TITLEBAR_ID} {
  position: fixed;
  top: 8px; left: 8px; right: 8px;
  height: 36px;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 14px;
  box-sizing: border-box;
  border-radius: 999px;   /* 胶囊形(两端全圆,Dynamic Island 风格) */
  background: linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04));
  border: 1px solid rgba(255,255,255,0.24);
  -webkit-backdrop-filter: blur(18px) saturate(180%);
  backdrop-filter: blur(18px) saturate(180%);
  box-shadow: 0 8px 24px rgba(0,0,0,0.20), inset 0 1px 0 rgba(255,255,255,0.45), inset 0 -1px 0 rgba(255,255,255,0.10);
  user-select: none;
  -webkit-user-select: none;
  cursor: default;
  -webkit-app-region: drag;
  --lg-icon: rgba(255,255,255,0.94);
  --lg-brand: rgba(255,255,255,0.85);
}
html[data-lg-theme="light"] #${TITLEBAR_ID} {
  --lg-icon: rgba(38,44,62,0.90);
  --lg-brand: rgba(38,44,62,0.80);
  background: linear-gradient(180deg, rgba(255,255,255,0.88), rgba(238,242,250,0.78));
  border: 1px solid rgba(140,152,180,0.32);
  box-shadow: 0 6px 20px rgba(31,38,58,0.18), inset 0 1px 0 rgba(255,255,255,0.9);
}
html[data-lg-theme="dark"] #${TITLEBAR_ID} {
  --lg-icon: rgba(255,255,255,0.94);
  --lg-brand: rgba(255,255,255,0.80);
  background: linear-gradient(180deg, rgba(20,26,38,0.74), rgba(20,26,38,0.55));
  border: 1px solid rgba(255,255,255,0.20);
  box-shadow: 0 6px 20px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.22);
}

/* 品牌区:标题栏左侧,无独立背景 */
#${TITLEBAR_ID} .dsh-lg-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--lg-brand);
  white-space: nowrap;
}
#${TITLEBAR_ID} .dsh-lg-brand .dsh-lg-logo {
  width: 16px; height: 16px;
  border-radius: 4px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(77,107,254,0.35);
}
#${TITLEBAR_ID} .dsh-lg-brand .dsh-lg-logo img {
  width: 100%; height: 100%;
  display: block;
}
/* 非官方社区版徽标:弱化样式,仅作标识声明 */
#${TITLEBAR_ID} .dsh-lg-unofficial {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.2px;
  line-height: 1;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(128,128,128,0.16);
  border: 1px solid rgba(128,128,128,0.28);
  color: var(--lg-brand);
  opacity: 0.85;
}

/* 控制按钮组:标题栏内右侧,无独立背景(标题栏提供玻璃效果) */
#${TITLEBAR_ID} .dsh-lg-controls {
  display: flex;
  align-items: center;
  gap: 4px;
  -webkit-app-region: no-drag;
}

/* ===== 内容区:毛玻璃+内缩+四角圆角 =====
   内圆角保持 20px;外框圆角 = 20 + 8 = 28px(见 #dsh-lg-frame),
   弧线圆心重合、视觉等宽。 */
html.dsh-lg-host #root {
  position: fixed;
  top: 52px; left: 8px; right: 8px; bottom: 8px;
  height: auto !important;
  border-radius: var(--lg-radius);
  overflow: hidden;
  background: var(--lg-glass-bg) !important;
  -webkit-backdrop-filter: var(--lg-glass-blur);
  backdrop-filter: var(--lg-glass-blur);
  border: 1px solid rgba(255,255,255,0.18);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.30),
    inset 0 -1px 0 rgba(255,255,255,0.08);
}
html[data-lg-theme="dark"] #root {
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.18),
    inset 0 -1px 0 rgba(0,0,0,0.25);
}

/* ===== 外层装饰边框:层级最低,纯色外框(mac 风:浅色米白/深色深灰) ===== */
#dsh-lg-frame {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  border-radius: calc(var(--lg-radius) + 8px);  /* 28px:内容区 20px + 内缩 8px,弧线平行 */
  border: 1px solid rgba(255,255,255,0.25);
  background: #f5f2ea;              /* 浅色:米白 */
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.35);
  pointer-events: none;         /* 不拦截任何点击 */
  z-index: 0;
}

/* ===== 最大化 / 真全屏:最外层装饰边框变直角铺满(内容区/标题栏圆角保留) ===== */
html.dsh-lg-maximized #dsh-lg-frame,
html.dsh-lg-fullscreen #dsh-lg-frame {
  border-radius: 0 !important;
}
html[data-lg-theme="light"] #dsh-lg-frame {
  background: #f5f2ea;              /* 米白 */
  border-color: rgba(160,150,130,0.35);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.6);
}
html[data-lg-theme="dark"] #dsh-lg-frame {
  background: #2d2d2d;              /* 比 WebUI 深色背景(rgb 21,21,23)略浅的灰 */
  border-color: rgba(255,255,255,0.16);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,0.14);
}
#${TITLEBAR_ID} .dsh-lg-btn {
  -webkit-app-region: no-drag;
  width: 30px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--lg-icon);
  cursor: default;
  transition: background 0.16s ease, transform 0.1s ease, box-shadow 0.16s ease, color 0.16s ease;
  outline: none;
}
#${TITLEBAR_ID} .dsh-lg-btn svg {
  width: 13px;
  height: 13px;
  display: block;
  pointer-events: none;
}
#${TITLEBAR_ID} .dsh-lg-btn:active {
  transform: scale(0.88);
}
/* hover:强对比反馈(浅色→深底白图标;深色→亮底深图标) */
html[data-lg-theme="light"] #${TITLEBAR_ID} .dsh-lg-btn:not(.dsh-lg-close):hover {
  background: rgba(24,31,52,0.92);
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(24,31,52,0.40), inset 0 1px 0 rgba(255,255,255,0.28);
  transform: scale(1.06);
}
html[data-lg-theme="dark"] #${TITLEBAR_ID} .dsh-lg-btn:not(.dsh-lg-close):hover {
  background: rgba(255,255,255,0.92);
  color: #0d1117;
  box-shadow: 0 2px 12px rgba(255,255,255,0.25), inset 0 1px 0 rgba(255,255,255,0.9);
  transform: scale(1.06);
}
/* 关闭键 hover:红色(用户认可的强反馈) */
#${TITLEBAR_ID} .dsh-lg-close:hover {
  background: var(--lg-close, rgba(255,59,48,0.95));
  color: #ffffff;
  box-shadow: 0 0 16px rgba(255,59,48,0.55), inset 0 1px 0 rgba(255,255,255,0.30);
  transform: scale(1.06);
}
@media (prefers-reduced-motion: reduce) {
  #${TITLEBAR_ID}, #${TITLEBAR_ID} .dsh-lg-btn, #${TITLEBAR_ID} .dsh-lg-controls { transition: none; }
}
`;

// ================= 图标 =================
function svg(paths, viewBox = '0 0 14 14') {
  return `<svg viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
const ICONS = {
  minimize: svg('<path d="M2.5 7h9"/>'),
  maximize: svg('<rect x="2.2" y="2.2" width="9.6" height="9.6" rx="2"/>'),
  // 还原(双框叠放,清晰的"恢复小窗"语义)
  restore: svg('<rect x="2.4" y="4.2" width="7.4" height="7.4" rx="1.6"/><path d="M4.6 4.2V3.4a1.4 1.4 0 0 1 1.4-1.4h4.6a1.4 1.4 0 0 1 1.4 1.4v4.6a1.4 1.4 0 0 1-1.4 1.4h-0.8"/>'),
  close: svg('<path d="M3.8 3.8l6.4 6.4M10.2 3.8l-6.4 6.4"/>')
};

// ================= 横栏 DOM =================
function buildTitlebar() {
  const bar = document.createElement('div');
  bar.id = TITLEBAR_ID;
  bar.title = 'WhaleBox 鲸盒 — 拖拽此横栏可移动窗口,双击切换最大化';
  bar.innerHTML = `
    <div class="dsh-lg-brand"><span class="dsh-lg-logo"><img src="${LOGO_DATA}" alt=""></span><span>WhaleBox 鲸盒</span><span class="dsh-lg-unofficial">非官方</span></div>
    <div class="dsh-lg-controls">
      <button class="dsh-lg-btn dsh-lg-min" title="最小化">${ICONS.minimize}</button>
      <button class="dsh-lg-btn dsh-lg-max" title="${isMaximized ? '还原' : '最大化'}">${isMaximized ? ICONS.restore : ICONS.maximize}</button>
      <button class="dsh-lg-btn dsh-lg-close" title="关闭">${ICONS.close}</button>
    </div>
  `;
  bar.querySelector('.dsh-lg-min').addEventListener('click', () => ipcRenderer.send('win:minimize'));
  bar.querySelector('.dsh-lg-max').addEventListener('click', () => ipcRenderer.send('win:maximize-toggle'));
  bar.querySelector('.dsh-lg-close').addEventListener('click', () => ipcRenderer.send('win:close'));
  // 双击横栏空白处切换最大化(按钮 no-drag 不受影响)
  bar.addEventListener('dblclick', (e) => {
    if (e.target === bar || e.target.closest('.dsh-lg-brand')) ipcRenderer.send('win:maximize-toggle');
  });
  return bar;
}

// ================= 主题:默认浅色(用户指定;深色模式暂不用) =================
// ================= 主题同步:跟随 WebUI 的深浅模式 =================
// WebUI 深色模式的 DOM 标记是 body[data-ds-dark-theme](浅色时属性不存在,
// 由 @deepseek-ai/dsh-client-ui-theme 设置)。外部玻璃壳据此同步切换
// html[data-lg-theme] → light / dark,外框/标题栏/胶囊跟随变色。
function syncThemeFromWebUI() {
  const dark = document.body.hasAttribute('data-ds-dark-theme');
  const root = document.documentElement;
  const want = dark ? 'dark' : 'light';
  if (root.getAttribute('data-lg-theme') !== want) root.setAttribute('data-lg-theme', want);
}

// ================= 注入(防重复,SPA 路由变化时保持) =================
function inject() {
  if (!document.body) return;
  document.documentElement.classList.add('dsh-lg-host');
  if (!document.getElementById(TITLEBAR_ID + '-style')) {
    const style = document.createElement('style');
    style.id = TITLEBAR_ID + '-style';
    style.textContent = CSS;
    (document.head || document.documentElement).appendChild(style);
  }
  if (!document.getElementById(TITLEBAR_ID)) {
    document.body.insertBefore(buildTitlebar(), document.body.firstChild);
  }
  // 外层装饰边框(层级最低,z-index:0,不拦截点击)
  if (!document.getElementById('dsh-lg-frame')) {
    const frame = document.createElement('div');
    frame.id = 'dsh-lg-frame';
    document.body.insertBefore(frame, document.body.firstChild);
  }
  // 初始同步一次主题(此时 body 可能已有 data-ds-dark-theme)
  syncThemeFromWebUI();
  // 监听 body 属性变化(WebUI 切换深浅模式)与结构变化(SPA 重建标题栏)
  const mo = new MutationObserver(() => {
    syncThemeFromWebUI();
    if (!document.getElementById(TITLEBAR_ID)) {
      document.body.insertBefore(buildTitlebar(), document.body.firstChild);
    }
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-ds-dark-theme'] });
  // 兜底:SPA 可能替换整个 body 节点,轮询确保同步(低频,开销可忽略)
  setInterval(syncThemeFromWebUI, 1500);
}

function boot() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
  // 窗口状态(最大化/全屏)→ 切换图标与最外层圆角
  ipcRenderer.on('window-state', (_e, s) => {
    isMaximized = !!s.maximized;
    // 最大化时窗口铺满屏幕,去掉最外层四角圆角(悬浮窗口形态才有圆角)
    document.documentElement.classList.toggle('dsh-lg-maximized', isMaximized);
    document.documentElement.classList.toggle('dsh-lg-fullscreen', !!s.fullscreen);
    const btn = document.getElementById(TITLEBAR_ID)?.querySelector('.dsh-lg-max');
    if (btn) {
      btn.innerHTML = isMaximized ? ICONS.restore : ICONS.maximize;
      btn.title = isMaximized ? '还原' : '最大化';
    }
  });
}

boot();
