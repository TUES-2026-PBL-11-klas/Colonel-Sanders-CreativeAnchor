// src/api.js

// ── Base URL construction ─────────────────────────────────────────────────────
const API_BASE_URL = 'http://localhost:5000/';

// ── Token storage IPC helpers ─────────────────────────────────────────────────
const getAccessToken = () =>
    window.electronAPI.store.get('access_token');

const getRefreshToken = () =>
    window.electronAPI.store.get('refresh_token');

const setAccessToken = (access) =>
    window.electronAPI.store.set('access_token', access);

const setRefreshToken = (refresh) =>
    window.electronAPI.store.set('refresh_token', refresh);

const setTokens = async (access, refresh = '') => {
    if (!access) {
        throw new Error('Missing access token');
    }

    const operations = [
        setAccessToken(access),
    ];

    if (refresh) {
        operations.push(setRefreshToken(refresh));
    }

    return Promise.all(operations);
};

const updateTokens = async ({ access_token, refresh_token }) => {
    const operations = [];

    if (access_token) {
        operations.push(setAccessToken(access_token));
    }

    // Some backends rotate refresh tokens, some do not.
    // Only overwrite it if the backend actually returned one.
    if (refresh_token) {
        operations.push(setRefreshToken(refresh_token));
    }

    return Promise.all(operations);
};

const clearTokens = () =>
    Promise.all([
        window.electronAPI.store.delete('access_token'),
        window.electronAPI.store.delete('refresh_token'),
    ]);

// ── Auth endpoint helpers ─────────────────────────────────────────────────────
const AUTH_ENDPOINTS = new Set([
    '/login',
    '/signup',
    '/refresh',
]);

const getPathname = (endpoint) =>
    new URL(endpoint, API_BASE_URL).pathname;

const isAuthEndpoint = (endpoint) =>
    AUTH_ENDPOINTS.has(getPathname(endpoint));

// Prevent multiple simultaneous refresh attempts.
let refreshPromise = null;

const refreshAccessToken = () => {
    if (!refreshPromise) {
        refreshPromise = (async () => {
            const refreshToken = await getRefreshToken();

            if (!refreshToken) {
                await clearTokens();
                return null;
            }

            const refreshResponse = await fetch(`${API_BASE_URL}/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    refresh_token: refreshToken,
                }),
            });

            if (!refreshResponse.ok) {
                await clearTokens();
                return null;
            }

            const data = await refreshResponse.json();

            if (!data?.access_token) {
                await clearTokens();
                return null;
            }

            await updateTokens(data);

            return data.access_token;
        })().finally(() => {
            refreshPromise = null;
        });
    }

    return refreshPromise;
};

// ── API class ─────────────────────────────────────────────────────────────────
class API {
    static async #fetch(endpoint, options = {}, forcedAccessToken = null) {
        const accessToken = forcedAccessToken ?? await getAccessToken();

        const headers = {
            ...(options.headers || {}),
        };

        if (!headers['Content-Type'] && options.body) {
            headers['Content-Type'] = 'application/json';
        }

        if (accessToken) {
            headers.Authorization = `Bearer ${accessToken}`;
        }

        const fullUrl = new URL(endpoint, API_BASE_URL).toString();

        console.log(`[API] ${options.method || 'GET'} ${fullUrl}`);

        const response = await fetch(fullUrl, {
            ...options,
            headers,
        });

        console.log(`[API] Response: ${response.status} ${response.statusText}`);

        return response;
    }

    // Private — call only through the public static methods below.
    static async #request(endpoint, options = {}) {
        const response = await API.#fetch(endpoint, options);

        // Do not refresh auth requests themselves.
        if (response.status !== 401 || isAuthEndpoint(endpoint)) {
            return response;
        }

        const newAccessToken = await refreshAccessToken();

        // Return the original 401 so callers can redirect to login.
        if (!newAccessToken) {
            return response;
        }

        // Retry original request with fresh access token.
        return API.#fetch(endpoint, options, newAccessToken);
    }

    static async #persistAuthTokensFromResponse(response, { clearExisting = false } = {}) {
        if (!response.ok) {
            return;
        }

        const data = await response.clone().json().catch(() => null);

        if (!data?.access_token) {
            return;
        }

        if (clearExisting) {
            await clearTokens();
        }

        await updateTokens(data);
    }

    // ── Auth ──────────────────────────────────────────────────────────────────
    static async logout() {
        // Backend /logout is not implemented yet, so this is local logout only.
        await clearTokens();

        return {
            ok: true,
        };
    }

    static async register(payload) {
        const response = await API.#request('/signup', {
            method: 'POST',
            body: JSON.stringify({
                email: String(payload.email || '').trim().toLowerCase(),
                password: payload.password,
            }),
        });

        await API.#persistAuthTokensFromResponse(response, {
            clearExisting: true,
        });

        return response;
    }

    static async login(payload) {
        const response = await API.#request('/login', {
            method: 'POST',
            body: JSON.stringify({
                email: String(payload.email || '').trim().toLowerCase(),
                password: payload.password,
            }),
        });

        await API.#persistAuthTokensFromResponse(response, {
            clearExisting: true,
        });

        return response;
    }
}

export {
    API,
    setTokens,
    clearTokens,
    getAccessToken,
    getRefreshToken,
};