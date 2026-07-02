// Electron の preload は require() で読まれるため CommonJS で書く。
// レンダラー（設定画面）に安全なAPIだけを公開する。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  checkDeps: () => ipcRenderer.invoke("deps:check"),
});

// ライブ字幕ウィンドウ用（main → renderer の一方向 push 受信のみ）。
contextBridge.exposeInMainWorld("caption", {
  onText: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("caption:text", h);
    return () => ipcRenderer.removeListener("caption:text", h);
  },
  onLevel: (cb) => {
    const h = (_e, value) => cb(value);
    ipcRenderer.on("caption:level", h);
    return () => ipcRenderer.removeListener("caption:level", h);
  },
  // 字幕テキストの表示/非表示モード（録音中トグル）。{ textVisible: boolean }
  onMode: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on("caption:mode", h);
    return () => ipcRenderer.removeListener("caption:mode", h);
  },
});
