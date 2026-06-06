// src/main.js
const path = require('path');
const { fork } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const Store = require('electron-store').default;

let backendProcess = null;

// Fix #8: Encrypt store so tokens/PII are not stored in plaintext on disk.
const store = new Store({
    encryptionKey: 'creative-anchor-secure-store-v1',
});

// Fix #1: Parse a JWT payload without a third-party library.
function parseJwtPayload(token) {
    try {
        const base64Payload = token.split('.')[1];
        if (!base64Payload) return null;
        const decoded = Buffer.from(base64Payload, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

// Fix #1: Returns true when the token is missing, malformed, or past its exp claim.
function isTokenExpiredOrInvalid(token) {
    if (!token || typeof token !== 'string') return true;
    const payload = parseJwtPayload(token);
    if (!payload) return true;
    // If the token carries no exp claim treat it as perpetually invalid.
    if (!payload.exp) return true;
    return Math.floor(Date.now() / 1000) >= payload.exp;
}
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

        // Fix #1: Validate the token exists AND has not expired before granting access.
        if (protectedPages.includes(page)) {
            const accessToken = store.get('access_token');

            if (isTokenExpiredOrInvalid(accessToken)) {
                // Clear any stale tokens and redirect to login.
                store.delete('access_token');
                store.delete('refresh_token');
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

function startLocalBackend() {
    const fs = require('fs');
    const logPath = path.join(app.getPath('userData'), 'local_backend.log');
    
    // Clear/initialize log file
    try {
        fs.writeFileSync(logPath, `--- STARTING BACKEND LOG: ${new Date().toISOString()} ---\n`);
    } catch (e) {
        console.error('Failed to create log file:', e);
    }

    let backendPath;
    if (app.isPackaged) {
        backendPath = path.join(process.resourcesPath, 'local-backend', 'server.js');
    } else {
        backendPath = path.join(__dirname, '..', '..', 'local-backend', 'server.js');
    }

    try {
        fs.appendFileSync(logPath, `[MAIN] Starting local backend at: ${backendPath}\n`);
        fs.appendFileSync(logPath, `[MAIN] app.isPackaged: ${app.isPackaged}\n`);
        fs.appendFileSync(logPath, `[MAIN] process.execPath: ${process.execPath}\n`);
    } catch (e) {}
    
    // Fork the Node.js server script as a child process
    const forkEnv = { 
        ...process.env, 
        PORT: 5002,
        ELECTRON_SPAWNED: 'true'
    };
    if (app.isPackaged) {
        forkEnv.ELECTRON_RUN_AS_NODE = '1';
    }

    try {
        backendProcess = fork(backendPath, [], {
            env: forkEnv,
            silent: true
        });

        if (backendProcess.stdout) {
            backendProcess.stdout.on('data', (data) => {
                try {
                    fs.appendFileSync(logPath, `[STDOUT] ${data}`);
                } catch (e) {}
            });
        }

        if (backendProcess.stderr) {
            backendProcess.stderr.on('data', (data) => {
                try {
                    fs.appendFileSync(logPath, `[STDERR] ${data}`);
                } catch (e) {}
            });
        }

        backendProcess.on('error', (err) => {
            console.error('[MAIN] Failed to start local backend:', err);
            try {
                fs.appendFileSync(logPath, `[ERROR] Process error: ${err.message}\n${err.stack}\n`);
            } catch (e) {}
        });

        backendProcess.on('exit', (code, signal) => {
            console.log(`[MAIN] Local backend exited with code ${code} and signal ${signal}`);
            try {
                fs.appendFileSync(logPath, `[EXIT] Process exited with code ${code} and signal ${signal}\n`);
            } catch (e) {}
        });
    } catch (err) {
        console.error('[MAIN] Exception during backend spawn:', err);
        try {
            fs.appendFileSync(logPath, `[EXCEPTION] Failed to fork: ${err.message}\n${err.stack}\n`);
        } catch (e) {}
    }
}

app.on('ready', () => {
    startLocalBackend();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Proactively kill the backend subprocess if it is active
    if (backendProcess) {
        try {
            backendProcess.kill();
        } catch (e) {
            console.error('Failed to kill backend subprocess:', e);
        }
    }

    // Send a POST request to shutdown the local backend server process (best effort)
    const http = require('http');
    let host = '127.0.0.1';
    let port = 5002;
    if (process.env.LOCAL_BACKEND_URL) {
        try {
            const u = new URL(process.env.LOCAL_BACKEND_URL);
            host = u.hostname;
            port = u.port || 5002;
        } catch (e) {}
    }
    const req = http.request({
        hostname: host,
        port: port,
        path: '/api/shutdown',
        method: 'POST',
    });
    req.on('error', () => {});
    req.end();
});