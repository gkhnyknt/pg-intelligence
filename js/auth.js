// js/auth.js
import { fetchMeApi, logoutApi } from './api.js';

// Oturum sunucuda doğrulanır; geçersizse api.js giriş sayfasına yönlendirir.
export async function checkAuth() {
    try {
        await fetchMeApi();
    } catch (e) {}
}

export async function handleLogout() {
    try {
        await logoutApi();
    } catch (e) {}
    window.location.href = 'login.html';
}

// HTML'deki onclick eventleri için window objesine atama
window.handleLogout = handleLogout;
