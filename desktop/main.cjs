const { app, BrowserWindow, Menu, Tray, desktopCapturer, dialog, ipcMain, session, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const log = require("electron-log/main");
log.initialize();

const APP_URL = process.env.AEMEATH_APP_URL || "https://aemeath-tau.vercel.app/";
const APP_ORIGIN = new URL(APP_URL).origin;
let mainWindow, tray, quitting = false, selectedCaptureSourceId = "";

// Voice, screen capture, and WebRTC encoding must continue while users work in
// the application they are sharing or while the Aemeath window is occluded.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

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
      const sources=await desktopCapturer.getSources({types:["screen","window"],thumbnailSize:{width:480,height:270},fetchWindowIcons:true});
      const source=sources.find(item=>item.id===selectedCaptureSourceId)||await chooseDesktopSource();
      selectedCaptureSourceId="";
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
    frame: false,
    titleBarStyle: "hidden",
    roundedCorners: true,
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.once("ready-to-show",()=>mainWindow.show());
  const sendState=()=>mainWindow?.webContents.send("aemeath:window-state",{maximized:mainWindow.isMaximized()});
  mainWindow.on("maximize",sendState);
  mainWindow.on("unmaximize",sendState);
  mainWindow.on("close",event=>{if(!quitting){event.preventDefault();mainWindow.hide();tray?.displayBalloon?.({title:"Aemeath is still running",content:"Calls and notifications remain available in the system tray."})}});
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

function showWindow(){if(!mainWindow)return;if(mainWindow.isMinimized())mainWindow.restore();mainWindow.show();mainWindow.focus()}
function createTray(){
  tray=new Tray(path.join(__dirname,"assets","icon.ico"));tray.setToolTip("Aemeath");
  tray.setContextMenu(Menu.buildFromTemplate([
    {label:"Open Aemeath",click:showWindow},
    {label:"Check for updates",click:()=>void checkForUpdates(true)},
    {type:"separator"},
    {label:"Quit Aemeath",click:()=>{quitting=true;app.quit()}},
  ]));
  tray.on("click",showWindow);
}

async function checkForUpdates(manual=false){
  if(!app.isPackaged){if(manual)void dialog.showMessageBox(mainWindow,{type:"info",title:"Aemeath updates",message:"Update checks are available in the installed app."});return}
  try{const result=await autoUpdater.checkForUpdates();if(manual&&result?.updateInfo?.version===app.getVersion())void dialog.showMessageBox(mainWindow,{type:"info",title:"Aemeath is up to date",message:"You already have the latest version."})}
  catch(error){log.error("Update check failed",error);if(manual)void dialog.showMessageBox(mainWindow,{type:"error",title:"Could not check for updates",message:"Aemeath could not reach the update service. Try again later."})}
}

autoUpdater.autoDownload=true;
autoUpdater.autoInstallOnAppQuit=true;
autoUpdater.on("update-downloaded",async info=>{const answer=await dialog.showMessageBox(mainWindow,{type:"info",title:"Aemeath update ready",message:`Aemeath ${info.version} is ready to install.`,detail:"Restart Aemeath now to finish the update.",buttons:["Restart and install","Later"],defaultId:0,cancelId:1});if(answer.response===0){quitting=true;autoUpdater.quitAndInstall(false,true)}});
autoUpdater.on("error",error=>log.error("Auto updater",error));

ipcMain.on("aemeath:window",(event,action)=>{
  if(!mainWindow||event.sender!==mainWindow.webContents)return;
  if(action==="minimize")mainWindow.minimize();
  else if(action==="maximize")mainWindow.isMaximized()?mainWindow.unmaximize():mainWindow.maximize();
  else if(action==="close")mainWindow.close();
});
ipcMain.on("aemeath:check-update",event=>{if(mainWindow&&event.sender===mainWindow.webContents)void checkForUpdates(true)});
ipcMain.handle("aemeath:capture-sources",async event=>{if(!mainWindow||event.sender!==mainWindow.webContents)return[];const sources=await desktopCapturer.getSources({types:["screen","window"],thumbnailSize:{width:480,height:270},fetchWindowIcons:true});return sources.map(source=>({id:source.id,name:source.name,type:source.id.startsWith("screen:")?"screen":"window",thumbnail:source.thumbnail.toDataURL(),icon:source.appIcon&&!source.appIcon.isEmpty()?source.appIcon.toDataURL():""}))});
ipcMain.handle("aemeath:select-capture",(event,id)=>{if(!mainWindow||event.sender!==mainWindow.webContents)return false;selectedCaptureSourceId=String(id||"");return true});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on("second-instance", () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(() => { configureMediaPermissions(); createWindow();createTray();setTimeout(()=>void checkForUpdates(false),5000); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  app.on("before-quit",()=>{quitting=true});
  app.on("window-all-closed", () => { if (process.platform !== "darwin"&&quitting) app.quit(); });
}

Menu.setApplicationMenu(null);
