// src/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        autoHideMenuBar: true,
        ...(process.platform !== 'darwin' ? { titleBarOverlay: true } : {})
    });

    mainWindow.loadFile('src/login.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Handle folder dialog
ipcMain.handle('open-folder-dialog', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory'],
        title: 'Select Workspace Folder',
        message: 'Choose the folder containing your digital paint projects'
    });
    return result.filePaths.length > 0 ? result.filePaths[0] : null;
});

// Window control events received from renderer process
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});