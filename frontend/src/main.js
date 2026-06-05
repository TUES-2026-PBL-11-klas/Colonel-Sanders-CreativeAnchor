// src/main.js
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Store = require('electron-store').default;

const store = new Store();
let mainWindow;

app.disableHardwareAcceleration();

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 720,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        frame: false
    });

    mainWindow.loadFile('src/login.html');

    mainWindow.on('maximize', () => {
        mainWindow.webContents.send('window-maximized-state', true);
    });

    mainWindow.on('unmaximize', () => {
        mainWindow.webContents.send('window-maximized-state', false);
    });

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

// IPC handlers for Electron Store and navigation
ipcMain.handle('store:get', (event, key) => {
    return store.get(key);
});
ipcMain.handle('store:set', (event, key, value) => {
    store.set(key, value);
});
ipcMain.handle('store:delete', (event, key) => {
    store.delete(key);
});
ipcMain.handle('navigate', (event, page) => {
    if (mainWindow) {
        // Protected pages that require authentication
        const protectedPages = ['dashboard.html', 'upload.html'];

        // Check if navigating to a protected page
        if (protectedPages.includes(page)) {
            const accessToken = store.get('access_token');

            // If no access token, redirect to login
            if (!accessToken) {
                mainWindow.loadFile(path.join('src', 'login.html'));
                return;
            }
        }

        mainWindow.loadFile(path.join('src', page));
    }
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