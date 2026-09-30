const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("aemeathDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({ electron: process.versions.electron, chrome: process.versions.chrome }),
  windowAction: (action) => { if (["minimize", "maximize", "close"].includes(action)) ipcRenderer.send("aemeath:window", action); },
  checkForUpdates: () => ipcRenderer.send("aemeath:check-update"),
  getCaptureSources: () => ipcRenderer.invoke("aemeath:capture-sources"),
  selectCaptureSource: (id) => ipcRenderer.invoke("aemeath:select-capture",id),
  onWindowState: (listener) => { const handler=(_event,state)=>listener(state);ipcRenderer.on("aemeath:window-state",handler);return()=>ipcRenderer.removeListener("aemeath:window-state",handler); },
}));
