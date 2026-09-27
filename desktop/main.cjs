const { app, BrowserWindow, Menu, desktopCapturer, dialog, session, shell } = require("electron");
const path = require("node:path");
const log = require("electron-log/main");
log.initialize();

const APP_URL = process.env.AEMEATH_APP_URL || "https://aemeath-tau.vercel.app/";
const APP_ORIGIN = new URL(APP_URL).origin;
let mainWindow;

function trusted(url) {
  try { return new URL(url).origin === APP_ORIGIN; } catch { return false; }
}

async function chooseDesktopSource() {
  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true,
  });
  if (!sources.length) return null;
  const visible = sources.slice(0, 14);
  const choice = await dialog.showMessageBox(mainWindow, {
    type: "question",
    title: "Share your screen",
    message: "Choose what to stream",
    detail: "Entire screens can include system audio on Windows. Some protected apps may block capture.",
    buttons: [...visible.map((source) => source.name), "Cancel"],
    cancelId: visible.length,
    noLink: true,
  });
  return choice.response < visible.length ? visible[choice.response] : null;
}

function configureMediaPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    return trusted(requestingOrigin) && ["media", "display-capture", "fullscreen", "clipboard-sanitized-write"].includes(permission);
  });
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(trusted(webContents.getURL()) && ["media", "display-capture", "fullscreen", "clipboard-sanitized-write"].includes(permission));
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!trusted(request.securityOrigin || request.frame?.url || "")) return callback({});
      const source = await chooseDesktopSource();
      if (!source) return callback({});
      callback({ video: source, audio: process.platform === "win32" ? "loopback" : undefined });
    } catch {
      callback({});
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: "Aemeath",
    width: 1440,
    height: 900,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: "#18191d",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (trusted(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!trusted(url)) { event.preventDefault(); void shell.openExternal(url); }
  });
  void mainWindow.loadURL(APP_URL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => { configureMediaPermissions(); createWindow(); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
}

Menu.setApplicationMenu(null);
