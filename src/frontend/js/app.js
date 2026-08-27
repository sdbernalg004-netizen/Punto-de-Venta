/**
 * CLIENTE PRINCIPAL SPA, CLIENTE API Y ESTADO GENERAL
 * ----------------------------------------------------
 * NOTA EDUCATIVA PARA PROGRAMADORES DE JAVA / C++ / PYTHON:
 * En Java o C++ administras el estado de la aplicación mediante objetos y singletons en memoria.
 * En la Web Frontend, `localStorage` funciona como una persistencia clave-valor local en el navegador.
 * Guardaremos el Token JWT para adjuntarlo automáticamente en los Headers HTTP de cada petición `fetch()`.
 */

const STATE = {
    token: localStorage.getItem('pos_token') || null,
    user: JSON.parse(localStorage.getItem('pos_user')) || null,
    currentView: 'pos',
    cart: [],
    categories: [],
    pendingPinResolve: null
};

// Conexión a WebSocket para actualizaciones en tiempo real
let ws = null;
function initWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'SALE_COMPLETED' || data.type === 'INVENTORY_UPDATED') {
            // Actualizar vista actual si estamos en inventario o pos
            if (STATE.currentView === 'pos' && typeof loadPOSProducts === 'function') {
                loadPOSProducts();
            } else if (STATE.currentView === 'inventory' && typeof loadInventory === 'function') {
                loadInventory();
            } else if (STATE.currentView === 'dashboard' && typeof loadDashboardOverview === 'function') {
                loadDashboardOverview();
            }
        }
    };
}

/**
 * Wrapper de Peticiones HTTP Fetch Centralizado
 */
async function apiFetch(endpoint, options = {}) {
    const headers = options.headers || {};
    if (STATE.token) {
        headers['Authorization'] = `Bearer ${STATE.token}`;
    }
    headers['Content-Type'] = 'application/json';

    try {
        const response = await fetch(endpoint, { ...options, headers });
        const data = await response.json();

        if (response.status === 401 && data.message.includes('Token')) {
            logout();
            throw new Error('Sesión expirada. Por favor inicie sesión nuevamente.');
        }

        if (!response.ok && data.require_pin) {
            // Requerimiento de PIN Anti-Fraude
            const pin = await requestManagerPinModal();
            if (pin) {
                headers['x-manager-pin'] = pin;
                return apiFetch(endpoint, { ...options, headers });
            }
        }

        return data;
    } catch (error) {
        console.error('Error API:', error);
        throw error;
    }
}

// Navegación entre vistas SPA
function switchView(viewName) {
    STATE.currentView = viewName;

    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#main-container > div').forEach(v => v.classList.add('hidden'));

    const navBtn = document.getElementById(`nav-${viewName}`);
    if (navBtn) navBtn.classList.add('active');

    const targetView = document.getElementById(`view-${viewName}`);
    if (targetView) targetView.classList.remove('hidden');

    const titles = {
        pos: 'Punto de Venta',
        inventory: 'Inventarios y Lotes por Sucursal',
        shifts: 'Caja, Turnos y Arqueo a Ciegas',
        dashboard: 'Dashboard del Dueño y Analítica',
        audit: 'Bitácora de Auditoría Anti-Fraude'
    };
    document.getElementById('view-title').innerText = titles[viewName] || 'Punto de Venta';

    // Cargar datos específicos según la vista
    if (viewName === 'pos' && typeof loadPOSProducts === 'function') loadPOSProducts();
    if (viewName === 'inventory' && typeof loadInventory === 'function') loadInventory();
    if (viewName === 'shifts' && typeof loadShiftStatus === 'function') loadShiftStatus();
    if (viewName === 'dashboard' && typeof loadDashboardOverview === 'function') loadDashboardOverview();
    if (viewName === 'audit' && typeof loadAuditLogs === 'function') loadAuditLogs();
}

// Control de Modal PIN
function requestManagerPinModal() {
    return new Promise((resolve) => {
        STATE.pendingPinResolve = resolve;
        document.getElementById('manager-pin-input').value = '';
        document.getElementById('modal-pin').classList.remove('hidden');
        document.getElementById('manager-pin-input').focus();
    });
}

function closePinModal(authorized = false) {
    document.getElementById('modal-pin').classList.add('hidden');
    if (STATE.pendingPinResolve) {
        const pinValue = document.getElementById('manager-pin-input').value;
        STATE.pendingPinResolve(authorized ? pinValue : null);
        STATE.pendingPinResolve = null;
    }
}

function submitPinModal() {
    closePinModal(true);
}

// Autenticación & Logout
async function handleLogin(e) {
    e.preventDefault();
    const u = document.getElementById('login-username').value;
    const p = document.getElementById('login-password').value;

    try {
        const res = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username: u, password: p })
        });

        if (res.success) {
            STATE.token = res.token;
            STATE.user = res.user;
            localStorage.setItem('pos_token', res.token);
            localStorage.setItem('pos_user', JSON.stringify(res.user));
            
            document.getElementById('modal-login').classList.add('hidden');
            document.getElementById('app-layout').classList.remove('hidden');
            updateUserUI();
            switchView('pos');
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al conectar con el servidor.');
    }
}

// Modal Registro de Nueva Empresa / Sucursal
function openRegisterModal() {
    document.getElementById('modal-login').classList.add('hidden');
    document.getElementById('modal-register').classList.remove('hidden');
}

function closeRegisterModal() {
    document.getElementById('modal-register').classList.add('hidden');
    document.getElementById('modal-login').classList.remove('hidden');
}

async function handleRegisterTenant(e) {
    e.preventDefault();
    const payload = {
        branch_name: document.getElementById('reg-branch-name').value.trim(),
        branch_code: document.getElementById('reg-branch-code').value.trim(),
        branch_address: document.getElementById('reg-branch-address').value.trim(),
        branch_phone: document.getElementById('reg-branch-phone').value.trim(),
        owner_name: document.getElementById('reg-owner-name').value.trim(),
        owner_username: document.getElementById('reg-owner-username').value.trim(),
        owner_password: document.getElementById('reg-owner-password').value.trim(),
        owner_pin: document.getElementById('reg-owner-pin').value.trim() || '1234'
    };

    try {
        const res = await apiFetch('/api/auth/register-tenant', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.success) {
            alert(`🎉 ${res.message}`);
            STATE.token = res.token;
            STATE.user = res.user;
            localStorage.setItem('pos_token', res.token);
            localStorage.setItem('pos_user', JSON.stringify(res.user));
            
            document.getElementById('modal-register').classList.add('hidden');
            document.getElementById('app-layout').classList.remove('hidden');
            updateUserUI();
            switchView('pos');
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al registrar empresa.');
    }
}

function logout() {
    localStorage.removeItem('pos_token');
    localStorage.removeItem('pos_user');
    STATE.token = null;
    STATE.user = null;
    document.getElementById('app-layout').classList.add('hidden');
    document.getElementById('modal-login').classList.remove('hidden');
}

function updateUserUI() {
    if (!STATE.user) return;
    document.getElementById('user-name').innerText = STATE.user.full_name;
    document.getElementById('user-role-badge').innerText = STATE.user.role;
    document.getElementById('user-branch-name').innerText = STATE.user.branch_name;

    // Ocultar o mostrar pestañas según rol
    const isOwner = STATE.user.role === 'ADMIN';
    document.getElementById('nav-dashboard').style.display = isOwner || STATE.user.role === 'MANAGER' ? 'flex' : 'none';
    document.getElementById('nav-audit').style.display = isOwner ? 'flex' : 'none';
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('hidden');
}

// Inicialización de App con Carga Instantánea de Login
window.addEventListener('DOMContentLoaded', async () => {
    initWebSocket();
    if (!STATE.token) {
        document.getElementById('app-layout').classList.add('hidden');
        document.getElementById('modal-login').classList.remove('hidden');
    } else {
        try {
            const meRes = await apiFetch('/api/auth/me');
            if (meRes.success) {
                document.getElementById('modal-login').classList.add('hidden');
                document.getElementById('app-layout').classList.remove('hidden');
                updateUserUI();
                switchView('pos');
            } else {
                logout();
            }
        } catch (e) {
            logout();
        }
    }
});
