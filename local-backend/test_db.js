// local-backend/test_db.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const db = require('./db');

console.log("=== STARTING LOCAL DATABASE UNIT TESTS ===");

const testWatchFolder = path.join(__dirname, 'test_watch_folder');

// Set up clean test directory
if (!fs.existsSync(testWatchFolder)) {
    fs.mkdirSync(testWatchFolder, { recursive: true });
}

// Set database watch folder to test folder
db.setWatchFolder(testWatchFolder);
db.resetDb();

try {
    // 1. Test Global Settings
    const settings = db.getSettings();
    assert.strictEqual(settings.watchFolder, path.resolve(testWatchFolder));
    assert.ok(settings.currentDeviceId);
    console.log("✔ Test Global Settings passed");

    // 2. Test Device Operations
    const devicesBefore = db.getDevices();
    assert.ok(devicesBefore.length > 0);
    const newDevice = db.addDevice("Test Laptop");
    assert.strictEqual(newDevice.name, "Test Laptop");
    const devicesAfter = db.getDevices();
    assert.strictEqual(devicesAfter.length, devicesBefore.length + 1);
    console.log("✔ Test Device Operations passed");

    // 3. Test Gallery Entry Operations
    const entryData = {
        fileName: "test_masterpiece.png",
        fileHash: "hash123",
        status: "local_only",
        hoursSpent: 1.5,
        metadata: { sizeBytes: 1000 }
    };
    
    // Save entry
    const savedEntry = db.saveGalleryEntry(entryData);
    assert.ok(savedEntry.id);
    assert.strictEqual(savedEntry.fileName, "test_masterpiece.png");
    assert.strictEqual(savedEntry.hoursSpent, 1.5);
    
    // Retrieve entry
    const retrieved = db.getGalleryEntry(savedEntry.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved.fileHash, "hash123");
    
    // Get entry by filename
    const retrievedByName = db.getGalleryEntryByFileName("test_masterpiece.png");
    assert.ok(retrievedByName);
    assert.strictEqual(retrievedByName.id, savedEntry.id);

    // Update entry (hours and status)
    retrievedByName.updateHours(2.75);
    assert.strictEqual(retrievedByName.hoursSpent, 2.75);
    retrievedByName.markAsSynced();
    assert.strictEqual(retrievedByName.status, "synced");
    
    db.saveGalleryEntry(retrievedByName);
    const updated = db.getGalleryEntry(savedEntry.id);
    assert.strictEqual(updated.hoursSpent, 2.75);
    assert.strictEqual(updated.status, "synced");
    console.log("✔ Test Gallery Operations passed");

    // 4. Test Chat & Message Operations
    const chat = db.getChatByGalleryEntry(savedEntry.id);
    assert.strictEqual(chat.galleryEntryId, savedEntry.id);
    assert.strictEqual(chat.history.length, 0);

    const message = db.addMessageToChat(savedEntry.id, "user", "How's my anatomy?");
    assert.strictEqual(message.sender, "user");
    assert.strictEqual(message.message, "How's my anatomy?");

    const chatAfterMsg = db.getChatByGalleryEntry(savedEntry.id);
    assert.strictEqual(chatAfterMsg.history.length, 1);
    assert.strictEqual(chatAfterMsg.history[0].message, "How's my anatomy?");
    console.log("✔ Test Chat & Message Operations passed");

    // 5. Test Delete Gallery Entry
    const deleted = db.deleteGalleryEntry(savedEntry.id);
    assert.ok(deleted);
    assert.strictEqual(deleted.id, savedEntry.id);
    
    const retrievedAfterDelete = db.getGalleryEntry(savedEntry.id);
    assert.strictEqual(retrievedAfterDelete, undefined);
    console.log("✔ Test Delete Gallery Entry passed");

    console.log("\n=== ALL DATABASE UNIT TESTS PASSED SUCCESSFULLY! ===");

} catch (err) {
    console.error("❌ Test assertion failed:", err);
    process.exit(1);
} finally {
    // Clean up test directory files
    const dbFilePath = path.join(testWatchFolder, 'anchor_db.json');
    if (fs.existsSync(dbFilePath)) {
        fs.unlinkSync(dbFilePath);
    }
    if (fs.existsSync(testWatchFolder)) {
        fs.rmdirSync(testWatchFolder);
    }
}
