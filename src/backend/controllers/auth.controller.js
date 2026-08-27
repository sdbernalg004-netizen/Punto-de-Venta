/**
 * CONTROLADOR DE AUTENTICACIÓN, REGISTRO DE EMPRESAS Y PERSONAL
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

        const payload = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role: user.role,
            branch_id: user.branch_id,
            branch_name: user.branch_name || 'Todas (Administración Central)'
        };

        const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });

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

function registerTenant(req, res) {
    try {
        const { branch_name, branch_code, branch_address, branch_phone, max_drawer_limit = 3000, owner_name, owner_username, owner_password, owner_pin = '1234' } = req.body;

        if (!branch_name || !owner_name || !owner_username || !owner_password) {
            return res.status(400).json({ success: false, message: 'Ingrese nombre de empresa/sucursal, nombre del dueño, usuario y contraseña.' });
        }

        const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(owner_username);
        if (existingUser) {
            return res.status(400).json({ success: false, message: `El nombre de usuario "${owner_username}" ya está registrado. Elija otro.` });
        }

        const registerTx = db.transaction(() => {
            const codeToUse = branch_code ? branch_code.toUpperCase().trim() : `SUC-${Date.now().toString().slice(-4)}`;
            const insertBranch = db.prepare('INSERT INTO branches (code, name, address, phone, max_cash_drawer_limit) VALUES (?, ?, ?, ?, ?)');
            const branchRes = insertBranch.run(codeToUse, branch_name, branch_address || '', branch_phone || '', max_drawer_limit);
            const newBranchId = branchRes.lastInsertRowid;

            const salt = bcrypt.genSaltSync(10);
            const passHash = bcrypt.hashSync(owner_password, salt);
            const pinHash = bcrypt.hashSync(String(owner_pin), salt);

            const insertOwner = db.prepare("INSERT INTO users (username, password_hash, full_name, role, pin_hash, branch_id) VALUES (?, ?, ?, 'ADMIN', ?, ?)");
            const userRes = insertOwner.run(owner_username, passHash, owner_name, pinHash, newBranchId);
            const newUserId = userRes.lastInsertRowid;

            const allProducts = db.prepare('SELECT id FROM products WHERE is_active = 1').all();
            const insertInv = db.prepare('INSERT INTO inventory (branch_id, product_id, stock_quantity) VALUES (?, ?, 50)');
            allProducts.forEach(p => insertInv.run(newBranchId, p.id));

            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                newBranchId, newUserId, 'TENANT_REGISTERED', `Nueva Empresa/Sucursal "${branch_name}" registrada por el dueño ${owner_name}`
            );

            const payload = {
                id: newUserId,
                username: owner_username,
                full_name: owner_name,
                role: 'ADMIN',
                branch_id: newBranchId,
                branch_name
            };

            const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '12h' });

            return { token, user: payload };
        });

        const result = registerTx();
        res.json({
            success: true,
            message: `¡Registro exitoso! Bienvenido a Dulce POS, ${result.user.full_name}.`,
            token: result.token,
            user: result.user
        });

    } catch (error) {
        console.error('Error en registro:', error);
        res.status(400).json({ success: false, message: error.message.includes('UNIQUE') ? 'El código de sucursal o usuario ya existe.' : error.message });
    }
}

function addStaff(req, res) {
    try {
        const { full_name, username, password, role, pin = '1234', branch_id } = req.body;
        const managerUser = req.approvedByManager || req.user;

        if (!full_name || !username || !password || !role) {
            return res.status(400).json({ success: false, message: 'Ingrese nombre completo, usuario, contraseña y rol (CASHIER / MANAGER).' });
        }

        const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existingUser) {
            return res.status(400).json({ success: false, message: `El usuario "${username}" ya existe.` });
        }

        const salt = bcrypt.genSaltSync(10);
        const passHash = bcrypt.hashSync(password, salt);
        const pinHash = bcrypt.hashSync(String(pin), salt);
        const targetBranch = branch_id || req.user.branch_id || 1;

        db.prepare('INSERT INTO users (username, password_hash, full_name, role, pin_hash, branch_id) VALUES (?, ?, ?, ?, ?, ?)').run(
            username, passHash, full_name, role, pinHash, targetBranch
        );

        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            targetBranch, managerUser.id, 'STAFF_CREATED', `Nuevo personal ${role} "${full_name}" registrado para la sucursal ID ${targetBranch}`
        );

        res.json({ success: true, message: `Empleado "${full_name}" (${role}) registrado con éxito.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al registrar personal.' });
    }
}

function verifyPin(req, res) {
    try {
        const { pin } = req.body;
        if (!pin) return res.status(400).json({ success: false, message: 'PIN requerido.' });

        const managers = db.prepare("SELECT id, username, full_name, pin_hash, role FROM users WHERE role IN ('ADMIN', 'MANAGER') AND is_active = 1").all();
        
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
    registerTenant,
    addStaff,
    verifyPin,
    getMe
};
