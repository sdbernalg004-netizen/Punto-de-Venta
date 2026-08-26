/**
 * CONTROLADOR DE AUTENTICACIÓN Y USUARIOS
 */

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db } = require('../config/database');
const { getJwtSecret } = require('../middlewares/auth.middleware');

function login(req, res) {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Ingrese usuario y contraseña.' });
        }

        const user = db.prepare(`
            SELECT u.*, b.name as branch_name 
            FROM users u 
            LEFT JOIN branches b ON u.branch_id = b.id 
            WHERE u.username = ? AND u.is_active = 1
        `).get(username);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
            return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });
        }

        // Generar JWT Token
        const payload = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            branch_id: user.branch_id,
            branch_name: user.branch_name || 'Todas (Administración Central)'
        };

        const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });

        // Registrar en Bitácora de Auditoría
        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            user.branch_id, user.id, 'USER_LOGIN', `Inicio de sesión exitoso desde IP: ${req.ip}`
        );

        res.json({
            success: true,
            token,
            user: payload
        });
    } catch (error) {
        console.error('Error en Login:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor.' });
    }
}

function verifyPin(req, res) {
    try {
        const { pin } = req.body;
        if (!pin) return res.status(400).json({ success: false, message: 'PIN requerido.' });

        const managers = db.prepare('SELECT id, username, full_name, pin_hash, role FROM users WHERE role IN ("ADMIN", "MANAGER") AND is_active = 1').all();
        
        let foundUser = null;
        for (const mgr of managers) {
            if (mgr.pin_hash && bcrypt.compareSync(pin, mgr.pin_hash)) {
                foundUser = mgr;
                break;
            }
        }

        if (foundUser) {
            return res.json({ success: true, authorized_by: foundUser.full_name, role: foundUser.role });
        } else {
            return res.status(401).json({ success: false, message: 'PIN no válido o sin privilegios de gerencia.' });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al verificar PIN.' });
    }
}

function getMe(req, res) {
    res.json({ success: true, user: req.user });
}

module.exports = {
    login,
    verifyPin,
    getMe
};
