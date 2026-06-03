// backend/db.js
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const SETTINGS_DIR = path.join(os.homedir(), '.creative-anchor');
const SETTINGS_PATH = path.join(SETTINGS_DIR, 'global_settings.json');

function getGlobalSettings() {
    const defaultWatchFolder = path.join(__dirname, 'sync_folder');
    const legacySettingsPath = path.join(__dirname, 'global_settings.json');

    if (!fs.existsSync(SETTINGS_DIR)) {
        try {
            fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        } catch (e) {
            console.error("Error creating settings directory:", e);
        }
    }

    if (!fs.existsSync(SETTINGS_PATH)) {
        // Migration: check if legacy settings exist in the repository folder
        let initialSettings = { watchFolder: defaultWatchFolder };
        if (fs.existsSync(legacySettingsPath)) {
            try {
                const legacyContent = fs.readFileSync(legacySettingsPath, 'utf-8');
                const legacyParsed = JSON.parse(legacyContent);
                const legacyWatchFolder =
                    typeof legacyParsed.watchFolder === 'string' && legacyParsed.watchFolder.trim()
                        ? path.resolve(legacyParsed.watchFolder)
                        : defaultWatchFolder;
                initialSettings = { ...legacyParsed, watchFolder: legacyWatchFolder };
                console.log("[SETTINGS] Migrated legacy global settings to home directory:", initialSettings.watchFolder);
            } catch (e) {
                console.error("Error migrating legacy settings:", e);
            }
        }

        try {
            fs.writeFileSync(SETTINGS_PATH, JSON.stringify(initialSettings, null, 2), 'utf-8');
        } catch (e) {
            console.error("Error creating default settings file:", e);
        }
        return initialSettings;
    }

    try {
        const content = fs.readFileSync(SETTINGS_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        console.error("Error reading global settings:", e);
        return { watchFolder: defaultWatchFolder };
    }
}

function saveGlobalSettings(settings) {
    try {
        if (!fs.existsSync(SETTINGS_DIR)) {
            fs.mkdirSync(SETTINGS_DIR, { recursive: true });
        }
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (e) {
        console.error("Error writing global settings:", e);
    }
}

// ====================================================
// DOMAIN MODEL SCHEMAS (Classical OOP Encapsulation)
// ====================================================


class Device {
    constructor(deviceId, name) {
        this.deviceId = deviceId;
        this.name = name;
    }
}

class GalleryEntry {
    constructor({
        id,
        fileName,
        status = "LOCAL_ONLY",
        fileHash = "",
        hoursSpent = 0.0,
        metadata = {},
        deviceOrigin,
        createdAt = new Date().toISOString(),
        updatedAt = new Date().toISOString(),
        accessedAt = null,
        thumbnailPath = ""
    }) {
        this.id = id;
        this.fileName = fileName;
        this.status = status;
        this.fileHash = fileHash;
        this.hoursSpent = hoursSpent;
        this.metadata = metadata;
        this.deviceOrigin = deviceOrigin;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.accessedAt = accessedAt;
        this.thumbnailPath = thumbnailPath;
    }

    // Encapsulated Domain Methods
    updateHours(hours) {
        this.hoursSpent = Math.max(0, parseFloat(hours.toFixed(2)));
        this.updatedAt = new Date().toISOString();
    }

    updateAccess() {
        this.accessedAt = new Date().toISOString();
    }

    markAsSynced() {
        this.status = "SYNCED";
        this.updatedAt = new Date().toISOString();
    }
}

class Message {
    constructor(id, sender, message, galleryEntryId, createdAt = new Date().toISOString()) {
        this.id = id;
        this.sender = sender; // "user" or "gemini"
        this.message = message;
        this.galleryEntryId = galleryEntryId;
        this.createdAt = createdAt;
    }
}

class Chat {
    constructor(id, galleryEntryId, history = []) {
        this.id = id;
        this.galleryEntryId = galleryEntryId;
        this.history = history.map(
            msg => new Message(msg.id, msg.sender, msg.message, msg.galleryEntryId, msg.createdAt)
        );
    }

    addMessage(sender, messageText) {
        const msg = new Message(uuidv4(), sender, messageText, this.galleryEntryId);
        this.history.push(msg);
        return msg;
    }
}

// ====================================================
// DATABASE MANAGER CLASS
// ====================================================

class LocalDatabase {
    constructor() {
        this.refreshActivePaths();
    }

    refreshActivePaths() {
        const settings = getGlobalSettings();
        this.watchFolder = settings.watchFolder;
        this.dbPath = path.join(this.watchFolder, 'anchor_db.json');

        if (!fs.existsSync(this.watchFolder)) {
            try {
                fs.mkdirSync(this.watchFolder, { recursive: true });
            } catch (e) {
                console.error("Error creating watch folder:", e);
            }
        }
    }

    readDb() {
        if (!fs.existsSync(this.dbPath)) {
            return this.resetDb();
        }
        try {
            const data = fs.readFileSync(this.dbPath, 'utf-8');
            const parsed = JSON.parse(data);
            return parsed;
        } catch (e) {
            console.error("Error reading database, resetting...", e);
            return this.resetDb();
        }
    }

    writeDb(data) {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            console.error("Error writing database:", e);
        }
    }

    resetDb() {
        const defaultData = {
            devices: [new Device(uuidv4(), "Primary Desktop Workstation")],
            gallery: [],
            chats: []
        };
        this.writeDb(defaultData);
        return defaultData;
    }

    // Settings operations
    getSettings() {
        const db = this.readDb();
        return {
            watchFolder: this.watchFolder,
            currentDeviceId: db.devices[0] ? db.devices[0].deviceId : ""
        };
    }

    setWatchFolder(newPath) {
        const absolutePath = path.resolve(newPath);
        saveGlobalSettings({ watchFolder: absolutePath });
        this.refreshActivePaths();
        return absolutePath;
    }


    // Device operations
    getDevices() {
        const db = this.readDb();
        return db.devices;
    }

    addDevice(name) {
        const db = this.readDb();
        const newDevice = new Device(
            uuidv4(),
            name || `Device-${db.devices.length + 1}`
        );
        db.devices.push(newDevice);
        this.writeDb(db);
        return newDevice;
    }

    // Gallery operations
    getGallery() {
        const db = this.readDb();
        return db.gallery.map(item => new GalleryEntry(item));
    }

    getGalleryEntry(id) {
        const list = this.getGallery();
        return list.find(item => item.id === id);
    }

    getGalleryEntryByFileName(fileName) {
        const list = this.getGallery();
        return list.find(item => item.fileName === fileName);
    }

    saveGalleryEntry(entryData) {
        const db = this.readDb();
        const index = db.gallery.findIndex(
            item => item.id === entryData.id || item.fileName === entryData.fileName
        );

        let entry;
        if (index !== -1) {
            // Instantiate existing data using Model to perform OOP updates
            const model = new GalleryEntry(db.gallery[index]);
            const existingUpdatedAt = model.updatedAt;
            Object.assign(model, entryData);
            model.updatedAt = entryData.updatedAt || existingUpdatedAt || new Date().toISOString();
            
            entry = model;
            db.gallery[index] = model;
        } else {
            // Create brand new entry using Model
            entry = new GalleryEntry({
                id: entryData.id || uuidv4(),
                fileName: entryData.fileName,
                status: entryData.status || "LOCAL_ONLY",
                fileHash: entryData.fileHash || "",
                hoursSpent: entryData.hoursSpent || 0.0,
                metadata: entryData.metadata || {},
                deviceOrigin: entryData.deviceOrigin || (db.devices[0] ? db.devices[0].deviceId : uuidv4()),
                createdAt: entryData.createdAt || new Date().toISOString(),
                updatedAt: entryData.updatedAt || new Date().toISOString(),
                accessedAt: entryData.accessedAt || null,
                thumbnailPath: entryData.thumbnailPath || ""
            });
            db.gallery.push(entry);
        }

        this.writeDb(db);
        return entry;
    }

    deleteGalleryEntry(id) {
        const db = this.readDb();
        const index = db.gallery.findIndex(item => item.id === id);
        if (index !== -1) {
            const deleted = db.gallery.splice(index, 1);
            this.writeDb(db);
            return new GalleryEntry(deleted[0]);
        }
        return null;
    }

    // Chat operations
    getChats() {
        const db = this.readDb();
        return db.chats;
    }

    getChatByGalleryEntry(galleryEntryId) {
        const db = this.readDb();
        let rawChat = db.chats.find(c => c.galleryEntryId === galleryEntryId);
        
        if (!rawChat) {
            rawChat = {
                id: uuidv4(),
                galleryEntryId: galleryEntryId,
                history: []
            };
            db.chats.push(rawChat);
            this.writeDb(db);
        }
        
        return new Chat(rawChat.id, rawChat.galleryEntryId, rawChat.history);
    }

    addMessageToChat(galleryEntryId, sender, messageText) {
        const db = this.readDb();
        let chatIndex = db.chats.findIndex(c => c.galleryEntryId === galleryEntryId);
        
        let chatModel;
        if (chatIndex === -1) {
            chatModel = new Chat(uuidv4(), galleryEntryId, []);
            db.chats.push(chatModel);
            chatIndex = db.chats.length - 1;
        } else {
            chatModel = new Chat(
                db.chats[chatIndex].id,
                db.chats[chatIndex].galleryEntryId,
                db.chats[chatIndex].history
            );
        }

        const msg = chatModel.addMessage(sender, messageText);
        db.chats[chatIndex] = chatModel;
        this.writeDb(db);
        
        return msg;
    }
}

// Export single instantiated instance of Database Manager (Singleton Pattern)
const dbInstance = new LocalDatabase();
module.exports = dbInstance;
