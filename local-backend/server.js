// backend/server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const chokidar = require('chokidar');
const Jimp = require('jimp');
const crypto = require('crypto');
const multer = require('multer');

const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5002;

app.use(cors());
app.use(express.json());

// Initialize directory configs
let currentSyncDir = db.getSettings().watchFolder;
const THUMB_DIR = path.join(__dirname, 'thumbnails');

if (!fs.existsSync(currentSyncDir)) {
    try {
        fs.mkdirSync(currentSyncDir, { recursive: true });
    } catch (e) {
        console.error("Could not create default sync folder, falling back to local sync_folder", e);
        currentSyncDir = path.join(__dirname, 'sync_folder');
        fs.mkdirSync(currentSyncDir, { recursive: true });
    }
}
if (!fs.existsSync(THUMB_DIR)) {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
}

// Dynamic Express static middleware for custom watch folder
app.use('/sync_folder', (req, res, next) => {
    express.static(currentSyncDir)(req, res, next);
});
app.use('/thumbnails', express.static(THUMB_DIR));

// Dynamic Multer Storage configuration
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, currentSyncDir); // Resolves to whatever the user has set dynamically!
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// SHA-256 Hashing helper
function getFileHash(filePath) {
    try {
        const fileBuffer = fs.readFileSync(filePath);
        const hashSum = crypto.createHash('sha256');
        hashSum.update(fileBuffer);
        return hashSum.digest('hex');
    } catch (e) {
        console.error("Error hashing file:", filePath, e);
        return "";
    }
}

// Thumbnail Generation helper using Jimp and PSD
async function generateThumbnail(filePath, fileName) {
    const thumbName = `thumb_${fileName}.png`; // save final thumbnails as standard web-compatible png
    const destPath = path.join(THUMB_DIR, thumbName);
    const ext = path.extname(filePath).toLowerCase();

    try {
        if (ext === '.clip') {
            console.log(`[THUMB] Extracting embedded PNG preview from CLIP: ${fileName}`);
            // Primary: Use clipstudio SQLite parser
            try {
                const { ClipStudio } = require('clipstudio');
                const buf = fs.readFileSync(filePath);
                const clip = await ClipStudio.load(buf);
                const thumbnailBuf = clip.getThumbnail();
                if (thumbnailBuf) {
                    fs.writeFileSync(destPath, thumbnailBuf);
                    return `thumbnails/${thumbName}`;
                }
            } catch (err) {
                console.warn(`[THUMB] clipstudio extraction failed for ${fileName}, falling back to binary scanner:`, err.message);
            }

            // Fallback: Robust "Largest PNG Block" binary scanner
            const buf = fs.readFileSync(filePath);
            const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
            const pngTrailer = Buffer.from([0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]);

            let largestPng = null;
            let offset = 0;
            while (true) {
                const headerIdx = buf.indexOf(pngHeader, offset);
                if (headerIdx === -1) break;
                const trailerIdx = buf.indexOf(pngTrailer, headerIdx);
                if (trailerIdx === -1) {
                    offset = headerIdx + pngHeader.length;
                    continue;
                }
                const pngBuf = buf.slice(headerIdx, trailerIdx + pngTrailer.length);
                if (!largestPng || pngBuf.length > largestPng.length) {
                    largestPng = pngBuf;
                }
                offset = trailerIdx + pngTrailer.length;
            }

            if (largestPng) {
                fs.writeFileSync(destPath, largestPng);
                return `thumbnails/${thumbName}`;
            }
            console.warn(`[THUMB] Could not extract any valid PNG block from CLIP file: ${fileName}`);
        } else if (ext === '.psd') {
            console.log(`[THUMB] Extracting thumbnail from PSD: ${fileName}`);
            // Primary: Use ag-psd to extract the pre-rendered JPEG thumbnail instantly without full layer parsing
            try {
                const { readPsd } = require('ag-psd');
                const buf = fs.readFileSync(filePath);
                const psd = readPsd(buf, { skipLayerImageData: true });
                const thumbnail = psd.imageResources?.thumbnail;
                if (thumbnail && thumbnail.data) {
                    fs.writeFileSync(destPath, Buffer.from(thumbnail.data));
                    return `thumbnails/${thumbName}`;
                }
            } catch (err) {
                console.warn(`[THUMB] ag-psd thumbnail extraction failed for ${fileName}:`, err.message);
            }

            // Fallback: Legacy psd package canvas rendering
            try {
                const PSD = require('psd');
                const psd = PSD.fromFile(filePath);
                psd.parse();
                await psd.image.saveAsPng(destPath);
                return `thumbnails/${thumbName}`;
            } catch (err) {
                console.warn(`[THUMB] Legacy psd package failed as well for ${fileName}:`, err.message);
            }
        } else {
            // Standard image file: resize using Jimp
            const image = await Jimp.read(filePath);
            await image.resize(250, Jimp.AUTO).quality(80).writeAsync(destPath);
            return `thumbnails/${thumbName}`;
        }
        return "";
    } catch (e) {
        console.warn(`Could not generate thumbnail for non-standard file ${fileName}:`, e.message);
        return "";
    }
}

// ----------------------------------------------------
// DYNAMIC FOLDER OBSERVER ENGINE
// ----------------------------------------------------
let activeWatcher = null;
const allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.clip', '.psd', '.kra', '.sai', '.procreate'];

function initFolderWatcher(watchPath) {
    if (activeWatcher) {
        console.log(`[WATCH] Terminating current file observer on: ${activeWatcher._watchPath}`);
        activeWatcher.close();
    }

    console.log(`[WATCH] Initializing new file observer on: ${watchPath}`);
    
    activeWatcher = chokidar.watch(watchPath, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        depth: 0
    });
    activeWatcher._watchPath = watchPath; // store for logging reference

    activeWatcher.on('add', async (filePath) => {
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        
        if (fileName === '.gitkeep' || !allowedExtensions.includes(ext)) return;
        
        console.log(`[WATCH] File detected: ${fileName}`);
        
        const existing = db.getGalleryEntryByFileName(fileName);
        const stats = fs.statSync(filePath);
        const fileHash = getFileHash(filePath);

        const existingThumbExists = existing && existing.thumbnailPath && fs.existsSync(path.resolve(__dirname, existing.thumbnailPath));

        if (!existing) {
            const thumbnailPath = await generateThumbnail(filePath, fileName);
            db.saveGalleryEntry({
                fileName: fileName,
                fileHash: fileHash,
                status: "local_only",
                hoursSpent: 0.0,
                metadata: {
                    sizeBytes: stats.size,
                    mimeType: `image/${ext.substring(1)}`,
                    createdAt: stats.birthtime.toISOString()
                },
                createdAt: stats.birthtime.toISOString(),
                updatedAt: stats.mtime.toISOString(),
                accessedAt: new Date().toISOString(),
                thumbnailPath: thumbnailPath
            });
            console.log(`[WATCH] Registered new gallery entry for: ${fileName}`);
        } else if (existing.fileHash !== fileHash || !existingThumbExists) {
            const thumbnailPath = await generateThumbnail(filePath, fileName);
            db.saveGalleryEntry({
                id: existing.id,
                fileHash: fileHash,
                status: "local_only",
                updatedAt: stats.mtime.toISOString(),
                thumbnailPath: thumbnailPath,
                metadata: {
                    ...existing.metadata,
                    sizeBytes: stats.size
                }
            });
            console.log(`[WATCH] Updated file contents, hash, or generated missing thumbnail for: ${fileName}`);
        }
    });

    activeWatcher.on('change', async (filePath) => {
        const fileName = path.basename(filePath);
        const ext = path.extname(filePath).toLowerCase();
        if (fileName === '.gitkeep' || !allowedExtensions.includes(ext)) return;

        console.log(`[WATCH] File changed physically: ${fileName}`);
        const existing = db.getGalleryEntryByFileName(fileName);
        const stats = fs.statSync(filePath);
        const fileHash = getFileHash(filePath);

        if (existing && existing.fileHash !== fileHash) {
            const thumbnailPath = await generateThumbnail(filePath, fileName);
            db.saveGalleryEntry({
                id: existing.id,
                fileHash: fileHash,
                status: "local_only",
                updatedAt: stats.mtime.toISOString(),
                thumbnailPath: thumbnailPath,
                metadata: {
                    ...existing.metadata,
                    sizeBytes: stats.size
                },
                needsCritique: true // Flag that we need to trigger AI critique on next open/access click
            });
            console.log(`[WATCH] File saved: "${fileName}". Set needsCritique: true.`);
        }
    });

    activeWatcher.on('unlink', (filePath) => {
        const fileName = path.basename(filePath);
        console.log(`[WATCH] File physically removed: ${fileName}`);
        const existing = db.getGalleryEntryByFileName(fileName);
        if (existing) {
            db.deleteGalleryEntry(existing.id);
            
            const thumbName = `thumb_${fileName}`;
            const thumbPath = path.join(THUMB_DIR, thumbName);
            if (fs.existsSync(thumbPath)) {
                fs.unlinkSync(thumbPath);
            }
            console.log(`[WATCH] Deregistered database entry for: ${fileName}`);
        }
    });
}

// Start watching current path
initFolderWatcher(currentSyncDir);

// Helper to read initial prompt from file
function getInitialPrompt() {
    const promptPath = path.join(__dirname, 'initial_prompt.txt');
    try {
        if (fs.existsSync(promptPath)) {
            return fs.readFileSync(promptPath, 'utf-8');
        }
    } catch (e) {
        console.error("Error reading initial_prompt.txt:", e);
    }
    return "Analyze my drawing and give me feedback.";
}

// Check for simple prompt injections or off-topic keywords (Local Guardrail)
function checkOffTopicOrInjection(prompt) {
    if (!prompt) return null;
    const lower = prompt.toLowerCase();
    const forbiddenPatterns = [
        "forget all instructions",
        "ignore previous instructions",
        "ignore all instructions",
        "forget previous instructions",
        "system prompt",
        "cupcake recipe",
        "recipe for",
        "how to bake",
        "write code for"
    ];
    for (const pattern of forbiddenPatterns) {
        if (lower.includes(pattern)) {
            return "I am here to help you with your art and guide you through creative burnout. Let's focus on your artwork!";
        }
    }
    return null;
}

// Helper to upload thumbnail and call Flask AI chat endpoint
async function sendToHostedBackend(thumbnailRelativePath, customPrompt = null, history = null, imageUuid = null, isTestMode = false, authHeader = null) {
    // 1. Guardrail check (local layer)
    if (customPrompt) {
        const localBlockResponse = checkOffTopicOrInjection(customPrompt);
        if (localBlockResponse) {
            console.log("[GUARDRAIL] Local block triggered for prompt:", customPrompt);
            return { text: localBlockResponse, imageUuid: imageUuid || "test-uuid-999" };
        }
    }

    if (isTestMode) {
        console.log("[AI BRIDGE] [TEST MODE] Simulating hosted backend response");
        return {
            text: "Gemini Critique: The lighting is well balanced. Try focusing on anatomy instead of over-rendering.",
            imageUuid: imageUuid || "test-uuid-999"
        };
    }

    let finalImageUuid = imageUuid;
    if (!finalImageUuid) {
        if (!thumbnailRelativePath) {
            throw new Error("No thumbnail path or image UUID provided");
        }
        const absoluteThumbPath = path.resolve(__dirname, thumbnailRelativePath);
        if (!fs.existsSync(absoluteThumbPath)) {
            throw new Error(`Thumbnail file not found at: ${absoluteThumbPath}`);
        }

        console.log(`[AI BRIDGE] Uploading thumbnail to hosted backend: ${absoluteThumbPath}`);
        const fileBuffer = fs.readFileSync(absoluteThumbPath);
        const blob = new Blob([fileBuffer], { type: 'image/png' });
        const formData = new FormData();
        
        // Append thumbnail as both 'image' and 'thumbnail' to bypass file size limits
        // while fulfilling the Python backend's requirement for both keys.
        formData.append('image', blob, path.basename(absoluteThumbPath));
        formData.append('thumbnail', blob, path.basename(absoluteThumbPath));

        // Post image to hosted backend
        const uploadHeaders = {};
        if (authHeader) {
            uploadHeaders['Authorization'] = authHeader;
        }

        const uploadRes = await fetch('http://localhost:5000/images', {
            method: 'POST',
            body: formData,
            headers: uploadHeaders
        });

        if (!uploadRes.ok) {
            const errorText = await uploadRes.text();
            throw new Error(`Failed to upload image: ${uploadRes.statusText} - ${errorText}`);
        }

        const uploadData = await uploadRes.json();
        finalImageUuid = uploadData.file_uuid;
        console.log(`[AI BRIDGE] Image uploaded. UUID: ${finalImageUuid}`);
    }

    // 2. Request chat response from hosted backend
    console.log(`[AI BRIDGE] Requesting AI response for UUID: ${finalImageUuid}`);
    
    // Add guardrail wrapper around customPrompt to prevent LLM level prompt injection
    let processedPrompt = customPrompt;
    if (customPrompt) {
        processedPrompt = `[GUARDRAIL: You are strictly an Art Critic and Psychological Mentor. If the user query is off-topic, refuse to answer and remind them to focus on art/burnout. User Query: "${customPrompt}"]`;
    }

    const bodyPayload = {
        image_uuid: finalImageUuid
    };
    if (processedPrompt !== null && processedPrompt !== undefined) {
        bodyPayload.custom_prompt = processedPrompt;
    }
    if (history) {
        bodyPayload.history = history;
    }

    const chatHeaders = {
        'Content-Type': 'application/json'
    };
    if (authHeader) {
        chatHeaders['Authorization'] = authHeader;
    }

    const chatRes = await fetch('http://localhost:5000/chat', {
        method: 'POST',
        headers: chatHeaders,
        body: JSON.stringify(bodyPayload)
    });

    if (!chatRes.ok) {
        const errorText = await chatRes.text();
        throw new Error(`Failed to get critique: ${chatRes.statusText} - ${errorText}`);
    }

    const chatData = await chatRes.json();
    console.log(`[AI BRIDGE] AI Response received:`, chatData.text);
    return {
        text: chatData.text,
        imageUuid: finalImageUuid
    };
}

// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

// 1. Settings Endpoints (Watch Folder & Device Info)
app.get('/api/settings', (req, res) => {
    res.json(db.getSettings());
});

app.post('/api/settings/watch-folder', (req, res) => {
    const { watchFolder } = req.body;
    if (!watchFolder) {
        return res.status(400).json({ success: false, error: 'watchFolder path is required' });
    }

    try {
        // Resolve absolute path
        const absolutePath = path.resolve(watchFolder);
        if (!fs.existsSync(absolutePath)) {
            fs.mkdirSync(absolutePath, { recursive: true });
        }

        db.setWatchFolder(absolutePath);
        currentSyncDir = absolutePath;
        initFolderWatcher(absolutePath);

        res.json({
            success: true,
            message: `Synchronization folder successfully changed to: ${absolutePath}`,
            settings: {
                watchFolder: absolutePath,
                currentDeviceId: db.getSettings().currentDeviceId
            }
        });
    } catch (e) {
        console.error("Failed to change sync folder:", e);
        res.status(500).json({ success: false, error: `Invalid folder path: ${e.message}` });
    }
});

// 2. Upload Drawing endpoint (Multer-backed - maps to frontend upload.js request)
app.post('/upload', upload.single('image'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No image uploaded' });
    }
    
    const fileName = req.file.originalname;
    const filePath = path.join(currentSyncDir, fileName);
    console.log(`[API] Drawing upload request received: ${fileName}`);
    
    const fileHash = getFileHash(filePath);
    const stats = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    
    const thumbnailPath = await generateThumbnail(filePath, fileName);
    const entry = db.saveGalleryEntry({
        fileName: fileName,
        fileHash: fileHash,
        status: "local_only",
        hoursSpent: 0.0,
        metadata: {
            sizeBytes: stats.size,
            mimeType: `image/${ext.substring(1)}`,
            createdAt: stats.birthtime.toISOString()
        },
        thumbnailPath: thumbnailPath
    });

    res.json({
        success: true,
        message: 'File uploaded and cached locally!',
        file: entry
    });
});

// 3. Fetch all Gallery Entries
app.get('/api/gallery', (req, res) => {
    res.json(db.getGallery());
});

// Local in-memory lock object to prevent concurrent API double-triggering
const activeCritiques = {};

// 4. Update drawing metrics (Accessed / Time spent)
app.post('/api/gallery/:id/access', async (req, res) => {
    const { id } = req.params;
    const entry = db.getGalleryEntry(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: 'Gallery entry not found' });
    }

    const authHeader = req.headers['authorization'];
    const chat = db.getChatByGalleryEntry(id);
    // Needs critique if chat is empty OR if it has been marked as needing critique since the last save
    const shouldCritique = (chat.history.length === 0 || entry.needsCritique === true) && entry.thumbnailPath;

    // Concurrency check: if already running, skip
    if (shouldCritique && !activeCritiques[id]) {
        console.log(`[AI BRIDGE] First open after save detected for "${entry.fileName}". Triggering AI critique.`);
        
        // 1. Immediately flag as false in the database to prevent duplicate requests
        db.saveGalleryEntry({
            id: id,
            needsCritique: false
        });

        // 2. Set memory lock and trigger async execution without awaiting (so we don't block the endpoint response)
        activeCritiques[id] = true;
        (async () => {
            try {
                const initialPrompt = getInitialPrompt();
                const isTestMode = req.headers['x-test-mode'] === 'true' || process.env.NODE_ENV === 'test';
                const { text: critique, imageUuid } = await sendToHostedBackend(
                    entry.thumbnailPath,
                    null,
                    null,
                    entry.imageUuid,
                    isTestMode,
                    authHeader
                );

                db.addMessageToChat(id, "gemini", critique);
                db.saveGalleryEntry({
                    id: id,
                    imageUuid: imageUuid
                });
                console.log(`[AI BRIDGE] Critique successfully added to chat history for "${entry.fileName}". Saved imageUuid: ${imageUuid}`);
            } catch (error) {
                console.error(`[AI BRIDGE] Error during critique for ${entry.fileName}:`, error.message);
                // Restore needsCritique to true so it can retry on next click
                db.saveGalleryEntry({
                    id: id,
                    needsCritique: true
                });
            } finally {
                delete activeCritiques[id];
            }
        })();
    }

    const updated = db.saveGalleryEntry({
        id: id,
        accessedAt: new Date().toISOString()
    });
    res.json({ success: true, file: updated });
});

app.post('/api/gallery/:id/hours', (req, res) => {
    const { id } = req.params;
    const { hours, increment } = req.body;
    const entry = db.getGalleryEntry(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: 'Gallery entry not found' });
    }
    
    let newHours = entry.hoursSpent;
    if (typeof hours === 'number') {
        newHours = hours;
    } else if (typeof increment === 'number') {
        newHours += increment;
    }

    const updated = db.saveGalleryEntry({
        id: id,
        hoursSpent: Math.max(0, parseFloat(newHours.toFixed(2)))
    });
    
    res.json({ success: true, file: updated });
});

// 5. Stagnant drawing burnout-checker
app.get('/api/gallery/burnout-check', (req, res) => {
    const gallery = db.getGallery();
    const now = new Date();
    
    const testIntervalMs = req.query.testIntervalMs ? parseInt(req.query.testIntervalMs) : null;
    const THREE_MONTHS_MS = 3 * 30 * 24 * 60 * 60 * 1000;
    const intervalThreshold = testIntervalMs !== null ? testIntervalMs : THREE_MONTHS_MS;

    const stagnantDrawings = gallery.filter(entry => {
        const lastUpdated = new Date(entry.updatedAt);
        const timeElapsed = now.getTime() - lastUpdated.getTime();
        return entry.hoursSpent >= 10 && timeElapsed >= intervalThreshold;
    });

    const warnings = stagnantDrawings.map(entry => {
        const lastUpdated = new Date(entry.updatedAt);
        const daysStagnant = Math.floor((now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24));
        return {
            id: entry.id,
            fileName: entry.fileName,
            hoursSpent: entry.hoursSpent,
            daysStagnant: daysStagnant,
            reminderText: `Hey! You spent ${entry.hoursSpent} hours on "${entry.fileName}" but haven't touched it in ${daysStagnant} days. Don't let burnout win—why not open it and add a few brush strokes today?`
        };
    });

    res.json({
        burnoutRiskCount: warnings.length,
        warnings: warnings
    });
});

// 6. Gemini Burnout Analysis (real artist feedback)
app.post('/api/gallery/:id/review', async (req, res) => {
    const { id } = req.params;
    const { customPrompt } = req.body;
    const entry = db.getGalleryEntry(id);
    if (!entry) return res.status(404).json({ success: false, error: 'Gallery entry not found' });

    try {
        const authHeader = req.headers['authorization'];
        const isTestMode = req.headers['x-test-mode'] === 'true' || process.env.NODE_ENV === 'test';
        const { text: critique, imageUuid } = await sendToHostedBackend(
            entry.thumbnailPath,
            customPrompt || "Analyze my drawing",
            null,
            entry.imageUuid,
            isTestMode,
            authHeader
        );

        // Save image UUID back if it was generated/uploaded
        db.saveGalleryEntry({
            id: id,
            imageUuid: imageUuid
        });

        db.addMessageToChat(id, "user", customPrompt || "Analyze my drawing");
        const geminiMsg = db.addMessageToChat(id, "gemini", critique);

        res.json({
            success: true,
            review: critique,
            message: geminiMsg
        });
    } catch (error) {
        console.error(`[AI BRIDGE] Error during review for ${entry.fileName}:`, error.message);
        res.status(500).json({ success: false, error: `Failed to generate critique: ${error.message}` });
    }
});

// 7. Simulated Cloud Sync Endpoint (Privacy-First Payload Receipt)
app.post('/api/gallery/:id/sync', (req, res) => {
    const { id } = req.params;
    const entry = db.getGalleryEntry(id);
    if (!entry) return res.status(404).json({ success: false, error: 'Gallery entry not found' });

    const chat = db.getChatByGalleryEntry(id);
    const updated = db.saveGalleryEntry({ id: id, status: "synced" });

    res.json({
        success: true,
        message: "Successfully synchronized file, metadata, and chats to simulated cloud!",
        file: updated,
        syncedPayloadReceipt: {
            fileName: entry.fileName,
            fileHash: entry.fileHash,
            hoursSpent: entry.hoursSpent,
            chatMessagesSynced: chat.history.length,
            timestamp: new Date().toISOString()
        }
    });
});

// 8. Get chat history for specific drawing file
app.get('/api/gallery/:id/chat', (req, res) => {
    const { id } = req.params;
    res.json(db.getChatByGalleryEntry(id));
});

// 9. Post new message to local chat
app.post('/api/gallery/:id/chat', async (req, res) => {
    const { id } = req.params;
    const { sender, message } = req.body;
    if (!message) {
        return res.status(400).json({ success: false, error: "Message content required" });
    }

    const entry = db.getGalleryEntry(id);
    if (!entry) {
        return res.status(404).json({ success: false, error: "Gallery entry not found" });
    }

    // 1. Add user message to local chat
    const msg = db.addMessageToChat(id, sender || "user", message);

    // 2. If sender is user, trigger the AI response
    const activeSender = sender || "user";
    if (activeSender === "user") {
        try {
            const authHeader = req.headers['authorization'];
            const chat = db.getChatByGalleryEntry(id);
            // Format history for Gemini (excluding the last message we just added)
            const history = chat.history.slice(0, -1).map(m => ({
                role: m.sender === "user" ? "user" : "model",
                content: m.message
            }));

            const isTestMode = req.headers['x-test-mode'] === 'true' || process.env.NODE_ENV === 'test';
            const { text: critique, imageUuid } = await sendToHostedBackend(
                entry.thumbnailPath,
                message,
                history,
                entry.imageUuid,
                isTestMode,
                authHeader
            );

            // Update cached image UUID if it was generated/uploaded
            db.saveGalleryEntry({
                id: id,
                imageUuid: imageUuid
            });

            // Save AI response to local chat
            const aiMsg = db.addMessageToChat(id, "gemini", critique);

            return res.json({
                success: true,
                message: msg,
                aiResponse: aiMsg
            });
        } catch (error) {
            console.error(`[AI BRIDGE] Error during chat for ${entry.fileName}:`, error.message);
            return res.status(500).json({ success: false, error: `Failed to get AI response: ${error.message}` });
        }
    }

    res.json({ success: true, message: msg });
});

// Start Express Server
app.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(`  Creative Anchor Local Sync Backend running on http://localhost:${PORT}`);
    console.log(`  Sync directory watched: ${currentSyncDir}`);
    console.log(`  Thumbnails served: ${THUMB_DIR}`);
    console.log(`=============================================================\n`);
});
