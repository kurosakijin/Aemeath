const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("aemeathDesktop", Object.freeze({
  isDesktop: true,
  platform: process.platform,
  versions: Object.freeze({ electron: process.versions.electron, chrome: process.versions.chrome }),
}));
