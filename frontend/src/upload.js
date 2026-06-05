// src/upload.js - Main Dashboard Workspace Controller
const API_URL = 'http://localhost:5002';

let activeDrawingId = null;
let currentDeviceId = null;
let watchFolder = null;
let selectedFolderPath = null; // Temporary storage for selected folder during modal interaction
let drawings = [];

// Panel Toggle states
let sidebarCollapsed = true; // start collapsed as default
let chatCollapsed = true;    // start collapsed as default

// 1. Initial configuration load on startup
async function loadSettings() {
    try {
        const res = await fetch(`${API_URL}/api/settings`);
        const data = await res.json();

        watchFolder = data.watchFolder;
        currentDeviceId = data.currentDeviceId;

        document.getElementById('currentWatchFolderLabel').innerText = watchFolder;
        document.getElementById('deviceWidgetId').innerText = currentDeviceId;

        // Render user details based on Electron store
        const email = await window.electronAPI.store.get('userEmail') || '';
        const username = email ? email.split('@')[0] : 'Artist';
        const capitalizedUsername = username.charAt(0).toUpperCase() + username.slice(1);

        document.getElementById('userName').innerText = capitalizedUsername;
        document.getElementById('userAvatar').innerText = capitalizedUsername.charAt(0).toUpperCase();
        document.getElementById('dockAvatar').innerText = capitalizedUsername.charAt(0).toUpperCase();
        document.getElementById('userEmail').innerText = email;

        // Refresh database gallery grid
        await refreshGallery();
        // Check for stagnation warnings
        await checkBurnoutAlerts();
    } catch (e) {
        console.error("Failed to load initial settings:", e);
    }
}

// 2. Change workspace folder modal handlers
function openChangeFolderModal() {
    // Reset the selected folder display
    document.getElementById('selectedFolderText').innerText = watchFolder || 'No folder selected';
    document.getElementById('confirmScanBtn').disabled = !watchFolder;
    document.getElementById('changeFolderModal').style.display = 'flex';
}

function closeChangeFolderModal() {
    document.getElementById('changeFolderModal').style.display = 'none';
}

async function openFolderDialog() {
    try {
        const folderPath = await window.electronAPI.openFolderDialog();
        if (!folderPath) {
            // User cancelled the dialog or no path returned
            alert('No folder selected.');
            return;
        }
        // Update the displayed path and enable the confirm button
        document.getElementById('selectedFolderText').innerText = folderPath;
        document.getElementById('confirmScanBtn').disabled = false;
        // Store temporarily for saving
        selectedFolderPath = folderPath;
    } catch (error) {
        console.error('Error opening folder dialog:', error);
        alert('Failed to open folder dialog');
    }
}

async function saveModalWatchFolderSettings() {
    const pathValue = selectedFolderPath || watchFolder;
    if (!pathValue) {
        alert('Please select a valid folder before saving.');
        return;
    }
    try {
        const res = await fetch(`${API_URL}/api/settings/watch-folder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watchFolder: pathValue })
        });
        if (!res.ok) {
            const errText = await res.text();
            alert(`Failed to update folder (status ${res.status}): ${errText}`);
            return;
        }
        const data = await res.json();
        if (!data || typeof data.success === 'undefined') {
            alert('Unexpected response from server when updating folder.');
            console.error('Response data:', data);
            return;
        }
        if (data.success) {
            watchFolder = data.settings.watchFolder;
            selectedFolderPath = null; // Reset temporary selection
            document.getElementById('currentWatchFolderLabel').innerText = watchFolder;
            closeChangeFolderModal();

            // Refresh database gallery grid
            await refreshGallery();
            await checkBurnoutAlerts();

            alert('Success: Directory changed, scanning folder contents now');
        } else {
            alert(`Error: ${data.error}`);
        }
    } catch (e) {
        console.error(e);
        alert('Failed to update folder. Make sure the local server is running.');
    }
}

// 3. Dynamic Side Panel toggling (NotebookLM Style)
function toggleLeftSidebar() {
    const sidebar = document.getElementById('sidebarPanel');
    sidebarCollapsed = !sidebarCollapsed;

    if (sidebarCollapsed) {
        sidebar.classList.add('collapsed');
    } else {
        sidebar.classList.remove('collapsed');
    }
}

function toggleRightChat() {
    const chat = document.getElementById('chatPanel');
    chatCollapsed = !chatCollapsed;

    if (chatCollapsed) {
        chat.classList.add('collapsed');
    } else {
        chat.classList.remove('collapsed');
    }
}

// 4. Render files list dynamically in a grid of Neo-Brutalist cards
async function refreshGallery() {
    try {
        const res = await fetch(`${API_URL}/api/gallery`);
        drawings = await res.json();
        renderGalleryGrid();
    } catch (e) {
        console.error("Failed to fetch gallery entries:", e);
    }
}

function renderGalleryGrid() {
    const grid = document.getElementById('galleryGrid');
    grid.innerHTML = '';

    if (drawings.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 40px; text-align: center; color: #8C877E;">
                <p style="font-size: 16px; font-weight: 600;">No drawings detected yet.</p>
                <p style="font-size: 13.5px; margin-top: 8px;">Drag and drop drawing files into your directory or click 'Change Workspace'.</p>
            </div>
        `;
        return;
    }

    drawings.forEach(file => {
        const ext = file.fileName.split('.').pop().toLowerCase();

        // Check if this file origin matches current device to evaluate "Master" status
        const isMasterCopy = file.status === 'SYNCED' && file.deviceOrigin === currentDeviceId;

        // 1. Format CREATED date
        const createdDate = new Date(file.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: '2-digit'
        });

        // 2. Format & Calculate REAL "LAST SAVE (LAST WORKED ON)" (from file.updatedAt)
        const lastSaveDate = new Date(file.updatedAt);
        const timeSinceLastSave = Date.now() - lastSaveDate.getTime();
        const daysSinceLastSave = Math.floor(timeSinceLastSave / (1000 * 60 * 60 * 24));

        let lastWorkedOnText = '';
        if (daysSinceLastSave === 0) {
            lastWorkedOnText = "Today";
        } else if (daysSinceLastSave === 1) {
            lastWorkedOnText = "Yesterday";
        } else {
            lastWorkedOnText = `${daysSinceLastSave} days ago`;
        }

        // 3. Format "LAST APP OPENED" (from file.accessedAt)
        let lastOpenedText = "Never";
        if (file.accessedAt) {
            const lastOpenedDate = new Date(file.accessedAt);
            lastOpenedText = lastOpenedDate.toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        const hours = file.hoursSpent !== undefined ? file.hoursSpent.toFixed(1) : '0.0';

        // Dynamic Badge display (No Emojis!)
        let badgeHtml = '';
        if (isMasterCopy) {
            badgeHtml += `<span class="master-badge">Master</span>`;
        }
        if (file.status === 'SYNCED') {
            badgeHtml += `<span class="sync-badge synced">Synced</span>`;
        } else {
            badgeHtml += `<span class="sync-badge">Local Only</span>`;
        }

        // Preview Render: Check if thumbnail exists, else render robust blocky file-type fallbacks (No Emojis!)
        let previewHtml = '';
        if (file.thumbnailPath) {
            previewHtml = `<img class="art-card-img" src="${API_URL}/${file.thumbnailPath}" alt="${file.fileName}">`;
        } else {
            let fallbackClass = 'ext-other';
            let iconText = ext.toUpperCase();

            if (ext === 'clip') { fallbackClass = 'ext-clip'; }
            else if (ext === 'psd') { fallbackClass = 'ext-psd'; }
            else if (ext === 'kra') { fallbackClass = 'ext-kra'; }
            else if (ext === 'sai') { fallbackClass = 'ext-sai'; }
            else if (ext === 'procreate') { fallbackClass = 'ext-procreate'; }

            previewHtml = `
                <div class="art-card-fallback ${fallbackClass}">
                    ${iconText}
                    <span class="fallback-icon">project</span>
                </div>
            `;
        }

        const card = document.createElement('article');
        card.className = 'art-card';
        if (activeDrawingId === file.id) {
            card.style.borderColor = '#FF5A00';
            card.style.boxShadow = '6px 6px 0px #131211';
        }
        card.setAttribute('onclick', `selectDrawingCard('${file.id}')`);

        card.innerHTML = `
        <div class="art-card-preview">
            <div class="card-badges">
                ${badgeHtml}
            </div>
            ${previewHtml}
        </div>
        <div class="art-card-body">
            <h4 class="art-card-title">${file.fileName}</h4>
            <div class="art-card-meta-grid">
                <div class="art-card-meta-item">
                    <span class="art-card-meta-label">INVESTED TIME</span>
                    <span class="art-card-meta-val">${hours} hours</span>
                </div>
                <div class="art-card-meta-item">
                    <span class="art-card-meta-label">CREATED</span>
                    <span class="art-card-meta-val">${createdDate}</span>
                </div>
                <!-- REAL LAST SAVE (LAST WORKED ON) DATE -->
                <div class="art-card-meta-item">
                    <span class="art-card-meta-label">LAST SAVE (WORKED ON)</span>
                    <span class="art-card-meta-val">${lastWorkedOnText}</span>
                </div>
                <!-- LAST TIME VIEWED INSIDE ANCHOR VISUALIZER -->
                <div class="art-card-meta-item" style="grid-column: 1 / -1; margin-top: 4px; border-top: 1px dashed #3A3530; padding-top: 4px;">
                    <span class="art-card-meta-label">LAST APP OPENED</span>
                    <span class="art-card-meta-val" style="color: #A59E92;">${lastOpenedText}</span>
                </div>
            </div>
        </div>
    `;
        grid.appendChild(card);
    });
}

// 5. Click a drawing card to inspect details, update access timestamp, and load chat logs
async function selectDrawingCard(id) {
    activeDrawingId = id;
    renderGalleryGrid(); // redraw selected border

    // Ensure right chat panel is revealed from its startup hidden state
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) {
        chatPanel.classList.remove('completely-hidden');
    }

    try {
        // Trigger access update on backend
        const accessRes = await fetch(`${API_URL}/api/gallery/${id}/access`, { method: 'POST' });
        const accessData = await accessRes.json();

        // Refresh local array and grid with new last-opened date
        const idx = drawings.findIndex(d => d.id === id);
        if (idx !== -1) {
            drawings[idx] = accessData.file;
            renderGalleryGrid();
        }

        const file = drawings.find(d => d.id === id);

        // Load Chat logs for this drawing file
        const chatRes = await fetch(`${API_URL}/api/gallery/${id}/chat`);
        const chatData = await chatRes.json();

        // Update headers (No Emojis!)
        document.getElementById('chatHeaderTitle').innerText = file.fileName;
        document.getElementById('chatHeaderSub').innerText = `Invested effort: ${file.hoursSpent.toFixed(1)} hours | Status: ${file.status}`;

        // Show controls
        document.getElementById('cloudSyncBtn').style.display = 'block';
        document.getElementById('chatComposer').style.display = 'flex';

        // Render chat history
        renderChatHistory(chatData.history);

        // If chat panel was collapsed, automatically expand it to show the history! Excellent UX!
        if (chatCollapsed) {
            toggleRightChat();
        }
    } catch (e) {
        console.error("Failed to select drawing:", e);
    }
}

// 6. Render local chat cache (No Emojis!)
function renderChatHistory(messages) {
    const thread = document.getElementById('chatHistory');
    thread.innerHTML = '';

    if (!messages || messages.length === 0) {
        thread.innerHTML = `
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; color: #8C877E; padding: 20px;">
                <h4 style="font-weight: 700; margin-bottom: 4px;">Local Chat Cache is Empty</h4>
                <p style="font-size: 12.5px; line-height: 1.4; max-width: 250px;">Ask Gemini to review your composition or anatomy structured details.</p>
            </div>
        `;
        return;
    }

    messages.forEach(msg => {
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${msg.sender}`;

        const authorName = msg.sender === 'gemini' ? 'Gemini Critique' : 'Me';
        bubble.innerHTML = `
            <div class="message-author ${msg.sender}">${authorName}</div>
            <div style="white-space: pre-wrap; font-size: 13px; line-height: 1.5;">${msg.message}</div>
        `;
        thread.appendChild(bubble);
    });

    // Auto-scroll chat to bottom
    thread.scrollTop = thread.scrollHeight;
}

// 7. Handle sending message and receiving mock Gemini artist critique
async function handleSendChatMessage(event) {
    event.preventDefault();
    if (!activeDrawingId) return;

    const input = document.getElementById('chatInput');
    const prompt = input.value.trim();
    if (!prompt) return;

    input.value = '';

    try {
        // Optimistically render user message
        const thread = document.getElementById('chatHistory');
        const userBubble = document.createElement('div');
        userBubble.className = 'message-bubble user';
        userBubble.innerHTML = `
            <div class="message-author user">Me</div>
            <div style="white-space: pre-wrap; font-size: 13px;">${prompt}</div>
        `;
        thread.appendChild(userBubble);
        thread.scrollTop = thread.scrollHeight;

        // Call mock Gemini analysis endpoint
        const res = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/review`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customPrompt: prompt })
        });
        const data = await res.json();

        if (data.success) {
            // Load fresh chat history
            const chatRes = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/chat`);
            const chatData = await chatRes.json();
            renderChatHistory(chatData.history);
        }
    } catch (e) {
        console.error("Failed to get review from mock Gemini:", e);
        alert("Critique connection error. Make sure your local server is running!");
    }
}

// 8. Trigger Optional cloud sync
async function triggerOptionalCloudSync() {
    if (!activeDrawingId) return;

    try {
        const res = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/sync`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert(`Simulation Success: ${data.message}`);
            // Refresh database status in explorer
            await refreshGallery();
            // Re-select to update header subtext
            await selectDrawingCard(activeDrawingId);
        }
    } catch (e) {
        console.error(e);
        alert("Failed to compile cloud synchronization payload.");
    }
}

// 9. Stagnant art reminder diagnostics (Anti-burnout alert check)
async function checkBurnoutAlerts() {
    try {
        const res = await fetch(`${API_URL}/api/gallery/burnout-check?testIntervalMs=10000`);
        const data = await res.json();

        const banner = document.getElementById('burnoutAlertBanner');
        const text = document.getElementById('burnoutAlertMessage');

        if (data.burnoutRiskCount > 0) {
            text.innerText = data.warnings[0].reminderText;
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    } catch (e) {
        console.error(e);
    }
}

async function triggerManualBurnoutCheck() {
    await refreshGallery();
    await checkBurnoutAlerts();
    alert("Stagnation check completed successfully.");
}

// Kickstart settings and file scan on DOM load
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
});