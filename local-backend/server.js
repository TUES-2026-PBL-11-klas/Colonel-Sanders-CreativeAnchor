// backend/server.js
require('dotenv').config();
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

            let additionalHours = 0.0;
            if (existing.updatedAt) {
                const prevTime = new Date(existing.updatedAt).getTime();
                const currTime = stats.mtime.getTime();
                const diffMs = currTime - prevTime;
                const threeHoursMs = 3 * 60 * 60 * 1000;

                if (diffMs > 0 && diffMs < threeHoursMs) {
                    additionalHours = diffMs / (1000 * 60 * 60);
                } else if (diffMs >= threeHoursMs) {
                    additionalHours = 0.25; // default 15 min session start increment
                }
            }
            const newHoursSpent = (existing.hoursSpent || 0.0) + additionalHours;

            db.saveGalleryEntry({
                id: existing.id,
                fileHash: fileHash,
                status: "local_only",
                hoursSpent: Math.max(0, parseFloat(newHoursSpent.toFixed(2))),
                updatedAt: stats.mtime.toISOString(),
                thumbnailPath: thumbnailPath,
                metadata: {
                    ...existing.metadata,
                    sizeBytes: stats.size
                },
                needsCritique: true // Flag that we need to trigger AI critique on next open/access click
            });
            console.log(`[WATCH] File saved: "${fileName}". Estimated hoursSpent: ${newHoursSpent.toFixed(2)}. Set needsCritique: true.`);
        }
    });

    activeWatcher.on('unlink', (filePath) => {
        const fileName = path.basename(filePath);
        console.log(`[WATCH] File physically removed: ${fileName}`);
        const existing = db.getGalleryEntryByFileName(fileName);
        if (existing) {
            if (existing.status === 'synced') {
                console.log(`[WATCH] File physically removed: ${fileName}. Drawing is cloud-synced, preserving entry and chat history.`);
            } else {
                db.deleteGalleryEntry(existing.id);
                
                const thumbName = `thumb_${fileName}`;
                const thumbPath = path.join(THUMB_DIR, thumbName);
                if (fs.existsSync(thumbPath)) {
                    fs.unlinkSync(thumbPath);
                }
                console.log(`[WATCH] Deregistered database entry for: ${fileName}`);
            }
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

// ── Debug logger ─────────────────────────────────────────────────────────────
// Writes to console AND appends to ai_debug.log for persistent inspection.
const LOG_FILE = path.join(__dirname, 'ai_debug.log');
function writeLog(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
    console.log(line);
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

// Helper to call Flask AI chat endpoint by sending thumbnail bytes directly.
// This bypasses Supabase storage entirely (avoids RLS policy issues).
async function sendToHostedBackend(thumbnailRelativePath, customPrompt = null, history = null, imageUuid = null, isTestMode = false, authHeader = null) {
    writeLog(`[AI] ======== New AI request ========`);
    writeLog(`[AI] Auth header present: ${!!authHeader}`);
    writeLog(`[AI] thumbnailPath: ${thumbnailRelativePath || 'none'}`);
    writeLog(`[AI] customPrompt: ${customPrompt ? customPrompt.substring(0, 100) + '...' : 'none (system prompt only)'}`);

    // 1. Guardrail check (local layer)
    if (customPrompt) {
        const localBlockResponse = checkOffTopicOrInjection(customPrompt);
        if (localBlockResponse) {
            writeLog(`[AI] GUARDRAIL blocked prompt`);
            return { text: localBlockResponse, imageUuid: null };
        }
    }

    if (isTestMode) {
        writeLog(`[AI] TEST MODE — returning simulated response`);
        return {
            text: "Gemini Critique: The lighting is well balanced. Try focusing on anatomy instead of over-rendering.",
            imageUuid: null
        };
    }

    // 2. Wrap customPrompt in guardrail for LLM-level prompt injection protection
    let processedPrompt = customPrompt;
    if (customPrompt) {
        processedPrompt = `[GUARDRAIL: You are strictly an Art Critic and Psychological Mentor. If the user query is off-topic, refuse to answer and remind them to focus on art/burnout. User Query: "${customPrompt}"]`;
    }

    const pythonApiUrl = process.env.API_BASE_URL || 'http://localhost:5000';

    // If file is already cloud-synced, fetch using imageUuid instead of local files
    if (imageUuid && authHeader) {
        writeLog(`[AI] Synced drawing detected (imageUuid: ${imageUuid}). POST /chat to Python backend...`);
        const chatRes = await fetch(`${pythonApiUrl}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify({
                image_uuid: imageUuid,
                custom_prompt: processedPrompt,
                history: history
            })
        });

        writeLog(`[AI] /chat response: ${chatRes.status} ${chatRes.statusText}`);

        if (!chatRes.ok) {
            const errorText = await chatRes.text();
            writeLog(`[AI] /chat error body: ${errorText}`);
            throw new Error(`Chat failed (${chatRes.status}): ${errorText}`);
        }

        const chatData = await chatRes.json();
        writeLog(`[AI] Success. Response length: ${chatData.text ? chatData.text.length : 0} chars`);
        return {
            text: chatData.text,
            imageUuid: imageUuid
        };
    }

    if (!thumbnailRelativePath) {
        throw new Error("No thumbnail path provided for this gallery entry.");
    }

    const absoluteThumbPath = path.resolve(__dirname, thumbnailRelativePath);
    if (!fs.existsSync(absoluteThumbPath)) {
        throw new Error(`Thumbnail file not found at: ${absoluteThumbPath}`);
    }

    // 3. Send image bytes directly to Flask /chat/direct — no Supabase storage needed
    writeLog(`[AI] Reading thumbnail: ${absoluteThumbPath}`);
    const fileBuffer = fs.readFileSync(absoluteThumbPath);
    const blob = new Blob([fileBuffer], { type: 'image/png' });

    const formData = new FormData();
    formData.append('image', blob, path.basename(absoluteThumbPath));
    if (processedPrompt) {
        formData.append('custom_prompt', processedPrompt);
    }
    if (history && history.length > 0) {
        formData.append('history', JSON.stringify(history));
    }

    const headers = {};
    if (authHeader) {
        headers['Authorization'] = authHeader;
    } else {
        writeLog(`[AI] WARNING: No auth header — Flask will reject with 401`);
    }

    writeLog(`[AI] POST /chat/direct | prompt: ${processedPrompt ? 'yes' : 'none'} | history: ${history ? history.length : 0} msgs`);

    const chatRes = await fetch(`${pythonApiUrl}/chat/direct`, {
        method: 'POST',
        headers,
        body: formData,
    });

    writeLog(`[AI] /chat/direct response: ${chatRes.status} ${chatRes.statusText}`);

    if (!chatRes.ok) {
        const errorText = await chatRes.text();
        writeLog(`[AI] /chat/direct error body: ${errorText}`);
        throw new Error(`Chat failed (${chatRes.status}): ${errorText}`);
    }

    const chatData = await chatRes.json();
    writeLog(`[AI] Success. Response length: ${chatData.text ? chatData.text.length : 0} chars`);
    return {
        text: chatData.text,
        imageUuid: null   // no longer using Supabase storage UUIDs
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

// Endpoint to clear local cache
app.post('/api/settings/clear-cache', (req, res) => {
    try {
        // 1. Reset database
        db.resetDb();

        // 2. Clear thumbnails directory contents
        if (fs.existsSync(THUMB_DIR)) {
            const files = fs.readdirSync(THUMB_DIR);
            for (const file of files) {
                if (file !== '.gitkeep') {
                    try {
                        fs.unlinkSync(path.join(THUMB_DIR, file));
                    } catch (err) {
                        console.warn(`Could not delete thumbnail file ${file}:`, err.message);
                    }
                }
            }
        }

        // 3. Re-initialize folder watcher on current sync dir
        initFolderWatcher(currentSyncDir);

        res.json({ success: true, message: "Local cache and thumbnails cleared successfully." });
    } catch (e) {
        console.error("Failed to clear local cache:", e);
        res.status(500).json({ success: false, error: e.message });
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

// 3. Fetch all Gallery Entries (Merged with cloud entries if authenticated)
app.get('/api/gallery', async (req, res) => {
    const localEntries = db.getGallery();
    const watchPath = db.getSettings().watchFolder;
    const mergedMap = new Map();

    // Map local entries first, verifying physical file existence
    localEntries.forEach(entry => {
        const filePath = path.join(watchPath, entry.fileName);
        const exists = fs.existsSync(filePath);
        mergedMap.set(entry.fileName, { ...entry, localFileExists: exists });
    });

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.json(Array.from(mergedMap.values()));
    }

    const pythonApiUrl = process.env.API_BASE_URL || 'http://localhost:5000';
    try {
        const cloudRes = await fetch(`${pythonApiUrl}/images`, {
            method: 'GET',
            headers: {
                'Authorization': authHeader
            }
        });

        if (!cloudRes.ok) {
            console.warn(`[GALLERY MERGE] Failed to fetch cloud entries: ${cloudRes.status}`);
            return res.json(Array.from(mergedMap.values()));
        }

        const cloudEntries = await cloudRes.json();

        for (const cloudEntry of cloudEntries) {
            const local = mergedMap.get(cloudEntry.file_name);
            if (local) {
                let changed = false;
                if (local.imageUuid !== cloudEntry.id) {
                    local.imageUuid = cloudEntry.id;
                    changed = true;
                }

                // Check sync/master status based on hash comparison
                const match = local.fileHash === cloudEntry.file_hash_sha256;
                const newStatus = match ? 'synced' : local.status;
                if (local.status !== newStatus) {
                    local.status = newStatus;
                    changed = true;
                }

                local.isMasterCopy = match;

                // Download/Cache thumbnail if it's synced but missing locally
                const localThumbFilePath = path.join(THUMB_DIR, `${cloudEntry.id}.png`);
                if (!fs.existsSync(localThumbFilePath)) {
                    try {
                        const thumbRes = await fetch(`${pythonApiUrl}/images/${cloudEntry.id}/thumbnail`, {
                            headers: { 'Authorization': authHeader }
                        });
                        if (thumbRes.ok) {
                            const buffer = await thumbRes.arrayBuffer();
                            fs.writeFileSync(localThumbFilePath, Buffer.from(buffer));
                            local.thumbnailPath = `thumbnails/${cloudEntry.id}.png`;
                            changed = true;
                        }
                    } catch (err) {
                        console.warn(`[THUMB CACHE] Failed to download thumbnail for ${cloudEntry.file_name}:`, err.message);
                    }
                }

                if (changed) {
                    db.saveGalleryEntry({
                        id: local.id,
                        imageUuid: local.imageUuid,
                        status: local.status,
                        thumbnailPath: local.thumbnailPath
                    });
                }
                mergedMap.set(cloudEntry.file_name, local);
            } else {
                // Cloud-only entry: Save stub in local SQLite to maintain chat logs locally
                const localThumbFilePath = path.join(THUMB_DIR, `${cloudEntry.id}.png`);
                let thumbnailPath = "";
                if (!fs.existsSync(localThumbFilePath)) {
                    try {
                        const thumbRes = await fetch(`${pythonApiUrl}/images/${cloudEntry.id}/thumbnail`, {
                            headers: { 'Authorization': authHeader }
                        });
                        if (thumbRes.ok) {
                            const buffer = await thumbRes.arrayBuffer();
                            fs.writeFileSync(localThumbFilePath, Buffer.from(buffer));
                            thumbnailPath = `thumbnails/${cloudEntry.id}.png`;
                        }
                    } catch (err) {
                        console.warn(`[THUMB CACHE] Failed to download thumbnail for cloud-only ${cloudEntry.file_name}:`, err.message);
                    }
                } else {
                    thumbnailPath = `thumbnails/${cloudEntry.id}.png`;
                }

                mergedMap.set(cloudEntry.file_name, {
                    id: cloudEntry.id,
                    fileName: cloudEntry.file_name,
                    status: 'synced',
                    fileHash: cloudEntry.file_hash_sha256,
                    hoursSpent: 0.0,
                    thumbnailPath: thumbnailPath,
                    createdAt: cloudEntry.created_at,
                    updatedAt: cloudEntry.last_modified_at,
                    localFileExists: false,
                    isMasterCopy: false
                });
            }
        }

        res.json(Array.from(mergedMap.values()));
    } catch (e) {
        console.warn("[GALLERY MERGE] Error merging local and cloud galleries:", e.message);
        res.json(Array.from(mergedMap.values()));
    }
});

// Local in-memory lock object to prevent concurrent API double-triggering
const activeCritiques = {};

// 4. Update drawing metrics (Accessed / Time spent)
app.post('/api/gallery/:id/access', async (req, res) => {
    const { id } = req.params;
    const entry = db.getGalleryEntry(id);
    if (!entry) {
        // Return a mock in-memory entry for cloud-only drawings so UI select succeeds
        return res.json({
            success: true,
            file: {
                id: id,
                fileName: "cloud_drawing",
                status: "synced",
                hoursSpent: 0.0,
                thumbnailPath: `thumbnails/${id}.png`,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                accessedAt: new Date().toISOString(),
                localFileExists: false,
                isMasterCopy: false
            }
        });
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
    const { customPrompt, skipUserMessage } = req.body;
    const entry = db.getGalleryEntry(id);
    if (!entry) return res.status(404).json({ success: false, error: 'Gallery entry not found' });

    // Prevent race condition duplicate critique calls
    if (activeCritiques[id]) {
        writeLog(`[REVIEW] Critique already in progress for "${entry.fileName}". Waiting for lock release...`);
        while (activeCritiques[id]) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        const chat = db.getChatByGalleryEntry(id);
        const latestMsg = chat.history[chat.history.length - 1];
        if (latestMsg && latestMsg.sender === 'gemini') {
            writeLog(`[REVIEW] Returning lock-released pre-generated critique for "${entry.fileName}" to avoid duplicate.`);
            return res.json({ success: true, review: latestMsg.message, message: latestMsg });
        }
    }

    try {
        const authHeader = req.headers['authorization'];
        writeLog(`[REVIEW] id=${id} | skipUserMessage=${!!skipUserMessage} | authPresent=${!!authHeader} | customPrompt=${customPrompt ? 'yes' : 'none'}`);

        const isTestMode = req.headers['x-test-mode'] === 'true' || process.env.NODE_ENV === 'test';

        // Fight Burnout (skipUserMessage=true) uses the predefined initial prompt.
        // Regular user messages use customPrompt. Fallback to a default.
        const effectivePrompt = customPrompt || (skipUserMessage ? getInitialPrompt() : 'Analyze my drawing');

        const { text: critique, imageUuid } = await sendToHostedBackend(
            entry.thumbnailPath,
            effectivePrompt,
            null,
            entry.imageUuid,
            isTestMode,
            authHeader
        );

        db.saveGalleryEntry({ id, imageUuid });

        if (!skipUserMessage) {
            db.addMessageToChat(id, "user", customPrompt || 'Analyze my drawing');
        }
        const geminiMsg = db.addMessageToChat(id, "gemini", critique);

        res.json({ success: true, review: critique, message: geminiMsg });
    } catch (error) {
        writeLog(`[REVIEW] ERROR for ${entry.fileName}: ${error.message}`);
        console.error(`[AI BRIDGE] Error during review for ${entry.fileName}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 7. Cloud Sync Endpoint (Privacy-First Payload Sync to Python Backend)
app.post('/api/gallery/:id/sync', async (req, res) => {
    const { id } = req.params;
    const entry = db.getGalleryEntry(id);
    if (!entry) {
        console.error(`[SYNC ERROR] Gallery entry not found: ${id}`);
        return res.status(404).json({ success: false, error: 'Gallery entry not found' });
    }

    const isTestMode = req.headers['x-test-mode'] === 'true' || process.env.NODE_ENV === 'test';
    if (isTestMode) {
        console.log(`[SYNC] Running in TEST MODE. Mocking cloud sync success...`);
        const updated = db.saveGalleryEntry({ id: id, status: "synced" });
        return res.json({
            success: true,
            message: "Successfully synchronized file, metadata, and chats to simulated cloud!",
            file: updated,
            syncedPayloadReceipt: {
                fileName: entry.fileName,
                fileHash: entry.fileHash,
                hoursSpent: entry.hoursSpent,
                timestamp: new Date().toISOString()
            }
        });
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        console.error(`[SYNC ERROR] Authorization token missing in request for ${entry.fileName}`);
        return res.status(401).json({ success: false, error: 'Authorization token required for cloud sync' });
    }

    const pythonApiUrl = process.env.API_BASE_URL || 'http://localhost:5000';
    console.log(`\n--- STARTING CLOUD SYNC FOR: ${entry.fileName} ---`);
    console.log(`[SYNC] Python backend URL: ${pythonApiUrl}`);

    try {
        const imagePath = path.resolve(currentSyncDir, entry.fileName);
        const thumbPath = path.resolve(__dirname, entry.thumbnailPath);

        console.log(`[SYNC] Image physical path: ${imagePath}`);
        console.log(`[SYNC] Thumbnail physical path: ${thumbPath}`);

        if (!fs.existsSync(imagePath)) {
            throw new Error(`Original image file does not exist at: ${imagePath}`);
        }
        if (!fs.existsSync(thumbPath)) {
            throw new Error(`Thumbnail image file does not exist at: ${thumbPath}`);
        }

        // 1. Upload files (Image & Thumbnail) to cloud backend
        const formData = new FormData();
        const imageBuffer = fs.readFileSync(imagePath);
        const thumbBuffer = fs.readFileSync(thumbPath);

        // Append files using blobs
        formData.append('image', new Blob([imageBuffer], { type: 'image/png' }), entry.fileName);
        formData.append('thumbnail', new Blob([thumbBuffer], { type: 'image/png' }), path.basename(thumbPath));

        console.log(`[SYNC] Sending files POST to ${pythonApiUrl}/images...`);
        const filesRes = await fetch(`${pythonApiUrl}/images`, {
            method: 'POST',
            headers: {
                'Authorization': authHeader
            },
            body: formData
        });

        if (!filesRes.ok) {
            const errText = await filesRes.text();
            throw new Error(`Python files upload failed with status ${filesRes.status}: ${errText}`);
        }

        const filesData = await filesRes.json();
        const fileUuid = filesData.file_uuid;
        console.log(`[SYNC] File uploaded successfully. Assigned file_uuid: ${fileUuid}`);

        // 2. Upload metadata to cloud backend
        const metadataBody = {
            id: fileUuid,
            fileName: entry.fileName,
            entryStatus: 'in_progress',
            syncStatus: 'synced',
            fileHash: entry.fileHash,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt
        };

        console.log(`[SYNC] Sending metadata POST to ${pythonApiUrl}/images/metadata...`);
        const metaRes = await fetch(`${pythonApiUrl}/images/metadata`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader
            },
            body: JSON.stringify(metadataBody)
        });

        if (!metaRes.ok) {
            const errText = await metaRes.text();
            throw new Error(`Python metadata upload failed with status ${metaRes.status}: ${errText}`);
        }

        console.log(`[SYNC] Metadata uploaded successfully. Updating local database...`);
        const updated = db.saveGalleryEntry({ id: id, status: "synced" });

        // Sync local chat history to the cloud backend
        const chat = db.getChatByGalleryEntry(id);
        if (chat && chat.history && chat.history.length > 0) {
            console.log(`[SYNC] Syncing chat history (${chat.history.length} messages) for ${entry.fileName}...`);
            await fetch(`${pythonApiUrl}/chat/gallery/${fileUuid}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': authHeader
                },
                body: JSON.stringify({ history: chat.history })
            }).catch(err => console.warn("[SYNC CHAT ERROR]", err.message));
        }

        console.log(`--- CLOUD SYNC SUCCESSFUL FOR: ${entry.fileName} ---\n`);

        res.json({
            success: true,
            message: "Successfully synchronized file, metadata, and chats to cloud!",
            file: updated
        });

    } catch (error) {
        console.error(`\n[SYNC ERROR] failed for ${entry.fileName}:`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 8. Get chat history for specific drawing file
app.get('/api/gallery/:id/chat', async (req, res) => {
    const { id } = req.params;
    const authHeader = req.headers['authorization'];
    
    // Check local database first
    let chat = db.getChatByGalleryEntry(id);
    
    // If authenticated and local history is empty, try to fetch from Python backend
    if (authHeader && (!chat.history || chat.history.length === 0)) {
        const pythonApiUrl = process.env.API_BASE_URL || 'http://localhost:5000';
        try {
            const entry = db.getGalleryEntry(id);
            const uuidToFetch = entry ? (entry.imageUuid || entry.id) : id;
            
            const cloudChatRes = await fetch(`${pythonApiUrl}/chat/gallery/${uuidToFetch}`, {
                headers: { 'Authorization': authHeader }
            });
            if (cloudChatRes.ok) {
                const cloudChatData = await cloudChatRes.json();
                if (cloudChatData.history && cloudChatData.history.length > 0) {
                    // Save all cloud messages to local database
                    const dbRaw = db.readDb();
                    const chatIdx = dbRaw.chats.findIndex(c => c.galleryEntryId === id);
                    if (chatIdx !== -1) {
                        dbRaw.chats[chatIdx].history = [];
                        db.writeDb(dbRaw);
                    }
                    
                    for (const msg of cloudChatData.history) {
                        db.addMessageToChat(id, msg.sender, msg.message);
                    }
                    // Refresh chat object
                    chat = db.getChatByGalleryEntry(id);
                }
            }
        } catch (err) {
            console.warn(`[CHAT MERGE] Failed to fetch cloud chats for ${id}:`, err.message);
        }
    }
    
    res.json(chat);
});

// 9. Post new message to local chat
app.post('/api/gallery/:id/chat', async (req, res) => {
    const { id } = req.params;
    const { sender, message } = req.body;
    if (!message) {
        return res.status(400).json({ success: false, error: "Message content required" });
    }

    let entry = db.getGalleryEntry(id);
    const isCloudOnly = !entry;
    if (isCloudOnly) {
        // Mock entry details for cloud-only synced drawing
        entry = {
            id: id,
            imageUuid: id,
            status: 'synced',
            fileName: 'cloud_drawing',
            thumbnailPath: `thumbnails/${id}.png`
        };
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

            // Update cached image UUID if it was generated/uploaded (only if not cloud-only stub)
            if (!isCloudOnly) {
                db.saveGalleryEntry({
                    id: id,
                    imageUuid: imageUuid
                });
            }

            // Save AI response to local chat
            const aiMsg = db.addMessageToChat(id, "gemini", critique);

            // Sync updated chat history to the cloud backend
            if (authHeader) {
                const pythonApiUrl = process.env.API_BASE_URL || 'http://localhost:5000';
                const updatedChat = db.getChatByGalleryEntry(id);
                const uuidToSync = isCloudOnly ? id : (entry.imageUuid || id);
                await fetch(`${pythonApiUrl}/chat/gallery/${uuidToSync}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': authHeader
                    },
                    body: JSON.stringify({ history: updatedChat.history })
                }).catch(err => console.warn("[SYNC CHAT ON MESSAGE ERROR]", err.message));
            }

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

// Force folder scan (synchronous sync with filesystem)
app.post('/api/gallery/scan', async (req, res) => {
    try {
        const watchPath = db.getSettings().watchFolder;
        if (!watchPath || !fs.existsSync(watchPath)) {
            return res.json({ success: true, message: "No watch folder configured or folder does not exist" });
        }

        const files = fs.readdirSync(watchPath);
        for (const file of files) {
            const filePath = path.join(watchPath, file);
            const ext = path.extname(file).toLowerCase();
            if (file === '.gitkeep' || !allowedExtensions.includes(ext)) continue;
            
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) continue;
            
            const fileHash = getFileHash(filePath);
            const existing = db.getGalleryEntryByFileName(file);
            const existingThumbExists = existing && existing.thumbnailPath && fs.existsSync(path.resolve(__dirname, existing.thumbnailPath));

            if (!existing) {
                const thumbnailPath = await generateThumbnail(filePath, file);
                db.saveGalleryEntry({
                    fileName: file,
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
            } else if (existing.fileHash !== fileHash || !existingThumbExists) {
                const thumbnailPath = await generateThumbnail(filePath, file);
                
                let additionalHours = 0.0;
                if (existing.updatedAt) {
                    const prevTime = new Date(existing.updatedAt).getTime();
                    const currTime = stats.mtime.getTime();
                    const diffMs = currTime - prevTime;
                    const threeHoursMs = 3 * 60 * 60 * 1000;
                    
                    if (diffMs > 0 && diffMs < threeHoursMs) {
                        additionalHours = diffMs / (1000 * 60 * 60);
                    } else if (diffMs >= threeHoursMs) {
                        additionalHours = 0.25;
                    }
                }
                const newHoursSpent = (existing.hoursSpent || 0.0) + additionalHours;

                db.saveGalleryEntry({
                    id: existing.id,
                    fileHash: fileHash,
                    status: "local_only",
                    hoursSpent: Math.max(0, parseFloat(newHoursSpent.toFixed(2))),
                    updatedAt: stats.mtime.toISOString(),
                    thumbnailPath: thumbnailPath,
                    metadata: {
                        ...existing.metadata,
                        sizeBytes: stats.size
                    },
                    needsCritique: true
                });
            }
        }

        // Also clean up any database entries that don't exist physically anymore
        const dbEntries = db.getGallery();
        for (const entry of dbEntries) {
            const entryPath = path.join(watchPath, entry.fileName);
            if (!fs.existsSync(entryPath)) {
                if (entry.status === 'synced') {
                    console.log(`[SCAN] Preserving synced database entry for missing file: ${entry.fileName}`);
                } else {
                    db.deleteGalleryEntry(entry.id);
                    const thumbPath = path.join(THUMB_DIR, `thumb_${entry.fileName}`);
                    if (fs.existsSync(thumbPath)) {
                        fs.unlinkSync(thumbPath);
                    }
                }
            }
        }

        res.json({ success: true, message: "Folder scanned successfully" });
    } catch (e) {
        console.error("[SCAN] Error scanning folder:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Shutdown helper endpoint for clean Electron exits
app.post('/api/shutdown', (req, res) => {
    if (process.env.ELECTRON_SPAWNED !== 'true') {
        console.log('[SHUTDOWN] Ignored shutdown request because server was not spawned by Electron.');
        return res.json({ success: false, message: "Ignored shutdown request (not spawned by Electron)" });
    }
    console.log('[SHUTDOWN] Shutdown request received from Electron app. Stopping watcher and exiting...');
    if (activeWatcher) {
        activeWatcher.close();
    }
    res.json({ success: true, message: "Shutting down" });
    setTimeout(() => {
        process.exit(0);
    }, 200);
});

// Start Express Server
const server = app.listen(PORT, () => {
    console.log(`\n=============================================================`);
    console.log(`  Creative Anchor Local Sync Backend running on http://localhost:${PORT}`);
    console.log(`  Sync directory watched: ${currentSyncDir}`);
    console.log(`  Thumbnails served: ${THUMB_DIR}`);
    console.log(`=============================================================\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.log(`[SERVER] Port ${PORT} is already in use. Assuming another instance is running.`);
        process.exit(0);
    } else {
        console.error('[SERVER] Server error:', err);
        process.exit(1);
    }
});
