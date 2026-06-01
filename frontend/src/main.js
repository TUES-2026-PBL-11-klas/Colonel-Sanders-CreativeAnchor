// src/main.js
const path = require('path');
const { app, BrowserWindow, ipcMain } = require('electron');
const Store = require('electron-store').default;
const store = new Store();

// Disable GPU acceleration to fix Windows compatibility issues
app.disableHardwareAcceleration();

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: require('path').join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.loadFile('src/login.html');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

ipcMain.handle('store:get', (_event, key) => {
    return store.get(key);
});

ipcMain.handle('store:set', (_event, key, value) => {
    store.set(key, value);
});

ipcMain.handle('store:delete', (_event, key) => {
    store.delete(key);
});

ipcMain.handle('navigate', (_event, page) => {
    mainWindow.loadFile(`src/${page}`);
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});