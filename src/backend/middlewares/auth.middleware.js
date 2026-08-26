/**
 * MIDDLEWARE DE AUTENTICACIÓN, ROLES Y AISLAMIENTO POR SUCURSAL
 */

require('dotenv').config();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');

const getJwtSecret = () => process.env.JWT_SECRET || 'CLAVE_SUPER_SECRETA_POS_DULCERIA_2026';

/**
 * 1. Autenticación por Token JWT
 */
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ success: false, message: 'Acceso denegado. No se proporcionó Token de Sesión.' });
    }

    jwt.verify(token, getJwtSecret(), (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, message: 'Sesión expirada o token inválido.' });
        }
        req.user = user;
        next();
    });
}

/**
 * 2. Control de Acceso Basado en Roles (RBAC)
 */
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                success: false, 
                message: `Permisos insuficientes. Su rol (${req.user ? req.user.role : 'invitado'}) no tiene acceso a esta función.` 
            });
        }
        next();
    };
}

/**
 * 3. Scope / Aislamiento por Sucursal (Multi-Tenancy Security)
 * Garantiza que un cajero/gerente de la Sucursal A NUNCA pueda ver o modificar datos de la Sucursal B.
 */
function scopeBranch(req, res, next) {
    if (req.user && req.user.role === 'ADMIN') {
        req.targetBranchId = req.query.branch_id || (req.body && req.body.branch_id) || null;
    } else if (req.user) {
        req.targetBranchId = req.user.branch_id;
    } else {
        req.targetBranchId = null;
    }
    next();
}

/**
 * 4. Verificación de PIN de Gerente Anti-Fraude
 * Requerido para acciones de alto riesgo: cancelaciones, descuentos, arqueo fuera de turno.
 */
function verifyManagerPin(req, res, next) {
    const managerPin = req.headers['x-manager-pin'];

    if (!managerPin && req.user.role !== 'ADMIN') {
        return res.status(403).json({ 
            success: false, 
            require_pin: true,
            message: 'Esta acción requiere autorización mediante PIN de Gerente o Administrador.' 
        });
    }

    if (!managerPin && req.user.role === 'ADMIN') {
        req.approvedByManager = req.user;
        return next();
    }

    // Buscar usuarios con rol MANAGER o ADMIN
    const managers = db.prepare('SELECT id, username, pin_hash, role FROM users WHERE role IN ("ADMIN", "MANAGER") AND is_active = 1').all();
    
    let isAuthorized = false;
    let approvingUser = null;

    for (const mgr of managers) {
        if (mgr.pin_hash && bcrypt.compareSync(managerPin, mgr.pin_hash)) {
            isAuthorized = true;
            approvingUser = mgr;
            break;
        }
    }

    if (!isAuthorized) {
        return res.status(401).json({ 
            success: false, 
            require_pin: true,
            message: 'PIN de autorización incorrecto o sin privilegios de gerencia.' 
        });
    }

    req.approvedByManager = approvingUser;
    next();
}

module.exports = {
    JWT_SECRET: getJwtSecret(),
    getJwtSecret,
    authenticateToken,
    requireRole,
    scopeBranch,
    verifyManagerPin
};
