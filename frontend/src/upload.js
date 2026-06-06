// src/upload.js - Main Dashboard Workspace Controller
const API_URL = window.electronAPI?.env?.LOCAL_BACKEND_URL || 'http://localhost:5002';

// Fix #2: Escape HTML special characters before injecting any server/user data
// into innerHTML to prevent XSS attacks.
function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str ?? '')));
    return div.innerHTML;
}

// Returns true if a JWT is expired or within 60 seconds of expiry.
function _isTokenExpired(token) {
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return !payload.exp || Math.floor(Date.now() / 1000) >= payload.exp - 60;
    } catch {
        return true;
    }
}

// Silently refreshes the access token using the stored refresh token.
// Returns the new access token string, or null if refresh fails.
async function _refreshAccessToken() {
    try {
        const refreshToken = await window.electronAPI.store.get('refresh_token');
        if (!refreshToken) return null;

        const pythonApiUrl = window.electronAPI?.env?.API_BASE_URL || 'http://localhost:5000';
        const res = await fetch(`${pythonApiUrl}/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) return null;

        const data = await res.json();
        if (!data.access_token) return null;

        await window.electronAPI.store.set('access_token', data.access_token);
        if (data.refresh_token) {
            await window.electronAPI.store.set('refresh_token', data.refresh_token);
        }
        return data.access_token;
    } catch {
        return null;
    }
}

// Auth helper — reads the stored token, silently refreshes it if expired or
// within 60 seconds of expiry, so Flask never sees a stale JWT.
async function getAuthHeader() {
    try {
        let token = await window.electronAPI.store.get('access_token');
        if (!token || _isTokenExpired(token)) {
            token = await _refreshAccessToken();
        }
        return token ? `Bearer ${token}` : null;
    } catch {
        return null;
    }
}

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
        // Force synchronous folder scan on startup/settings load to align with filesystem
        try {
            await fetch(`${API_URL}/api/gallery/scan`, { method: 'POST' });
        } catch (scanErr) {
            console.warn("Failed to trigger startup folder scan:", scanErr);
        }

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
        const authHeader = await getAuthHeader();
        const headers = {};
        if (authHeader) headers['Authorization'] = authHeader;

        const res = await fetch(`${API_URL}/api/gallery`, { headers });
        drawings = await res.json();
        renderGalleryGrid();
    } catch (e) {
        console.error("Failed to fetch gallery entries:", e);
    }
}

// 4b. Show native desktop notification if any drawings are stagnant for 5+ days
function checkStagnantNotifications() {
    if (!drawings || drawings.length === 0) return;

    if (typeof Notification !== 'undefined' && Notification.permission !== "granted") {
        Notification.requestPermission();
    }

    let hasStagnantFile = false;
    drawings.forEach(file => {
        const lastSaveDate = new Date(file.updatedAt);
        const timeSinceLastSave = Date.now() - lastSaveDate.getTime();
        const daysSinceLastSave = Math.floor(timeSinceLastSave / (1000 * 60 * 60 * 24));
        if (daysSinceLastSave >= 5) {
            hasStagnantFile = true;
        }
    });

    if (hasStagnantFile) {
        const sessionKey = 'notified_burnout_stagnant';
        if (!sessionStorage.getItem(sessionKey)) {
            if (typeof Notification !== 'undefined' && Notification.permission === "granted") {
                new Notification("Creative Anchor", {
                    body: "Feeling burned out?",
                });
                sessionStorage.setItem(sessionKey, 'true');
            }
        }
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

        // Check if this file origin matches current device or backend-computed isMasterCopy
        const isMasterCopy = file.localFileExists === true && (file.isMasterCopy || ((file.status === 'SYNCED' || file.status === 'synced') && file.deviceOrigin === currentDeviceId));

        // Dynamic Badge display (No Emojis!)
        let badgeHtml = '';
        if (isMasterCopy) {
            badgeHtml += `<span class="master-badge">Master</span>`;
        }
        if (file.localFileExists === false) {
            badgeHtml += `<span class="sync-badge cloud">Cloud Only</span>`;
        } else if (file.status === 'SYNCED' || file.status === 'synced') {
            badgeHtml += `<span class="sync-badge synced">Synced</span>`;
        } else {
            badgeHtml += `<span class="sync-badge">Local Only</span>`;
        }

        // Preview Render: Check if thumbnail exists, else render robust blocky file-type fallbacks (No Emojis!)
        let previewHtml = '';
        if (file.thumbnailPath) {
            // Fix #2: Escape the path and filename used in src/alt attributes.
            previewHtml = `<img class="art-card-img" src="${escapeHtml(API_URL)}/${escapeHtml(file.thumbnailPath)}" alt="${escapeHtml(file.fileName)}">`;
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
            <h4 class="art-card-title">${escapeHtml(file.fileName)}</h4>
            <div class="art-card-meta-grid">
                <div class="art-card-meta-item">
                    <span class="art-card-meta-label">INVESTED TIME</span>
                    <span class="art-card-meta-val">${escapeHtml(hours)} hours</span>
                </div>
                <div class="art-card-meta-item">
                    <span class="art-card-meta-label">CREATED</span>
                    <span class="art-card-meta-val">${escapeHtml(createdDate)}</span>
                </div>
                <!-- REAL LAST SAVE (LAST WORKED ON) DATE -->
                <div class="art-card-meta-item">
                    <span class="art-card-meta-label">LAST SAVE (WORKED ON)</span>
                    <span class="art-card-meta-val">${escapeHtml(lastWorkedOnText)}</span>
                </div>
                <!-- LAST TIME VIEWED INSIDE ANCHOR VISUALIZER -->
                <div class="art-card-meta-item" style="grid-column: 1 / -1; margin-top: 4px; border-top: 1px dashed #3A3530; padding-top: 4px;">
                    <span class="art-card-meta-label">LAST APP OPENED</span>
                    <span class="art-card-meta-val" style="color: #A59E92;">${escapeHtml(lastOpenedText)}</span>
                </div>
            </div>
        </div>
    `;
        grid.appendChild(card);
    });
}

// 5. Click a drawing card — update access timestamp, then show Fight Burnout or chat
async function selectDrawingCard(id) {
    activeDrawingId = id;
    renderGalleryGrid(); // redraw selected border

    // Ensure right chat panel is revealed from its startup hidden state
    const chatPanel = document.getElementById('chatPanel');
    if (chatPanel) {
        chatPanel.classList.remove('completely-hidden');
    }

    try {
        // Forward the auth token so the local backend can pass it to Flask
        const authHeader = await getAuthHeader();
        const accessHeaders = {};
        if (authHeader) accessHeaders['Authorization'] = authHeader;

        // Trigger access update on backend (may fire async critique if file changed)
        const accessRes = await fetch(`${API_URL}/api/gallery/${id}/access`, {
            method: 'POST',
            headers: accessHeaders,
        });
        const accessData = await accessRes.json();

        // Refresh local array and grid with new last-opened date
        const idx = drawings.findIndex(d => d.id === id);
        if (idx !== -1) {
            drawings[idx] = {
                ...drawings[idx],
                ...accessData.file
            };
            renderGalleryGrid();
        }

        const file = drawings.find(d => d.id === id);

        // Load Chat logs for this drawing file
        const headers = {};
        if (authHeader) headers['Authorization'] = authHeader;
        const chatRes = await fetch(`${API_URL}/api/gallery/${id}/chat`, { headers });
        const chatData = await chatRes.json();

        // Update chat panel header
        document.getElementById('chatHeaderTitle').innerText = file.fileName;
        document.getElementById('chatHeaderSub').innerText = `Invested effort: ${file.hoursSpent.toFixed(1)} hours | Status: ${file.status}`;
        
        const syncBtn = document.getElementById('cloudSyncBtn');
        if (syncBtn) {
            syncBtn.style.display = 'block';
            if (file.status === 'synced' || file.status === 'SYNCED') {
                syncBtn.disabled = true;
                syncBtn.innerText = 'Cloud Synced';
                syncBtn.style.opacity = '0.5';
                syncBtn.style.cursor = 'not-allowed';
                syncBtn.style.backgroundColor = 'transparent';
                syncBtn.style.border = '2px solid #8C877E';
                syncBtn.style.color = '#8C877E';
                syncBtn.style.boxShadow = 'none';
            } else {
                syncBtn.disabled = false;
                syncBtn.innerText = 'Cloud Sync';
                syncBtn.style.opacity = '1';
                syncBtn.style.cursor = 'pointer';
                syncBtn.style.backgroundColor = '';
                syncBtn.style.border = '';
                syncBtn.style.color = '';
                syncBtn.style.boxShadow = '';
            }
        }
        const hasChatHistory = chatData.history && chatData.history.length > 0;
        const fightSection = document.getElementById('fightBurnoutSection');
        const composer = document.getElementById('chatComposer');

        // Always enable the composer input and submit button whenever a drawing is selected
        const chatInput = document.getElementById('chatInput');
        const chatSubmitBtn = document.getElementById('chatSubmitBtn');
        if (chatInput && chatSubmitBtn) {
            chatInput.disabled = false;
            chatInput.placeholder = "Ask Anchor about your lighting, anatomy or composition...";
            chatInput.style.backgroundColor = '';
            chatInput.style.borderColor = '';
            chatInput.style.color = '';
            chatInput.style.opacity = '';
            chatInput.style.cursor = '';
            
            chatSubmitBtn.disabled = false;
            chatSubmitBtn.style.backgroundColor = '';
            chatSubmitBtn.style.border = '';
            chatSubmitBtn.style.color = '';
            chatSubmitBtn.style.opacity = '';
            chatSubmitBtn.style.cursor = '';
            chatSubmitBtn.style.boxShadow = '';
        }

        if (hasChatHistory) {
            // Already has AI messages — show them and the composer directly
            fightSection.style.display = 'none';
            document.getElementById('chatHistory').style.display = 'flex';
            renderChatHistory(chatData.history);
        } else {
            // No history yet — show the Fight Burnout CTA but keep composer active
            fightSection.style.display = 'flex';
            document.getElementById('chatHistory').style.display = 'none';
            const btn = document.getElementById('fightBurnoutBtn');
            btn.disabled = false;
            btn.innerHTML = 'Fight Burnout';
            
            // Clear any leftover messages from a previous selection
            document.getElementById('chatHistory').innerHTML = '';
        }
        composer.style.display = 'flex';

        // Force the right chat panel to expand (remove collapsed state)
        chatCollapsed = false;
        const chatPanelEl = document.getElementById('chatPanel');
        if (chatPanelEl) {
            chatPanelEl.classList.remove('collapsed');
            chatPanelEl.classList.remove('completely-hidden');
        }
    } catch (e) {
        console.error("Failed to select drawing:", e);
    }
}

// 5a. Fight Burnout — silently triggers the first AI critique.
//     No user message is shown; the chat opens with only the AI's response.
async function triggerFightBurnout() {
    if (!activeDrawingId) return;

    const btn = document.getElementById('fightBurnoutBtn');
    btn.disabled = true;
    btn.innerHTML = 'Analyzing <span class="dots-loader"><span></span><span></span><span></span></span>';

    try {
        // Check if the async critique from /access already finished while the user was reading
        const chatCheck = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/chat`);
        const chatCheckData = await chatCheck.json();

        if (chatCheckData.history && chatCheckData.history.length > 0) {
            // Async critique already landed — just display it
            renderChatHistory(chatCheckData.history);
        } else {
            // Trigger a synchronous review with no visible user message
            const authHeader = await getAuthHeader();
            const headers = { 'Content-Type': 'application/json' };
            if (authHeader) headers['Authorization'] = authHeader;

            const res = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/review`, {
                method: 'POST',
                headers,
                // No customPrompt: server uses initial_prompt.txt
                // skipUserMessage: AI response only — no user bubble in chat
                body: JSON.stringify({ skipUserMessage: true }),
            });

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.error || `HTTP ${res.status}`);
            }

            // Reload chat to render the AI's opening message
            const chatRes = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/chat`);
            const chatData = await chatRes.json();
            renderChatHistory(chatData.history);
        }

        // Transition: hide Fight Burnout, reveal composer and history
        document.getElementById('fightBurnoutSection').style.display = 'none';
        document.getElementById('chatHistory').style.display = 'flex';
        document.getElementById('chatComposer').style.display = 'flex';
        
        const chatInput = document.getElementById('chatInput');
        const chatSubmitBtn = document.getElementById('chatSubmitBtn');
        if (chatInput && chatSubmitBtn) {
            chatInput.disabled = false;
            chatInput.placeholder = "Ask Anchor about your lighting, anatomy or composition...";
            chatInput.style.backgroundColor = '';
            chatInput.style.borderColor = '';
            chatInput.style.color = '';
            chatInput.style.opacity = '';
            chatInput.style.cursor = '';
            
            chatSubmitBtn.disabled = false;
            chatSubmitBtn.style.backgroundColor = '';
            chatSubmitBtn.style.border = '';
            chatSubmitBtn.style.color = '';
            chatSubmitBtn.style.opacity = '';
            chatSubmitBtn.style.cursor = '';
            chatSubmitBtn.style.boxShadow = '';
        }
        document.getElementById('chatInput').focus();

    } catch (e) {
        console.error('Fight Burnout error:', e);
        btn.disabled = false;
        btn.innerHTML = 'Fight Burnout';
        
        let friendlyMsg = 'An unexpected error occurred while processing the request.';
        const errText = e.message.toLowerCase();
        if (errText.includes('quota') || errText.includes('rate limit') || errText.includes('429') || errText.includes('423') || errText.includes('limit exceeded')) {
            friendlyMsg = 'Exceeded API quota. Please try again in a few moments.';
        } else if (errText.includes('image') || errText.includes('file') || errText.includes('thumbnail') || errText.includes('size') || errText.includes('format')) {
            friendlyMsg = 'Error processing image file format.';
        } else if (errText.includes('network') || errText.includes('fetch') || errText.includes('connect')) {
            friendlyMsg = 'Failed to connect to the AI model server.';
        }
        
        alert(`AI Error: ${friendlyMsg}\n\nFull details saved in local-backend/ai_debug.log`);
    }
}

// Helper to format JSON critiques nicely in the UI
function formatCritiqueJson(data) {
    const container = document.createElement('div');
    container.className = 'critique-card';

    // Format 1: Initial critique
    // 1. Metadata
    if (data.analysis_metadata) {
        const meta = data.analysis_metadata;
        const metaSec = document.createElement('div');
        metaSec.className = 'critique-meta-section';
        metaSec.innerHTML = `
            <div class="critique-meta-item">
                <span class="critique-meta-label">Medium</span>
                <span class="critique-meta-val">${escapeHtml(meta.detected_medium)}</span>
            </div>
            <div class="critique-meta-item">
                <span class="critique-meta-label">Primary Mood</span>
                <span class="critique-meta-val">${escapeHtml(meta.primary_mood)}</span>
            </div>
            <div class="critique-trigger-box">
                <strong>Burnout Trigger Summary</strong>
                <p>${escapeHtml(meta.burnout_trigger_summary)}</p>
            </div>
        `;
        container.appendChild(metaSec);
    }

    // 2. Technical Audit
    if (data.technical_audit && data.technical_audit.length > 0) {
        const auditHeader = document.createElement('h4');
        auditHeader.className = 'critique-section-title';
        auditHeader.textContent = 'Technical Audit';
        container.appendChild(auditHeader);

        data.technical_audit.forEach(item => {
            const itemEl = document.createElement('div');
            itemEl.className = 'critique-audit-item';
            itemEl.innerHTML = `
                <div class="critique-audit-header">
                    <span class="critique-audit-category">${escapeHtml(item.category)}</span>
                    <span class="critique-audit-issue">${escapeHtml(item.issue)}</span>
                </div>
                <div class="critique-audit-context">Context: ${escapeHtml(item.location_context)}</div>
                <p class="critique-audit-desc">${escapeHtml(item.description)}</p>
                <div class="critique-burnout-connection">
                    <strong>Burnout Connection:</strong> ${escapeHtml(item.burnout_connection)}
                </div>
            `;
            container.appendChild(itemEl);
        });
    }

    // 3. Psychological Insight
    if (data.psychological_insight) {
        const insightSec = document.createElement('div');
        insightSec.className = 'critique-insight-box';
        insightSec.innerHTML = `
            <h4>Psychological Insight</h4>
            <p>${escapeHtml(data.psychological_insight)}</p>
        `;
        container.appendChild(insightSec);
    }

    // 4. Action Plan
    if (data.action_plan && data.action_plan.length > 0) {
        const planHeader = document.createElement('h4');
        planHeader.className = 'critique-section-title';
        planHeader.textContent = 'Action Plan';
        container.appendChild(planHeader);

        const planList = document.createElement('div');
        planList.className = 'critique-action-list';
        data.action_plan.forEach(step => {
            const stepEl = document.createElement('div');
            stepEl.className = 'critique-action-step';
            stepEl.innerHTML = `
                <div class="critique-step-num">${escapeHtml(step.step_number)}</div>
                <div class="critique-step-content">
                    <p class="critique-step-text">${escapeHtml(step.step)}</p>
                    <p class="critique-step-benefit"><strong>Benefit:</strong> ${escapeHtml(step.benefit)}</p>
                </div>
            `;
            planList.appendChild(stepEl);
        });
        container.appendChild(planList);
    }

    // Format 2: Follow-up response
    if (data.critic_response) {
        const cr = data.critic_response;
        const metaSec = document.createElement('div');
        metaSec.className = 'critique-meta-section';
        
        let content = '';
        if (cr.vibe_impact_analysis) {
            content += `
                <div class="critique-meta-item">
                    <span class="critique-meta-label">Vibe Impact Analysis</span>
                    <span class="critique-meta-val">${escapeHtml(cr.vibe_impact_analysis)}</span>
                </div>
            `;
        }
        if (cr.technical_alternative) {
            content += `
                <div class="critique-meta-item" style="margin-top: 10px;">
                    <span class="critique-meta-label">Technical Alternative</span>
                    <span class="critique-meta-val">${escapeHtml(cr.technical_alternative)}</span>
                </div>
            `;
        }
        if (cr.psychological_mentorship) {
            content += `
                <div class="critique-trigger-box" style="margin-top: 12px; background: rgba(165, 158, 146, 0.05); border-left: 3px solid #A59E92;">
                    <strong>Psychological Mentorship</strong>
                    <p style="color: #A59E92;">${escapeHtml(cr.psychological_mentorship)}</p>
                </div>
            `;
        }
        metaSec.innerHTML = content;
        container.appendChild(metaSec);
    }

    if (data.actionable_experiment) {
        const ae = data.actionable_experiment;
        const planHeader = document.createElement('h4');
        planHeader.className = 'critique-section-title';
        planHeader.textContent = 'Actionable Experiment';
        container.appendChild(planHeader);

        const planList = document.createElement('div');
        planList.className = 'critique-action-list';
        const stepEl = document.createElement('div');
        stepEl.className = 'critique-action-step';
        stepEl.innerHTML = `
            <div class="critique-step-num">!</div>
            <div class="critique-step-content">
                <p class="critique-step-text">${escapeHtml(ae.step)}</p>
                <p class="critique-step-benefit"><strong>Benefit:</strong> ${escapeHtml(ae.benefit)}</p>
            </div>
        `;
        planList.appendChild(stepEl);
        container.appendChild(planList);
    }

    return container;
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
        // Fix #2: Build the bubble with DOM APIs so no user/server content ever
        // touches innerHTML.
        const bubble = document.createElement('div');
        // Whitelist the sender class to prevent class injection.
        const senderClass = msg.sender === 'gemini' ? 'gemini' : 'user';
        bubble.className = `message-bubble ${senderClass}`;

        const bodyEl = document.createElement('div');
        bodyEl.style.cssText = 'font-size: 15px; line-height: 1.5;';

        // Check if message is JSON format (structured critique)
        let cleanText = msg.message.trim();
        let isJson = false;

        // Strip Markdown block formatting
        if (cleanText.startsWith('```json')) {
            cleanText = cleanText.substring(7);
        } else if (cleanText.startsWith('```')) {
            cleanText = cleanText.substring(3);
        }
        if (cleanText.endsWith('```')) {
            cleanText = cleanText.substring(0, cleanText.length - 3);
        }
        cleanText = cleanText.trim();

        if (cleanText.startsWith('{') && cleanText.endsWith('}')) {
            try {
                const data = JSON.parse(cleanText);
                bodyEl.appendChild(formatCritiqueJson(data));
                isJson = true;
            } catch (err) {
                console.warn('Failed to parse critique JSON message, rendering raw text:', err);
            }
        }

        if (!isJson) {
            bodyEl.style.whiteSpace = 'pre-wrap';
            bodyEl.textContent = msg.message; // fallback to textContent
        }

        bubble.appendChild(bodyEl);
        thread.appendChild(bubble);
    });

    // Auto-scroll chat to bottom
    thread.scrollTop = thread.scrollHeight;
}

// 7. Handle sending a message — uses POST /chat which maintains history context
async function handleSendChatMessage(event) {
    event.preventDefault();
    if (!activeDrawingId) return;

    const input = document.getElementById('chatInput');
    const prompt = input.value.trim();
    if (!prompt) return;

    const submitBtn = event.target.querySelector('button[type="submit"]');
    input.value = '';
    if (submitBtn) { submitBtn.disabled = true; submitBtn.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span></span>'; }

    // Transition: hide Fight Burnout CTA and reveal history thread
    document.getElementById('fightBurnoutSection').style.display = 'none';
    document.getElementById('chatHistory').style.display = 'flex';

    // Optimistically render user message using DOM APIs (Fix #2 — no innerHTML)
    const thread = document.getElementById('chatHistory');
    const userBubble = document.createElement('div');
    userBubble.className = 'message-bubble user';

    const bodyEl = document.createElement('div');
    bodyEl.style.cssText = 'white-space: pre-wrap; font-size: 15px;';
    bodyEl.textContent = prompt;

    userBubble.appendChild(bodyEl);
    thread.appendChild(userBubble);

    // Append temporary loading bubble for Gemini
    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'message-bubble gemini temp-loading';
    const aiBodyEl = document.createElement('div');
    aiBodyEl.className = 'dots-loader-container';
    aiBodyEl.innerHTML = '<span class="dots-loader"><span></span><span></span><span></span></span>';
    loadingBubble.appendChild(aiBodyEl);
    thread.appendChild(loadingBubble);

    thread.scrollTop = thread.scrollHeight;

    try {
        // POST /chat — saves the user message, builds history, calls AI, saves AI response
        const authHeader = await getAuthHeader();
        const headers = { 'Content-Type': 'application/json' };
        if (authHeader) headers['Authorization'] = authHeader;

        const res = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ message: prompt, sender: 'user' }),
        });

        if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);

        // Reload full history so AI response renders correctly
        const chatRes = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/chat`);
        const chatData = await chatRes.json();
        renderChatHistory(chatData.history);

    } catch (e) {
        console.error('Chat send error:', e);
        
        // Clean up optimistic bubbles on failure
        if (userBubble) userBubble.remove();
        if (loadingBubble) loadingBubble.remove();
        // Restore user's draft in the input field so they don't lose it
        input.value = prompt;
        
        let friendlyMsg = 'Couldn\'t connect to the AI server or limit reached.';
        const errText = e.message.toLowerCase();
        if (errText.includes('quota') || errText.includes('rate limit') || errText.includes('429') || errText.includes('423') || errText.includes('limit exceeded')) {
            friendlyMsg = 'AI Error: Exceeded quota or rate limit. Please try again in a few moments.';
        } else if (errText.includes('injection') || errText.includes('focus on your artwork')) {
            friendlyMsg = 'Prompt rejected by safety guardrails. Let\'s keep the discussion focused on art and burnout.';
        }
        
        alert(friendlyMsg);
    } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.innerHTML = 'Anchor'; }
    }
}

// 8. Trigger Optional cloud sync
async function triggerOptionalCloudSync() {
    if (!activeDrawingId) return;

    try {
        const authHeader = await getAuthHeader();
        const headers = {};
        if (authHeader) headers['Authorization'] = authHeader;

        const res = await fetch(`${API_URL}/api/gallery/${activeDrawingId}/sync`, { 
            method: 'POST', 
            headers 
        });
        const data = await res.json();
        if (data.success && data.file && data.file.status === 'synced') {
            alert("Success: Drawing successfully backed up and synchronized to the cloud!");
            // Refresh database status in explorer
            await refreshGallery();
            // Re-select to update header subtext
            await selectDrawingCard(activeDrawingId);
        } else {
            alert(`Sync Failed: ${data.error || 'Server rejected synchronization request.'}`);
        }
    } catch (e) {
        console.error("Cloud sync trigger error:", e);
        alert("Failed to compile and send cloud synchronization payload. Please check your network connection or server status.");
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

async function triggerManualRefresh() {
    await loadSettings();
    alert("Workspace refreshed successfully.");
}

async function triggerClearLocalCache() {
    const confirmed = confirm("Are you sure you want to clear the local cache? This will reset all gallery hours, chat history, and delete generated thumbnails. This action cannot be undone.");
    if (!confirmed) return;

    try {
        const res = await fetch(`${API_URL}/api/settings/clear-cache`, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert("Local cache cleared successfully.");
            activeDrawingId = null;
            const chatPanel = document.getElementById('chatPanel');
            if (chatPanel) {
                chatPanel.classList.add('completely-hidden');
            }
            await loadSettings();
        } else {
            alert(`Error clearing cache: ${data.error}`);
        }
    } catch (e) {
        console.error(e);
        alert("Failed to clear local cache.");
    }
}

// Kickstart settings and file scan on DOM load
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    // Delay stagnant check notifications by 15 minutes upon startup
    setTimeout(() => {
        checkStagnantNotifications();
    }, 15 * 60 * 1000);
});
