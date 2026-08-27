/**
 * SERVIDOR PRINCIPAL EXPRESS Y WEBSOCKETS EN TIEMPO REAL
 * ---------------------------------------------------
 * NOTA EDUCATIVA PARA PROGRAMADORES DE JAVA / C++ / PYTHON:
 * En Java (Spring Boot) o Python (FastAPI), configuras la aplicación conectando Controladores a Endpoints REST.
 * En Node.js con Express, instanciamos `express()`, configuramos middlewares (`express.json()`, `cors()`)
 * y conectamos un servidor de WebSockets HTTP nativo usando el módulo `ws`.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

const authController = require('./controllers/auth.controller');
const posController = require('./controllers/pos.controller');
const inventoryController = require('./controllers/inventory.controller');
const shiftsController = require('./controllers/shifts.controller');
const analyticsController = require('./controllers/analytics.controller');

const { authenticateToken, requireRole, scopeBranch, verifyManagerPin } = require('./middlewares/auth.middleware');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middlewares Globales
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// Configuración de WebSockets en Tiempo Real
const connectedClients = new Set();
wss.on('connection', (ws) => {
    connectedClients.add(ws);
    ws.on('close', () => connectedClients.delete(ws));
});

function broadcastWS(data) {
    const payload = JSON.stringify(data);
    connectedClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    });
}
app.set('broadcastWS', broadcastWS);

// ------------------- RUTAS DE LA API -------------------

// 1. Autenticación, Registro de Empresa y Personal
app.post('/api/auth/login', authController.login);
app.post('/api/auth/register-tenant', authController.registerTenant);
app.post('/api/auth/add-staff', authenticateToken, requireRole('ADMIN', 'MANAGER'), authController.addStaff);
app.post('/api/auth/verify-pin', authController.verifyPin);
app.get('/api/auth/me', authenticateToken, authController.getMe);

// 2. Punto de Venta (POS)
app.get('/api/pos/products', authenticateToken, scopeBranch, posController.searchProducts);
app.post('/api/pos/checkout', authenticateToken, posController.checkout);
app.post('/api/pos/void-ticket', authenticateToken, verifyManagerPin, posController.voidTicket);
app.get('/api/pos/ticket/:ticket_number', authenticateToken, posController.getTicketDetails);

// 3. Inventario & Sucursales
app.get('/api/inventory', authenticateToken, scopeBranch, inventoryController.getInventory);
app.post('/api/inventory/update-stock', authenticateToken, verifyManagerPin, inventoryController.updateStock);
app.post('/api/inventory/update-price', authenticateToken, verifyManagerPin, inventoryController.updatePrice);
app.post('/api/inventory/add-product', authenticateToken, requireRole('ADMIN', 'MANAGER'), inventoryController.addProduct);
app.post('/api/inventory/add-stock-entry', authenticateToken, inventoryController.addStockEntry);
app.post('/api/inventory/transfer/create', authenticateToken, inventoryController.createStockTransfer);
app.post('/api/inventory/transfer/receive', authenticateToken, inventoryController.receiveStockTransfer);
app.post('/api/inventory/po/generate', authenticateToken, inventoryController.generateAutoPO);
app.post('/api/inventory/po/receive', authenticateToken, inventoryController.receivePO);

// 4. Turnos de Caja, Arqueo a Ciegas y Sangrías
app.post('/api/shifts/open', authenticateToken, shiftsController.openShift);
app.get('/api/shifts/current', authenticateToken, shiftsController.getCurrentShift);
app.post('/api/shifts/movement', authenticateToken, shiftsController.recordMovement);
app.post('/api/shifts/close', authenticateToken, shiftsController.closeShift);

// 5. Analítica, Proyecciones e Inteligencia Anti-Fraude (Dueño / Admin)
app.get('/api/analytics/dashboard', authenticateToken, requireRole('ADMIN', 'MANAGER'), analyticsController.getDashboardOverview);
app.get('/api/analytics/reorder-suggestions', authenticateToken, requireRole('ADMIN', 'MANAGER'), analyticsController.getReorderSuggestions);
app.get('/api/analytics/fraud-trail', authenticateToken, requireRole('ADMIN'), analyticsController.getFraudAuditTrail);

// Ruta Fallback para SPA HTML5
app.use((req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 SERVIDOR POS DULCERÍA CORRIENDO EN PUERTO: ${PORT}`);
    console.log(`🌐 ACCEDE EN NAVEGADOR: http://localhost:${PORT}`);
    console.log(`=======================================================`);
});
