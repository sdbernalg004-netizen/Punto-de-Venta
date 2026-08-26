/**
 * CONTROLADOR DE TURNOS DE CAJA, ARQUEO A CIEGAS Y SANGRÍAS
 */

const { db } = require('../config/database');

/**
 * Apertura de Turno de Caja
 */
function openShift(req, res) {
    try {
        const { initial_cash } = req.body;
        const cashierId = req.user.id;
        const branchId = req.user.branch_id;

        if (!branchId) {
            return res.status(400).json({ success: false, message: 'El usuario Administrador Central debe operar desde una sucursal específica.' });
        }

        const existingShift = db.prepare("SELECT id FROM shifts WHERE cashier_id = ? AND branch_id = ? AND status = 'OPEN'").get(cashierId, branchId);
        if (existingShift) {
            return res.status(400).json({ success: false, message: 'Ya existe un turno abierto para este cajero en la sucursal.' });
        }

        const stmt = db.prepare("INSERT INTO shifts (branch_id, cashier_id, initial_cash, status) VALUES (?, ?, ?, 'OPEN')");
        const resShift = stmt.run(branchId, cashierId, initial_cash || 0.0);

        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            branchId, cashierId, 'SHIFT_OPENED', `Apertura de turno de caja ID ${resShift.lastInsertRowid} con fondo de $${initial_cash || 0}`
        );

        res.json({ success: true, message: 'Turno de caja abierto correctamente.', shift_id: resShift.lastInsertRowid });
    } catch (error) {
        console.error('Error en openShift:', error);
        res.status(500).json({ success: false, message: 'Error al abrir turno de caja.' });
    }
}

/**
 * Consulta de Estado del Turno Actual del Cajero
 */
function getCurrentShift(req, res) {
    try {
        const cashierId = req.user.id;
        const branchId = req.user.branch_id;

        const shift = db.prepare("SELECT * FROM shifts WHERE cashier_id = ? AND branch_id = ? AND status = 'OPEN'").get(cashierId, branchId);
        if (!shift) {
            return res.json({ success: true, active_shift: null });
        }

        // Totales calculados en el turno
        const salesSummary = db.prepare(`
            SELECT 
                COALESCE(SUM(CASE WHEN payment_method = 'CASH' THEN total_amount ELSE 0 END), 0) as cash_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'CARD' THEN total_amount ELSE 0 END), 0) as card_sales,
                COALESCE(SUM(CASE WHEN payment_method = 'CREDIT' THEN total_amount ELSE 0 END), 0) as credit_sales,
                COUNT(id) as total_tickets
            FROM sales 
            WHERE shift_id = ? AND status = 'COMPLETED'
        `).get(shift.id);

        const movementsSummary = db.prepare(`
            SELECT 
                COALESCE(SUM(CASE WHEN type = 'DROP' THEN amount ELSE 0 END), 0) as total_drops,
                COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END), 0) as total_expenses,
                COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END), 0) as total_deposits
            FROM shift_movements 
            WHERE shift_id = ?
        `).get(shift.id);

        const movements = db.prepare('SELECT * FROM shift_movements WHERE shift_id = ? ORDER BY created_at DESC').all(shift.id);

        // Efectivo Teórico Esperado en Cajón
        const expectedCash = shift.initial_cash + salesSummary.cash_sales + movementsSummary.total_deposits - movementsSummary.total_drops - movementsSummary.total_expenses;

        res.json({
            success: true,
            active_shift: {
                ...shift,
                sales_summary: salesSummary,
                movements_summary: movementsSummary,
                expected_cash: expectedCash,
                movements
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al consultar turno.' });
    }
}

/**
 * Registrar Sangría de Caja / Retiro de Efectivo / Gasto en Turno
 */
function recordMovement(req, res) {
    try {
        const { shift_id, type, amount, reason } = req.body;
        const userId = req.user.id;
        const witnessUser = req.approvedByManager || null;

        if (!shift_id || !type || !amount || !reason) {
            return res.status(400).json({ success: false, message: 'Parámetros incompletos.' });
        }

        const shift = db.prepare("SELECT * FROM shifts WHERE id = ? AND status = 'OPEN'").get(shift_id);
        if (!shift) return res.status(400).json({ success: false, message: 'Turno no encontrado o cerrado.' });

        db.prepare('INSERT INTO shift_movements (shift_id, type, amount, reason, witness_user_id) VALUES (?, ?, ?, ?, ?)').run(
            shift_id, type, amount, reason, witnessUser ? witnessUser.id : null
        );

        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            shift.branch_id, userId, `CASH_${type}`, `Movimiento de caja ${type} por $${amount}. Motivo: ${reason}`
        );

        res.json({ success: true, message: `Movimiento de caja (${type}) registrado correctamente.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al registrar movimiento de caja.' });
    }
}

/**
 * Cierre de Turno con Arqueo a Ciegas (Blind Cash Audit Anti-Fraude)
 */
function closeShift(req, res) {
    try {
        const { shift_id, blind_cash_counted, notes } = req.body;
        const cashierId = req.user.id;

        if (!shift_id || blind_cash_counted === undefined) {
            return res.status(400).json({ success: false, message: 'Debe ingresar el efectivo físico contado (Arqueo a Ciegas).' });
        }

        const executeCloseTx = db.transaction(() => {
            const shift = db.prepare("SELECT * FROM shifts WHERE id = ? AND status = 'OPEN'").get(shift_id);
            if (!shift) throw new Error('Turno de caja no encontrado o ya cerrado.');

            // Calcular Efectivo Esperado Teórico
            const cashSales = db.prepare(`
                SELECT COALESCE(SUM(total_amount), 0) as total 
                FROM sales WHERE shift_id = ? AND payment_method = 'CASH' AND status = 'COMPLETED'
            `).get(shift.id).total;

            const movs = db.prepare(`
                SELECT 
                    COALESCE(SUM(CASE WHEN type = 'DROP' THEN amount ELSE 0 END), 0) as drops,
                    COALESCE(SUM(CASE WHEN type = 'EXPENSE' THEN amount ELSE 0 END), 0) as expenses,
                    COALESCE(SUM(CASE WHEN type = 'DEPOSIT' THEN amount ELSE 0 END), 0) as deposits
                FROM shift_movements WHERE shift_id = ?
            `).get(shift.id);

            const expectedCash = shift.initial_cash + cashSales + movs.deposits - movs.drops - movs.expenses;
            const discrepancy = blind_cash_counted - expectedCash; // Faltante (-) o Sobrante (+)

            // Actualizar Turno
            db.prepare(`
                UPDATE shifts 
                SET closed_at = CURRENT_TIMESTAMP, blind_cash_counted = ?, expected_cash = ?, discrepancy = ?, status = 'CLOSED', notes = ?
                WHERE id = ?
            `).run(blind_cash_counted, expectedCash, discrepancy, notes || '', shift.id);

            // Generar Alerta Anti-Fraude si hay Faltante Significativo
            if (discrepancy < -50.0) { // Faltante mayor a $50
                db.prepare(`
                    INSERT INTO fraud_alerts (branch_id, user_id, alert_type, severity, description)
                    VALUES (?, ?, 'CASH_DISCREPANCY_SHORTAGE', 'HIGH', ?)
                `).run(
                    shift.branch_id, cashierId, 
                    `Faltante de dinero detectado en Arqueo a Ciegas. Contado: $${blind_cash_counted.toFixed(2)}, Esperado: $${expectedCash.toFixed(2)}. Faltante: $${Math.abs(discrepancy).toFixed(2)}`
                );
            }

            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                shift.branch_id, cashierId, 'SHIFT_CLOSED', 
                `Cierre de turno ID ${shift.id}. Contado: $${blind_cash_counted}, Esperado: $${expectedCash.toFixed(2)}, Diferencia: $${discrepancy.toFixed(2)}`
            );

            return {
                shift_id: shift.id,
                blind_cash_counted,
                expected_cash: expectedCash,
                discrepancy,
                notes
            };
        });

        const result = executeCloseTx();
        res.json({
            success: true,
            message: 'Turno de caja cerrado exitosamente con Arqueo a Ciegas.',
            summary: result
        });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

module.exports = {
    openShift,
    getCurrentShift,
    recordMovement,
    closeShift
};
