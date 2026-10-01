/**
 * CONTROLADOR DE CRÉDITOS A CLIENTES ("FIADO") Y CUENTAS POR COBRAR
 */

const { db } = require('../config/database');

/**
 * Consultar Estado de Cuenta y Créditos Pendientes de Clientes
 */
function getCustomerCredits(req, res) {
    try {
        const { customer_id } = req.query;

        let sql = `
            SELECT cc.*, c.name as customer_name, c.credit_limit, c.current_balance, s.ticket_number, s.total_amount
            FROM customer_credits cc
            JOIN customers c ON cc.customer_id = c.id
            JOIN sales s ON cc.sale_id = s.id
            WHERE 1=1
        `;
        const params = [];

        if (customer_id) {
            sql += ` AND cc.customer_id = ?`;
            params.push(customer_id);
        }

        sql += ` ORDER BY cc.id DESC`;

        const credits = db.prepare(sql).all(...params);
        const customersWithCredit = db.prepare('SELECT * FROM customers WHERE credit_limit > 0 OR current_balance > 0').all();

        res.json({ success: true, credits, customers: customersWithCredit });
    } catch (error) {
        console.error('Error al consultar créditos:', error);
        res.status(500).json({ success: false, message: 'Error al consultar saldo de clientes.' });
    }
}

/**
 * Registrar Abono a Cuenta por Cobrar
 */
function recordCreditPayment(req, res) {
    try {
        const { credit_id, amount, payment_method } = req.body;
        const cashierId = req.user.id;

        if (!credit_id || !amount || amount <= 0) {
            return res.status(400).json({ success: false, message: 'ID de crédito y monto a abonar válidos son requeridos.' });
        }

        const credit = db.prepare('SELECT * FROM customer_credits WHERE id = ?').get(credit_id);
        if (!credit) {
            return res.status(404).json({ success: false, message: 'Registro de crédito no encontrado.' });
        }

        const pendingBalance = credit.amount_credited - credit.amount_paid;
        if (amount > pendingBalance) {
            return res.status(400).json({ success: false, message: `El abono ($${amount}) supera el saldo pendiente ($${pendingBalance.toFixed(2)}).` });
        }

        const paymentTx = db.transaction(() => {
            db.prepare('INSERT INTO credit_payments (credit_id, amount, payment_method, cashier_id) VALUES (?, ?, ?, ?)').run(
                credit_id, amount, payment_method || 'CASH', cashierId
            );

            const newPaid = credit.amount_paid + amount;
            const newStatus = newPaid >= credit.amount_credited ? 'PAID' : 'PARTIAL';

            db.prepare('UPDATE customer_credits SET amount_paid = ?, status = ? WHERE id = ?').run(
                newPaid, newStatus, credit_id
            );

            db.prepare('UPDATE customers SET current_balance = MAX(0, current_balance - ?) WHERE id = ?').run(
                amount, credit.customer_id
            );

            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                req.user.branch_id || null, cashierId, 'CREDIT_PAYMENT',
                `Abono de $${amount.toFixed(2)} a crédito ID ${credit_id}. Saldo restante: $${(credit.amount_credited - newPaid).toFixed(2)}`
            );

            return { newPaid, newStatus, remaining: credit.amount_credited - newPaid };
        });

        const result = paymentTx();
        res.json({
            success: true,
            message: `Abono de $${amount.toFixed(2)} registrado correctamente. Saldo restante: $${result.remaining.toFixed(2)}`,
            summary: result
        });

    } catch (error) {
        console.error('Error al registrar abono:', error);
        res.status(500).json({ success: false, message: 'Error al procesar abono a crédito.' });
    }
}

module.exports = {
    getCustomerCredits,
    recordCreditPayment
};
