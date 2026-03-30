// js/auth.js
export function checkAuth() {
    if (sessionStorage.getItem('pg_auth_token') !== 'true') {
        window.location.href = 'login.html';
    }
}

export function handleLogout() {
    sessionStorage.removeItem('pg_auth_token');
    window.location.href = 'login.html';
}

export function handleLogin(event) {
    event.preventDefault(); 
    
    const userStr = document.getElementById('username').value.trim();
    const passStr = document.getElementById('password').value.trim();
    const errorBox = document.getElementById('errorBox');
    
    document.getElementById('btnText').innerText = 'Doğrulanıyor...';
    document.getElementById('btnIcon').classList.add('hidden');
    document.getElementById('spinner').classList.remove('hidden');
    document.getElementById('submitBtn').disabled = true;
    errorBox.classList.add('hidden');

    const expectedUser = 'YWRtaW4=';         // "admin"
    const expectedPass = 'UGlyaSExOTIzLiw='; // "Piri!1923.,"

    setTimeout(() => {
        if (btoa(userStr) === expectedUser && btoa(passStr) === expectedPass) {
            sessionStorage.setItem('pg_auth_token', 'true');
            window.location.href = 'index.html'; 
        } else {
            errorBox.innerText = 'Hatalı kullanıcı adı veya şifre!';
            errorBox.classList.remove('hidden');
            
            document.getElementById('btnText').innerText = 'Giriş Yap';
            document.getElementById('btnIcon').classList.remove('hidden');
            document.getElementById('spinner').classList.add('hidden');
            document.getElementById('submitBtn').disabled = false;
        }
    }, 800); 
}

// HTML'deki onclick ve onsubmit eventleri için window objesine atama
window.handleLogout = handleLogout;
window.handleLogin = handleLogin;