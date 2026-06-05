// src/app.js

import { API, clearTokens, getAccessToken } from './api.js';

// Minimal store reference for non-token UI data (userId, userEmail)
const store = {
    set: (key, value) => window.electronAPI.store.set(key, value),
    delete: (key) => window.electronAPI.store.delete(key),
};

// Navigation helper
function navigateTo(page) {
    window.electronAPI.navigate(page);
}

// Fix #3: Expose safe IPC-based navigation globally so HTML onclick attributes
// (and auth-page links) never need bare <a href> tags that bypass the guard.
window.goToPage = (page) => navigateTo(page);

// Window controls global integration
window.minimizeWindow = () => {
    if (window.electronAPI && window.electronAPI.minimize) {
        window.electronAPI.minimize();
    }
};

window.maximizeWindow = () => {
    if (window.electronAPI && window.electronAPI.maximize) {
        window.electronAPI.maximize();
    }
};

window.closeWindow = () => {
    if (window.electronAPI && window.electronAPI.close) {
        window.electronAPI.close();
    }
};

// Monitor maximized state to adjust style
if (window.electronAPI && window.electronAPI.onMaximizedState) {
    window.electronAPI.onMaximizedState((isMaximized) => {
        if (isMaximized) {
            document.body.classList.add('window-maximized');
        } else {
            document.body.classList.remove('window-maximized');
        }
    });
}

// Fix #1: Parse the JWT payload in the renderer so we can check expiry locally.
// The real enforcement is in main.js (IPC handler); this is a defence-in-depth check.
function parseJwtPayload(token) {
    try {
        const base64Payload = token.split('.')[1];
        if (!base64Payload) return null;
        // atob is available in Electron's renderer / Chromium context.
        const decoded = atob(base64Payload.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}

function isTokenExpiredOrInvalid(token) {
    if (!token || typeof token !== 'string') return true;
    const payload = parseJwtPayload(token);
    if (!payload) return true;
    if (!payload.exp) return true;
    return Math.floor(Date.now() / 1000) >= payload.exp;
}

// Input validation
function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Login
async function handleLogin(event) {
    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const loginBtn = document.getElementById('loginBtn');
    const errorDiv = document.getElementById('loginError');

    errorDiv.style.display = 'none';

    if (!isValidEmail(email)) {
        errorDiv.textContent = 'Please enter a valid email address.';
        errorDiv.style.display = 'block';
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Logging in…';

    try {
        const response = await API.login({ email, password });
        let data;

        try {
            data = await response.json();
        } catch {
            errorDiv.textContent = 'Something went wrong. Please try again.';
            errorDiv.style.display = 'block';
            return;
        }

        if (response.ok && data.access_token) {
            await store.set('userId', data.user_id || data.user?.id || '');
            await store.set('userEmail', email);
            navigateTo('dashboard.html');
        } else {
            errorDiv.textContent = 'Invalid email or password.';
            errorDiv.style.display = 'block';
        }
    } catch {
        errorDiv.textContent = 'Something went wrong. Please try again.';
        errorDiv.style.display = 'block';
    } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Login';
    }
}

// Register
async function handleRegister(event) {
    event.preventDefault();

    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const registerBtn = document.getElementById('registerBtn');
    const errorDiv = document.getElementById('registerError');

    errorDiv.style.display = 'none';

    if (!isValidEmail(email)) {
        errorDiv.textContent = 'Please enter a valid email address.';
        errorDiv.style.display = 'block';
        return;
    }
    if (password !== confirmPassword) {
        errorDiv.textContent = 'Passwords do not match.';
        errorDiv.style.display = 'block';
        return;
    }

    // Fix #7: Enforce a meaningful password policy.
    if (password.length < 8) {
        errorDiv.textContent = 'Password must be at least 8 characters long.';
        errorDiv.style.display = 'block';
        return;
    }
    if (!/[A-Z]/.test(password)) {
        errorDiv.textContent = 'Password must contain at least one uppercase letter.';
        errorDiv.style.display = 'block';
        return;
    }
    if (!/[0-9]/.test(password)) {
        errorDiv.textContent = 'Password must contain at least one number.';
        errorDiv.style.display = 'block';
        return;
    }
    if (!/[^A-Za-z0-9]/.test(password)) {
        errorDiv.textContent = 'Password must contain at least one special character.';
        errorDiv.style.display = 'block';
        return;
    }

    registerBtn.disabled = true;
    registerBtn.textContent = 'Registering…';

    try {
        const response = await API.register({ email, password });
        let data;

        try {
            data = await response.json();
        } catch {
            errorDiv.textContent = 'Something went wrong. Please try again.';
            errorDiv.style.display = 'block';
            return;
        }

        if (response.ok) {
            document.getElementById('registerForm').reset();
            navigateTo('login.html');
        } else {
            errorDiv.textContent = 'Registration failed. Please try again.';
            errorDiv.style.display = 'block';
        }
    } catch {
        errorDiv.textContent = 'Something went wrong. Please try again.';
        errorDiv.style.display = 'block';
    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = 'Register';
    }
}

// Logout
async function handleLogout() {
    try {
        await clearTokens();
        navigateTo('login.html');
    } catch (error) {
        console.error('Logout error:', error);
        alert('Failed to logout. Please try again.');
    }
}

window.handleLogout = handleLogout;

// Fix #1: Route guard — check both existence AND expiry of the access token.
async function checkLoginStatus() {
    const currentPage = window.location.pathname.split('/').pop();
    const token = await getAccessToken();
    const isLoggedIn = token && !isTokenExpiredOrInvalid(token);

    // If the token is present but expired, clean it up proactively.
    if (token && !isLoggedIn) {
        await clearTokens();
    }

    const authPages = new Set(['login.html', 'register.html']);
    const protectedPages = new Set(['dashboard.html']);

    if (protectedPages.has(currentPage) && !isLoggedIn) { navigateTo('login.html'); return; }
    if (authPages.has(currentPage) && isLoggedIn) { navigateTo('dashboard.html'); }
}

document.addEventListener('DOMContentLoaded', async () => {
    await checkLoginStatus();

    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
});
