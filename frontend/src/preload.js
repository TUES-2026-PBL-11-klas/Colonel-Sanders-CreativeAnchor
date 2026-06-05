const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    store: {
        get: (key) => ipcRenderer.invoke('store:get', key),
        set: (key, value) => ipcRenderer.invoke('store:set', key, value),
        delete: (key) => ipcRenderer.invoke('store:delete', key),
    },

    navigate: (page) => ipcRenderer.invoke('navigate', page),
    
    openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),

    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close'),
    onMaximizedState: (callback) => {
        const listener = (event, state) => callback(state);
        ipcRenderer.on('window-maximized-state', listener);
        return () => ipcRenderer.removeListener('window-maximized-state', listener);
    }
});