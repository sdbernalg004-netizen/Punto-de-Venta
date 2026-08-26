/**
 * CONTROLADOR DE PUNTO DE VENTA (POS) - TRANSACCIONALIDAD E INTEGRIDAD DE DATOS
 * -----------------------------------------------------------------------------
 * NOTA EDUCATIVA PARA PROGRAMADORES DE JAVA / C++ / PYTHON:
 * En C++ y Java, cuando realizas operaciones de transferencia de fondos o actualización de inventarios,
 * debes asegurar la propiedad ACID (Atomicidad, Consistencia, Aislamiento, Durabilidad).
 * Aquí usamos `db.transaction(() => { ... })()`. Better-SQLite3 ejecuta todo el bloque de código
 * dentro de un 'BEGIN EXCLUSIVE TRANSACTION' a nivel nativo. Si cualquier validación lanza un Error,
 * la base de datos realiza un ROLLBACK automático de TODOS los cambios (stock, ticket, movimientos de caja).
 */

const { db, calculateTicketHash } = require('../config/database');

/**
 * Búsqueda de Productos por Código de Barras, SKU o Nombre
 */
function searchProducts(req, res) {
    try {
        const { query, quick_keys_only, category_id } = req.query;
        const branchId = req.targetBranchId;

        let sql = `
            SELECT p.*, c.name as category_name, COALESCE(i.stock_quantity, 0) as stock_quantity
            FROM products p
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN inventory i ON p.id = i.product_id AND i.branch_id = ?
            WHERE p.is_active = 1
        `;
        const params = [branchId];

        if (quick_keys_only === 'true') {
            sql += ` AND p.quick_key = 1`;
        }
        if (category_id) {
            sql += ` AND p.category_id = ?`;
            params.push(category_id);
        }
        if (query) {
            sql += ` AND (p.barcode = ? OR p.sku LIKE ? OR p.name LIKE ?)`;
            params.push(query, `%${query}%`, `%${query}%`);
        }

        sql += ` ORDER BY p.name ASC LIMIT 50`;

        const products = db.prepare(sql).all(...params);
        res.json({ success: true, products });
    } catch (error) {
        console.error('Error al buscar productos:', error);
        res.status(500).json({ success: false, message: 'Error en servidor al buscar productos.' });
    }
}

/**
 * Cobro de Ticket y Procesamiento de Venta (Transacción ACID Atomica + Hash SHA-256)
 */
function checkout(req, res) {
    try {
        const { items, payment_method, cash_received, customer_id, discount_amount = 0 } = req.body;
        const cashierId = req.user.id;
        const branchId = req.user.branch_id;

        if (!branchId) {
            return res.status(400).json({ success: false, message: 'El usuario Administrador debe seleccionar una sucursal para realizar cobranza.' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'El carrito de compras está vacío.' });
        }

        // 1. Verificar que el cajero tenga un turno de caja abierto
        const activeShift = db.prepare("SELECT * FROM shifts WHERE cashier_id = ? AND branch_id = ? AND status = 'OPEN'").get(cashierId, branchId);
        if (!activeShift) {
            return res.status(400).json({ success: false, message: 'No hay un turno de caja abierto. Inicie turno con su caja inicial antes de cobrar.' });
        }

        // 2. Ejecución dentro de una Transacción Atómica ACID
        const executeCheckoutTransaction = db.transaction(() => {
            let subtotal = 0;
            const itemsToProcess = [];

            // A. Verificar existencias y calcular subtotales
            for (const item of items) {
                const product = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1').get(item.product_id);
                if (!product) {
                    throw new Error(`El producto ID ${item.product_id} no existe o fue desactivado.`);
                }

                const inv = db.prepare('SELECT stock_quantity FROM inventory WHERE branch_id = ? AND product_id = ?').get(branchId, item.product_id);
                const currentStock = inv ? inv.stock_quantity : 0;

                if (currentStock < item.quantity) {
                    throw new Error(`Stock insuficiente para "${product.name}". Solicitado: ${item.quantity}, Disponible: ${currentStock}`);
                }

                const itemSubtotal = product.sale_price * item.quantity;
                subtotal += itemSubtotal;

                itemsToProcess.push({
                    product,
                    quantity: item.quantity,
                    unit_price: product.sale_price,
                    subtotal: itemSubtotal
                });
            }

            const totalAmount = Math.max(0, subtotal - discount_amount);
            const changeGiven = payment_method === 'CASH' ? Math.max(0, cash_received - totalAmount) : 0;

            // B. Generar Folio Secuencial de Ticket
            const countSales = db.prepare('SELECT COUNT(*) as count FROM sales WHERE branch_id = ?').get(branchId).count;
            const branchCode = db.prepare('SELECT code FROM branches WHERE id = ?').get(branchId).code;
            const ticketNumber = `TK-${branchCode}-${String(countSales + 1).padStart(6, '0')}`;

            // C. Obtener el Hash del Ticket Anterior para encadenamiento criptográfico
            const lastSale = db.prepare('SELECT ticket_hash FROM sales ORDER BY id DESC LIMIT 1').get();
            const previousHash = lastSale ? lastSale.ticket_hash : 'GENESIS_HASH';
            const createdAt = new Date().toISOString();
            const ticketHash = calculateTicketHash(ticketNumber, totalAmount, createdAt, previousHash);

            // D. Insertar Registro de Venta
            const saleStmt = db.prepare(`
                INSERT INTO sales 
                (ticket_number, branch_id, shift_id, cashier_id, customer_id, subtotal, discount_amount, total_amount, payment_method, cash_received, change_given, previous_hash, ticket_hash, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?)
            `);
            const saleResult = saleStmt.run(
                ticketNumber, branchId, activeShift.id, cashierId, customer_id || null, 
                subtotal, discount_amount, totalAmount, payment_method, cash_received || 0, changeGiven, 
                previousHash, ticketHash, createdAt
            );
            const saleId = saleResult.lastInsertRowid;

            // E. Insertar Detalles de los Artículos y Descontar Inventario (FEFO)
            const insertItemStmt = db.prepare('INSERT INTO sale_items (sale_id, product_id, product_name, unit_price, quantity, subtotal, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
            const updateInvStmt = db.prepare('UPDATE inventory SET stock_quantity = stock_quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE branch_id = ? AND product_id = ?');

            for (const item of itemsToProcess) {
                // Descontar del Lote más próximo a vencer si aplica (FEFO)
                const activeBatch = db.prepare(`
                    SELECT id FROM product_batches 
                    WHERE product_id = ? AND branch_id = ? AND current_quantity > 0 
                    ORDER BY expiration_date ASC LIMIT 1
                `).get(item.product.id, branchId);

                let batchId = null;
                if (activeBatch) {
                    batchId = activeBatch.id;
                    db.prepare('UPDATE product_batches SET current_quantity = MAX(0, current_quantity - ?) WHERE id = ?').run(item.quantity, batchId);
                }

                insertItemStmt.run(saleId, item.product.id, item.product.name, item.unit_price, item.quantity, item.subtotal, batchId);
                updateInvStmt.run(item.quantity, branchId, item.product.id);
            }

            // F. Actualizar saldo del cliente si fue pago a Crédito (Fiado)
            if (payment_method === 'CREDIT' && customer_id) {
                db.prepare('UPDATE customers SET current_balance = current_balance + ? WHERE id = ?').run(totalAmount, customer_id);
            }

            // G. Auditoría Anti-Fraude: Verificar límite de efectivo acumulado en el cajón de la sucursal
            const branchInfo = db.prepare('SELECT max_cash_drawer_limit FROM branches WHERE id = ?').get(branchId);
            const totalCashInShift = db.prepare(`
                SELECT (
                    COALESCE(SUM(total_amount), 0) + ? 
                    - COALESCE((SELECT SUM(amount) FROM shift_movements WHERE shift_id = ? AND type = 'DROP'), 0)
                ) as net_cash
                FROM sales 
                WHERE shift_id = ? AND payment_method = 'CASH' AND status = 'COMPLETED'
            `).get(activeShift.initial_cash, activeShift.id, activeShift.id).net_cash;

            let drawerWarning = false;
            if (totalCashInShift > branchInfo.max_cash_drawer_limit) {
                drawerWarning = true;
                db.prepare(`
                    INSERT INTO fraud_alerts (branch_id, user_id, alert_type, severity, description)
                    VALUES (?, ?, 'DRAWER_LIMIT_EXCEEDED', 'MEDIUM', ?)
                `).run(
                    branchId, cashierId, 
                    `Efectivo acumulado en cajón ($${totalCashInShift.toFixed(2)}) supera el límite de seguridad ($${branchInfo.max_cash_drawer_limit.toFixed(2)}). Se requiere Sangría de Caja.`
                );
            }

            // H. Registro de Auditoría
            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                branchId, cashierId, 'SALE_CHECKOUT', `Venta cobrada ${ticketNumber} por $${totalAmount.toFixed(2)} [${payment_method}]`
            );

            return {
                sale_id: saleId,
                ticket_number: ticketNumber,
                total: totalAmount,
                change_given: changeGiven,
                ticket_hash: ticketHash,
                drawer_warning: drawerWarning,
                net_cash_in_drawer: totalCashInShift
            };
        });

        const result = executeCheckoutTransaction();

        // Notificar en tiempo real mediante WebSockets si hay clientes conectados
        if (req.app.get('broadcastWS')) {
            req.app.get('broadcastWS')({ type: 'SALE_COMPLETED', branch_id: branchId, sale_id: result.sale_id });
        }

        res.json({
            success: true,
            message: 'Venta completada con éxito.',
            sale: result
        });

    } catch (error) {
        console.error('Error en Checkout:', error.message);
        res.status(400).json({ success: false, message: error.message });
    }
}

/**
 * Anulación de Ticket con Requerimiento de PIN de Gerente Anti-Fraude
 */
function voidTicket(req, res) {
    try {
        const { ticket_number, reason } = req.body;
        const managerUser = req.approvedByManager;

        if (!ticket_number || !reason) {
            return res.status(400).json({ success: false, message: 'Indique número de ticket y motivo de anulación.' });
        }

        const executeVoidTransaction = db.transaction(() => {
            const sale = db.prepare("SELECT * FROM sales WHERE ticket_number = ? AND status = 'COMPLETED'").get(ticket_number);
            if (!sale) {
                throw new Error('El ticket no existe o ya se encuentra anulado.');
            }

            // Revertir inventario
            const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
            for (const item of items) {
                db.prepare('UPDATE inventory SET stock_quantity = stock_quantity + ? WHERE branch_id = ? AND product_id = ?')
                    .run(item.quantity, sale.branch_id, item.product_id);

                if (item.batch_id) {
                    db.prepare('UPDATE product_batches SET current_quantity = current_quantity + ? WHERE id = ?')
                        .run(item.quantity, item.batch_id);
                }
            }

            // Marcar ticket como ANULADO
            db.prepare(`
                UPDATE sales 
                SET status = 'VOIDED', void_approved_by = ?, void_reason = ? 
                WHERE id = ?
            `).run(managerUser.id, reason, sale.id);

            // Si fue a crédito, descontar saldo del cliente
            if (sale.payment_method === 'CREDIT' && sale.customer_id) {
                db.prepare('UPDATE customers SET current_balance = MAX(0, current_balance - ?) WHERE id = ?').run(sale.total_amount, sale.customer_id);
            }

            // Auditoría Anti-Fraude
            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                sale.branch_id, managerUser.id, 'TICKET_VOIDED', `Ticket ${ticket_number} por $${sale.total_amount} fue ANULADO por ${managerUser.username}. Motivo: ${reason}`
            );

            return { ticket_number, voided_by: managerUser.username };
        });

        const result = executeVoidTransaction();
        res.json({ success: true, message: `Ticket ${ticket_number} anulado exitosamente. Inventario restablecido.`, data: result });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

/**
 * Obtener detalles completos de un Ticket para Reimpresión
 */
function getTicketDetails(req, res) {
    try {
        const { ticket_number } = req.params;
        const sale = db.prepare(`
            SELECT s.*, u.full_name as cashier_name, b.name as branch_name, b.address as branch_address, b.phone as branch_phone, c.name as customer_name
            FROM sales s
            JOIN users u ON s.cashier_id = u.id
            JOIN branches b ON s.branch_id = b.id
            LEFT JOIN customers c ON s.customer_id = c.id
            WHERE s.ticket_number = ?
        `).get(ticket_number);

        if (!sale) {
            return res.status(404).json({ success: false, message: 'Ticket no encontrado.' });
        }

        const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);

        res.json({ success: true, sale, items });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al recuperar ticket.' });
    }
}

module.exports = {
    searchProducts,
    checkout,
    voidTicket,
    getTicketDetails
};
