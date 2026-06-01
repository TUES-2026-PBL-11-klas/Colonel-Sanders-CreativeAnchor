// backend/db.js
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, 'local_db.json');

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
        accessedAt = new Date().toISOString(),
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
    constructor(dbPath) {
        this.dbPath = dbPath;
    }

    readDb() {
        const defaultWatchPath = path.join(__dirname, 'sync_folder');
        if (!fs.existsSync(this.dbPath)) {
            return this.resetDb(defaultWatchPath);
        }
        try {
            const data = fs.readFileSync(this.dbPath, 'utf-8');
            const parsed = JSON.parse(data);
            if (!parsed.watchFolder) {
                parsed.watchFolder = defaultWatchPath;
                this.writeDb(parsed);
            }
            return parsed;
        } catch (e) {
            console.error("Error reading database, resetting...", e);
            return this.resetDb(defaultWatchPath);
        }
    }

    writeDb(data) {
        try {
            fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (e) {
            console.error("Error writing database:", e);
        }
    }

    resetDb(defaultWatchPath) {
        const defaultData = {
            devices: [new Device(uuidv4(), "Primary Desktop Workstation")],
            watchFolder: defaultWatchPath,
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
            watchFolder: db.watchFolder,
            currentDeviceId: db.devices[0] ? db.devices[0].deviceId : ""
        };
    }

    setWatchFolder(newPath) {
        const db = this.readDb();
        db.watchFolder = newPath;
        this.writeDb(db);
        return newPath;
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
            Object.assign(model, entryData);
            model.updatedAt = entryData.updatedAt || new Date().toISOString();
            
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
                accessedAt: entryData.accessedAt || new Date().toISOString(),
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
const dbInstance = new LocalDatabase(DB_PATH);
module.exports = dbInstance;
