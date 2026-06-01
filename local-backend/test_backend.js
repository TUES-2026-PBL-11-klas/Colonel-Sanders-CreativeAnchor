// backend/test_backend.js
const fs = require('fs');
const path = require('path');
const http = require('http');
const db = require('./db'); // Require db directly to manipulate timestamps for testing

const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const testFilePath = path.join(__dirname, 'sync_folder', 'test_art.png');

// Helper to make HTTP requests
function request(method, urlPath, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'localhost',
            port: 5000,
            path: urlPath,
            method: method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        if (body) {
            options.headers['Content-Length'] = Buffer.byteLength(JSON.stringify(body));
        }

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    resolve(data);
                }
            });
        });

        req.on('error', (err) => reject(err));
        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runTests() {
    console.log("=== STARTING BACKEND INTEGRATION TEST ===");

    // 1. Simulate user dropping a drawing file into the sync folder
    console.log("\n[TEST 1] Dropping image 'test_art.png' into sync folder...");
    fs.writeFileSync(testFilePath, Buffer.from(base64Png, 'base64'));

    // Wait 2.5 seconds for Chokidar watcher and Jimp thumbnail generator to run
    console.log("Waiting for filesystem watcher...");
    await new Promise(r => setTimeout(r, 2500));

    // 2. Fetch the gallery list to verify it was automatically indexed
    console.log("\n[TEST 2] Fetching gallery list from /api/gallery...");
    const gallery = await request('GET', '/api/gallery');
    console.log("Gallery:", JSON.stringify(gallery, null, 2));

    if (gallery.length === 0) {
        throw new Error("Gallery is empty! Watcher did not index the file.");
    }
    const entry = gallery[0];
    console.log("SUCCESS: File automatically indexed with hash:", entry.fileHash);
    console.log("Thumbnail generated:", entry.thumbnailPath);

    // 3. Update hoursSpent and Accessed timestamp
    console.log(`\n[TEST 3] Simulating time spent on drawing (setting to 45 hours)...`);
    const accessRes = await request('POST', `/api/gallery/${entry.id}/access`);
    const hoursRes = await request('POST', `/api/gallery/${entry.id}/hours`, { hours: 45 });
    console.log("Updated entry:", JSON.stringify(hoursRes.file, null, 2));

    // Manipulate updatedAt timestamp directly in DB to be 4 months in the past (120 days ago) for testing stagnant detection
    console.log("\n[TEST MANIPULATION] Modifying database record's updatedAt to be 120 days in the past...");
    const fourMonthsAgo = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    db.saveGalleryEntry({
        id: entry.id,
        updatedAt: fourMonthsAgo
    });

    // 4. Test Anti-Burnout Reminder System
    console.log("\n[TEST 4] Triggering Anti-Burnout stagnation check...");
    const burnoutRes = await request('GET', '/api/gallery/burnout-check');
    console.log("Burnout check response:", JSON.stringify(burnoutRes, null, 2));
    if (burnoutRes.burnoutRiskCount > 0) {
        console.log("SUCCESS: Burnout stagnant reminder successfully flagged!");
        console.log("Reminder Text:", burnoutRes.warnings[0].reminderText);
    } else {
        throw new Error("Burnout warning was not flagged.");
    }

    // 5. Test Mock Gemini Artist-Burnout Critique
    console.log("\n[TEST 5] Requesting mock Gemini drawing analysis to fight burnout...");
    const critiqueRes = await request('POST', `/api/gallery/${entry.id}/review`, {
        customPrompt: "Help me, I feel so tired of rendering the anatomy in this piece."
    });
    console.log("Gemini Critique:", critiqueRes.review);
    console.log("Appended chat message:", JSON.stringify(critiqueRes.message, null, 2));

    // Verify Chat History is cached
    const chatHistory = await request('GET', `/api/gallery/${entry.id}/chat`);
    console.log(`Verified local chat history size: ${chatHistory.history.length} messages`);

    // 6. Test Privacy-First Cloud Sync (Mocked)
    console.log("\n[TEST 6] Triggering optional cloud synchronization simulation...");
    const syncRes = await request('POST', `/api/gallery/${entry.id}/sync`);
    console.log("Cloud Sync SyncReceipt:", JSON.stringify(syncRes.syncedPayloadReceipt, null, 2));

    // Verify database state has synced
    const finalGallery = await request('GET', '/api/gallery');
    const finalEntry = finalGallery.find(item => item.id === entry.id);
    console.log("Final database status:", finalEntry.status);
    if (finalEntry.status === 'SYNCED') {
        console.log("\n=== ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY! ===");
    } else {
        throw new Error("Optional sync failed to transition status to SYNCED.");
    }

    // Clean up
    console.log("\nCleaning up test file...");
    fs.unlinkSync(testFilePath);
}

runTests().catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
});
