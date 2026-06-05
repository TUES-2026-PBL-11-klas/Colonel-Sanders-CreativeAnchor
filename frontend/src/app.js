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
        } catch (parseError) {
            console.error('Failed to parse response:', parseError);
            errorDiv.textContent = 'Server returned invalid data. Please check the backend.';
            errorDiv.style.display = 'block';
            return;
        }

        if (response.ok && data.access_token) {
            await store.set('userId', data.user_id || data.user?.id || '');
            await store.set('userEmail', email);
            navigateTo('dashboard.html');
        } else {
            errorDiv.textContent = data.message || 'Login failed. Please check your credentials.';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Login error:', error);
        errorDiv.textContent = 'Could not reach the server. Please make sure the backend is running.';
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
    if (password.length < 6) {
        errorDiv.textContent = 'Password must be at least 6 characters long.';
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
        } catch (parseError) {
            console.error('Failed to parse response:', parseError);
            errorDiv.textContent = 'Server returned invalid data. Please check the backend.';
            errorDiv.style.display = 'block';
            return;
        }

        if (response.ok) {
            document.getElementById('registerForm').reset();
            navigateTo('login.html');
        } else {
            errorDiv.textContent = data.message || 'Registration failed. Please try again.';
            errorDiv.style.display = 'block';
        }
    } catch (error) {
        console.error('Registration error:', error);
        errorDiv.textContent = 'Could not reach the server. Please make sure the backend is running.';
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

// Route guard
async function checkLoginStatus() {
    const currentPage = window.location.pathname.split('/').pop();
    const isLoggedIn = Boolean(await getAccessToken());
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
