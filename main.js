
const { app, BrowserWindow, Notification, Tray, Menu, ipcMain, nativeImage, powerSaveBlocker, screen, dialog, shell, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// 0. 解决自动播放策略限制 (NotAllowedError)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 1. 设置 App ID (Windows 通知需要)
if (process.platform === 'win32') {
  app.setAppUserModelId("com.sedentary.reminder.app");
}

// 2. 核心机制：阻止系统挂起应用，确保后台计时器精准运行
const powerId = powerSaveBlocker.start('prevent-app-suspension');

// --- AutoUpdater 配置 ---
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true; 
autoUpdater.verifyUpdateCodeSignature = false; 
autoUpdater.disableWebInstaller = true; 
autoUpdater.allowDowngrade = false;
autoUpdater.fullChangelog = true;

// Fix: Explicitly set feed URL to ensure Portable apps can detect updates 
// (Portable builds often miss the embedded app-update.yml)
autoUpdater.setFeedURL({
  provider: 'github',
  owner: 'MrC0824',
  repo: 'RemindHelper'
});

let mainWindow = null;
const notificationWindows = new Map(); 

// 缓存更新信息，以便前端连接时立即发送
let cachedUpdateInfo = null;

const notificationPositions = {
    main: null,
    interval: null,
    onetime: null
};

let tray = null;
let isQuitting = false;

function getIconPath() {
    return process.env.NODE_ENV === 'development'
        ? path.join(__dirname, 'public/icon.ico')
        : path.join(__dirname, 'dist/icon.ico');
}

function createTray() {
  if (tray) return;

  let image;
  try {
      image = nativeImage.createFromPath(getIconPath());
  } catch (e) {
      image = nativeImage.createEmpty();
  }
  
  tray = new Tray(image);
  
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主界面', click: () => mainWindow.show() },
    { type: 'separator' },
    { label: '退出', click: () => {
        isQuitting = true;
        app.quit();
      } 
    }
  ]);
  
  tray.setToolTip('提醒助手');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) mainWindow.show();
  });

  tray.on('double-click', () => {
    if (mainWindow) mainWindow.show();
  });
}

function repositionAllNotifications() {
    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { workArea } = primaryDisplay; 
        const WIN_WIDTH = 420;
        const WIN_HEIGHT = 360;
        const padding = 0;

        let index = 0;
        for (const [id, entry] of notificationWindows) {
            if (entry.win && !entry.win.isDestroyed() && entry.win.isVisible()) {
                const type = entry.type || 'main';
                let x, y;
                const savedPos = notificationPositions[type];

                if (savedPos) {
                    x = Math.min(Math.max(workArea.x, savedPos.x), workArea.x + workArea.width - WIN_WIDTH);
                    y = Math.min(Math.max(workArea.y, savedPos.y), workArea.y + workArea.height - WIN_HEIGHT);
                } else {
                    const stackOffset = index * 10;
                    x = workArea.x + workArea.width - WIN_WIDTH - padding - stackOffset;
                    y = workArea.y + workArea.height - WIN_HEIGHT - padding - stackOffset;
                }
                
                entry.win.setPosition(Math.round(x), Math.round(y));
                index++;
            }
        }
    } catch (e) {
        console.error('Failed to reposition windows:', e);
    }
}

function hasVisibleNotifications() {
    for (const [_, entry] of notificationWindows) {
        if (entry.win && !entry.win.isDestroyed() && entry.win.isVisible()) {
            return true;
        }
    }
    return false;
}

function createOrUpdateNotificationWindow(id, data) {
    let entry = notificationWindows.get(id);

    if (entry && !entry.win.isDestroyed()) {
        entry.data = data; 
        entry.type = data.type || 'main'; 
        
        entry.win.setOpacity(0);
        entry.win.webContents.send('notification-data-response', data);
        entry.win.show();
        entry.win.restore(); 
        
        updateWindowPosition(entry.win, entry.type);

        setTimeout(() => {
            if (!entry.win.isDestroyed()) {
                entry.win.setOpacity(1);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-alarm');
                }
            }
        }, 100); 

        return;
    } else {
        notificationWindows.delete(id);
    }

    const WIN_WIDTH = 420;
    const WIN_HEIGHT = 360;
    const type = data.type || 'main';

    const win = new BrowserWindow({
        width: WIN_WIDTH,
        height: WIN_HEIGHT,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false, 
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false, 
        icon: getIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false 
        }
    });

    notificationWindows.set(id, { win, data, type });
    updateWindowPosition(win, type);

    const searchParams = `mode=notification&id=${id}`;

    if (process.env.NODE_ENV === 'development') {
        win.loadURL(`http://localhost:5173?${searchParams}`);
    } else {
        win.loadFile(path.join(__dirname, 'dist/index.html'), { search: searchParams });
    }

    win.once('ready-to-show', () => {
        win.setOpacity(0);
        win.show();
        
        setTimeout(() => {
            if (!win.isDestroyed()) {
                win.setOpacity(1);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('play-alarm');
                }
            }
        }, 100);
    });

    win.on('close', (event) => {
        if (isQuitting) return;
        event.preventDefault();
        handleWindowDismiss(id);
    });
}

function updateWindowPosition(win, type) {
    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const { workArea } = primaryDisplay;
        const WIN_WIDTH = 420;
        const WIN_HEIGHT = 360;
        const padding = 0;
        let x, y;
        const savedPos = notificationPositions[type];

        if (savedPos) {
            x = savedPos.x;
            y = savedPos.y;
            if (x < workArea.x) x = workArea.x;
            if (x + WIN_WIDTH > workArea.x + workArea.width) x = workArea.x + workArea.width - WIN_WIDTH;
            if (y < workArea.y) y = workArea.y;
            if (y + WIN_HEIGHT > workArea.y + workArea.height) y = workArea.y + workArea.height - WIN_HEIGHT;
        } else {
            x = workArea.x + workArea.width - WIN_WIDTH - padding;
            y = workArea.y + workArea.height - WIN_HEIGHT - padding;
        }
        win.setPosition(Math.round(x), Math.round(y));
    } catch (e) {
        console.error("Failed to set position", e);
    }
}

function handleWindowDismiss(id) {
    try {
        const entry = notificationWindows.get(id);
        if (entry && entry.win && !entry.win.isDestroyed()) {
            entry.win.hide(); 
            entry.win.setOpacity(0); 
        }
        
        if (mainWindow && !mainWindow.isDestroyed()) {
             mainWindow.webContents.send('notification-closed', id);
             if (!hasVisibleNotifications()) {
                 mainWindow.webContents.send('stop-alarm');
             }
        }
    } catch (error) {
        console.error("Error in handleWindowDismiss:", error);
    }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 600,
    minWidth: 600,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      backgroundThrottling: false
    },
    autoHideMenuBar: true,
    icon: getIconPath()
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist/index.html'));
  }

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.webContents.send('show-close-confirm');
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
}

// --- AutoUpdater Events ---

autoUpdater.on('update-available', (info) => {
    // 增强的便携版检测逻辑
    const exePath = app.getPath('exe');
    const exeDir = path.dirname(exePath);
    // 安装版通常会包含卸载程序，便携版或解压版没有
    const uninstallerName = 'Uninstall RemindHelper.exe'; 
    const hasUninstaller = fs.existsSync(path.join(exeDir, uninstallerName));
    
    // 判定为便携版的条件：
    // 1. 存在 PORTABLE_EXECUTABLE_DIR 环境变量 (官方 NSIS Portable)
    // 2. 或者 目录下没有卸载程序 (解压版 win-unpacked)
    // 3. 或者 运行在临时目录下 (NSIS Portable 运行时)
    const isEnvPortable = process.env.PORTABLE_EXECUTABLE_DIR !== undefined;
    const isTemp = exePath.toLowerCase().includes(app.getPath('temp').toLowerCase());
    
    const isPortable = isEnvPortable || !hasUninstaller || isTemp;
    
    // 注入便携版标识
    const infoWithPortable = { ...info, portable: isPortable };
    
    // 缓存结果，供后续查询
    cachedUpdateInfo = infoWithPortable;

    // 无论是便携版还是安装版，都通知前端显示 UI
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', infoWithPortable);
    }
});

autoUpdater.on('update-not-available', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-not-available', info);
    }
});

autoUpdater.on('download-progress', (progressObj) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', progressObj.percent);
    }
});

autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', info);
    }
});

autoUpdater.on('error', (err) => {
    console.error('Update error:', err);
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-error', err.message);
    }
});

app.whenReady().then(() => {
  createWindow();
  createTray();
  
  // 统一由前端 AppContext 在加载完成后发起检查，方便控制 isManualCheckRef 状态
  
  screen.on('display-metrics-changed', () => { repositionAllNotifications(); });
  screen.on('work-area-added', () => { repositionAllNotifications(); });
  screen.on('work-area-removed', () => { repositionAllNotifications(); });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// --- IPC Communication ---

ipcMain.on('check-for-updates', (event, manual) => {
    // Only check for updates in production
    if (process.env.NODE_ENV !== 'development') {
        // 如果是手动检查，强制重新请求，不使用缓存
        if (manual) {
            cachedUpdateInfo = null;
            autoUpdater.checkForUpdates().catch(err => {
                console.error('Manual update check failed:', err);
                if (mainWindow && !mainWindow.isDestroyed()) {
                     mainWindow.webContents.send('update-error', `检查更新失败: ${err.message}`);
                }
            });
            return;
        }

        // 自动检查逻辑：如果有缓存，直接返回
        if (cachedUpdateInfo) {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('update-available', cachedUpdateInfo);
            }
        } else {
            // 没有缓存则发起检查
            autoUpdater.checkForUpdates().catch(err => {
                console.error('Update check failed:', err);
                if (mainWindow && !mainWindow.isDestroyed()) {
                     mainWindow.webContents.send('update-error', `检查更新失败: ${err.message}`);
                }
            });
        }
    }
});

ipcMain.on('resize-window', (event, { width, height }) => {
  if (mainWindow) mainWindow.setSize(width, height);
});

ipcMain.on('trigger-notification', (event, data) => {
    createOrUpdateNotificationWindow(data.id, data);
});

ipcMain.on('request-notification-data', (event, id) => {
    const entry = notificationWindows.get(id);
    if (entry && entry.data) {
        event.sender.send('notification-data-response', entry.data);
    }
});

ipcMain.on('dismiss-notification', (event, { id }) => {
    handleWindowDismiss(id);
});

ipcMain.on('window-move', (event, { x, y }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    let currentId = null;
    let currentType = 'main';

    for (const [id, entry] of notificationWindows) {
        if (entry.win === win) {
            currentId = id;
            currentType = entry.type || 'main';
            break;
        }
    }

    if (win) {
        const currentDisplay = screen.getDisplayMatching(win.getBounds());
        const { workArea } = currentDisplay;
        const [winWidth, winHeight] = win.getSize();

        let newX = Math.round(x);
        let newY = Math.round(y);

        if (newX < workArea.x) newX = workArea.x;
        if (newX + winWidth > workArea.x + workArea.width) newX = workArea.x + workArea.width - winWidth;
        if (newY < workArea.y) newY = workArea.y;
        if (newY + winHeight > workArea.y + workArea.height) newY = workArea.y + workArea.height - winHeight;

        win.setPosition(newX, newY);
        notificationPositions[currentType] = { x: newX, y: newY };
    }
});

ipcMain.on('confirm-minimize', () => {
    if (mainWindow) {
        mainWindow.hide();
        createTray();
    }
});

ipcMain.on('confirm-quit', () => {
    isQuitting = true;
    app.quit();
});

ipcMain.on('start-download', () => {
    autoUpdater.downloadUpdate().catch(e => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('update-error', e.message);
        }
    });
});

// 在重启安装前，必须将 isQuitting 设为 true，
// 否则 window 的 close 事件会被你的代码拦截，导致文件占用无法覆盖。
ipcMain.on('restart_app', () => {
    isQuitting = true; // <--- 关键修改
    autoUpdater.quitAndInstall(true, true);
});

// 打开外部链接
ipcMain.on('open-url', (event, url) => {
    shell.openExternal(url);
});

ipcMain.handle('get-app-version', () => {
    return app.getVersion();
});

ipcMain.on('update-global-shortcut', (event, shortcut) => {
    globalShortcut.unregisterAll();
    if (shortcut) {
        try {
            const ret = globalShortcut.register(shortcut, () => {
                if (mainWindow) {
                    if (mainWindow.isVisible()) {
                        if (mainWindow.isFocused()) {
                             mainWindow.hide();
                        } else {
                            if (mainWindow.isMinimized()) mainWindow.restore();
                            mainWindow.show();
                            mainWindow.focus();
                        }
                    } else {
                        if (mainWindow.isMinimized()) mainWindow.restore();
                        mainWindow.show();
                        mainWindow.focus();
                    }
                }
            });
            if (!ret) {
                console.log('Global shortcut registration failed');
            }
        } catch (error) {
            console.error('Error registering global shortcut:', error);
        }
    }
});
