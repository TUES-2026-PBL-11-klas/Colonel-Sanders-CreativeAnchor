// src/app.js - Navigation logic

function handleLogin(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    // Store login state in localStorage
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('username', username);
    
    // Navigate to dashboard
    window.location.href = 'dashboard.html';
}

function handleLogout() {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    window.location.href = 'login.html';
}

// Check login status on page load
function checkLoginStatus() {
    const currentPage = window.location.pathname.split('/').pop();
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    
    // Redirect to login if trying to access dashboard without login
    if (currentPage === 'dashboard.html' && !isLoggedIn) {
        window.location.href = 'login.html';
    }
    
    // Redirect to dashboard if already logged in and on login page
    if (currentPage === 'login.html' && isLoggedIn) {
        window.location.href = 'dashboard.html';
    }
}

// Run on every page load
checkLoginStatus();
