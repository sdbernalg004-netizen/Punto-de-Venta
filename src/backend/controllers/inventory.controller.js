/**
 * CONTROLADOR DE GESTIÓN DE INVENTARIOS Y TRANSFERENCIAS INTER-SUCURSALES
 */

const { db } = require('../config/database');

/**
 * Consulta de Inventario de la Sucursal con Alertas de Stock Bajo y Visibilidad Global para el Dueño
 */
function getInventory(req, res) {
    try {
        const branchId = req.targetBranchId;
        const isAdmin = req.user.role === 'ADMIN';
        const { low_stock_only, category_id, search } = req.query;

        let sql = '';
        const params = [];

        if (isAdmin && !branchId) {
            // El Dueño ve el desglose de stock por cada sucursal y el stock total global
            sql = `
                SELECT p.id as product_id, p.sku, p.barcode, p.name as product_name, p.unit_type, p.cost_price, p.sale_price, p.is_weighted,
                       c.name as category_name,
                       COALESCE(SUM(i.stock_quantity), 0) as stock_quantity,
                       COALESCE(MAX(CASE WHEN b.code = 'SUC-CENTRO' THEN i.stock_quantity END), 0) as stock_centro,
                       COALESCE(MAX(CASE WHEN b.code = 'SUC-NORTE' THEN i.stock_quantity END), 0) as stock_norte,
                       10 as min_stock_alert
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                LEFT JOIN inventory i ON p.id = i.product_id
                LEFT JOIN branches b ON i.branch_id = b.id
                WHERE p.is_active = 1
            `;
        } else {
            sql = `
                SELECT p.id as product_id, p.sku, p.barcode, p.name as product_name, p.unit_type, p.cost_price, p.sale_price, p.is_weighted,
                       c.name as category_name, COALESCE(i.stock_quantity, 0) as stock_quantity, COALESCE(i.min_stock_alert, 10) as min_stock_alert
                FROM products p
                LEFT JOIN categories c ON p.category_id = c.id
                LEFT JOIN inventory i ON p.id = i.product_id AND i.branch_id = ?
                WHERE p.is_active = 1
            `;
            params.push(branchId);
        }

        if (category_id) {
            sql += ` AND p.category_id = ?`;
            params.push(category_id);
        }
        if (search) {
            sql += ` AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ?)`;
            params.push(`%${search}%`, `%${search}%`, search);
        }

        if (isAdmin && !branchId) {
            sql += ` GROUP BY p.id`;
        }

        if (low_stock_only === 'true') {
            sql += ` HAVING stock_quantity <= 10`;
        }

        sql += ` ORDER BY p.name ASC`;

        const inventory = db.prepare(sql).all(...params);

        // Obtener Lotes próximos a vencer (FEFO)
        let expiringSql = `
            SELECT pb.*, p.name as product_name 
            FROM product_batches pb
            JOIN products p ON pb.product_id = p.id
            WHERE pb.current_quantity > 0 AND pb.expiration_date <= date('now', '+30 days')
        `;
        const expiringParams = [];
        if (branchId) {
            expiringSql += ` AND pb.branch_id = ?`;
            expiringParams.push(branchId);
        }
        expiringSql += ` ORDER BY pb.expiration_date ASC`;

        const expiringBatches = db.prepare(expiringSql).all(...expiringParams);

        // Obtener lista de sucursales para transferencias
        const branches = db.prepare('SELECT id, code, name FROM branches').all();

        res.json({ success: true, inventory, expiringBatches, branches });
    } catch (error) {
        console.error('Error al obtener inventario:', error);
        res.status(500).json({ success: false, message: 'Error interno al consultar inventario.' });
    }
}

/**
 * Ajuste Manual de Inventario (Requiere PIN de Gerente / Administrador)
 */
function updateStock(req, res) {
    try {
        const { product_id, branch_id, new_quantity, reason } = req.body;
        const managerUser = req.approvedByManager;
        const targetBranch = branch_id || req.user.branch_id;

        if (!product_id || !targetBranch || new_quantity === undefined || !reason) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos (producto, sucursal, cantidad, motivo).' });
        }

        const prevInv = db.prepare('SELECT stock_quantity FROM inventory WHERE branch_id = ? AND product_id = ?').get(targetBranch, product_id);
        const oldQty = prevInv ? prevInv.stock_quantity : 0;

        db.prepare(`
            INSERT INTO inventory (branch_id, product_id, stock_quantity)
            VALUES (?, ?, ?)
            ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_quantity = ?, updated_at = CURRENT_TIMESTAMP
        `).run(targetBranch, product_id, new_quantity, new_quantity);

        // Registrar en Auditoría Anti-Fraude
        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            targetBranch, managerUser.id, 'INVENTORY_ADJUSTMENT', 
            `Ajuste manual de producto ID ${product_id}. Cantidad previa: ${oldQty}, Nueva: ${new_quantity}. Motivo: ${reason}`
        );

        if (req.app.get('broadcastWS')) {
            req.app.get('broadcastWS')({ type: 'INVENTORY_UPDATED', product_id });
        }

        res.json({ success: true, message: 'Stock actualizado con éxito.' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al ajustar inventario.' });
    }
}

/**
 * Cambiar Precio de un Producto en Tiempo Real (Requiere PIN de Gerente / Dueño)
 */
function updatePrice(req, res) {
    try {
        const { product_id, new_cost_price, new_sale_price } = req.body;
        const managerUser = req.approvedByManager || req.user;

        if (!product_id || new_sale_price === undefined) {
            return res.status(400).json({ success: false, message: 'Producto y nuevo precio de venta requeridos.' });
        }

        const oldProduct = db.prepare('SELECT name, cost_price, sale_price FROM products WHERE id = ?').get(product_id);
        if (!oldProduct) return res.status(404).json({ success: false, message: 'Producto no encontrado.' });

        const costToSet = new_cost_price !== undefined ? parseFloat(new_cost_price) : oldProduct.cost_price;
        const saleToSet = parseFloat(new_sale_price);

        db.prepare('UPDATE products SET cost_price = ?, sale_price = ? WHERE id = ?')
            .run(costToSet, saleToSet, product_id);

        // Bitácora de Auditoría
        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            req.user.branch_id || null, managerUser.id, 'PRICE_CHANGED',
            `Precio modificado para "${oldProduct.name}". Venta previa: $${oldProduct.sale_price}, Nuevo: $${saleToSet}`
        );

        // Notificar en tiempo real a todas las cajas/POS conectados por WebSockets
        if (req.app.get('broadcastWS')) {
            req.app.get('broadcastWS')({ type: 'INVENTORY_UPDATED', product_id, new_sale_price: saleToSet });
        }

        res.json({ success: true, message: `Precio de "${oldProduct.name}" actualizado a $${saleToSet.toFixed(2)} en tiempo real.` });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al actualizar precio.' });
    }
}

/**
 * Registrar un nuevo Producto en el Catálogo Maestro
 */
function addProduct(req, res) {
    try {
        const { sku, barcode, name, category_id, unit_type, cost_price, sale_price, is_weighted, quick_key } = req.body;

        if (!sku || !name || !category_id || !sale_price) {
            return res.status(400).json({ success: false, message: 'Campos requeridos faltantes.' });
        }

        const stmt = db.prepare(`
            INSERT INTO products (sku, barcode, name, category_id, unit_type, cost_price, sale_price, is_weighted, quick_key)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const result = stmt.run(sku, barcode || null, name, category_id, unit_type || 'piece', cost_price || 0, sale_price, is_weighted ? 1 : 0, quick_key ? 1 : 0);

        // Crear registro inicial de inventario 0 en todas las sucursales
        const branches = db.prepare('SELECT id FROM branches').all();
        const insertInv = db.prepare('INSERT INTO inventory (branch_id, product_id, stock_quantity) VALUES (?, ?, 0)');
        branches.forEach(b => insertInv.run(b.id, result.lastInsertRowid));

        res.json({ success: true, message: 'Producto agregado al catálogo maestro.', product_id: result.lastInsertRowid });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message.includes('UNIQUE') ? 'El SKU o Código de Barras ya existe.' : error.message });
    }
}

/**
 * Crear Transferencia Inter-Sucursales
 */
function createStockTransfer(req, res) {
    try {
        const { from_branch_id, to_branch_id, items, notes } = req.body;
        const originBranchId = from_branch_id || req.user.branch_id;
        const userId = req.user.id;

        if (!originBranchId || originBranchId == to_branch_id) {
            return res.status(400).json({ success: false, message: 'Sucursal de origen y destino deben ser distintas.' });
        }

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'Seleccione al menos un producto a transferir.' });
        }

        const transferCode = `TRF-${Date.now()}`;

        const transferTx = db.transaction(() => {
            const trfStmt = db.prepare(`
                INSERT INTO stock_transfers (transfer_code, from_branch_id, to_branch_id, requested_by, status, notes)
                VALUES (?, ?, ?, ?, 'IN_TRANSIT', ?)
            `);
            const trfRes = trfStmt.run(transferCode, originBranchId, to_branch_id, userId, notes || '');

            const insertItem = db.prepare('INSERT INTO stock_transfer_items (transfer_id, product_id, quantity_sent) VALUES (?, ?, ?)');
            const deductOrigin = db.prepare('UPDATE inventory SET stock_quantity = stock_quantity - ? WHERE branch_id = ? AND product_id = ?');

            for (const item of items) {
                insertItem.run(trfRes.lastInsertRowid, item.product_id, item.quantity);
                deductOrigin.run(item.quantity, originBranchId, item.product_id);
            }

            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                originBranchId, userId, 'STOCK_TRANSFER_SENT', `Transferencia ${transferCode} enviada a Sucursal ID ${to_branch_id}`
            );

            return transferCode;
        });

        const code = transferTx();

        if (req.app.get('broadcastWS')) {
            req.app.get('broadcastWS')({ type: 'INVENTORY_UPDATED' });
        }

        res.json({ success: true, message: `Transferencia ${code} creada con éxito. Stock en tránsito hacia sucursal de destino.` });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

/**
 * Recepción y Confirmación de Transferencia Inter-Sucursales
 */
function receiveStockTransfer(req, res) {
    try {
        const { transfer_id } = req.body;
        const recipientUserId = req.user.id;
        const recipientBranchId = req.user.branch_id;

        const receiveTx = db.transaction(() => {
            const trf = db.prepare('SELECT * FROM stock_transfers WHERE id = ? AND status = "IN_TRANSIT"').get(transfer_id);
            if (!trf) throw new Error('Transferencia no encontrada o ya procesada.');

            if (trf.to_branch_id !== recipientBranchId && req.user.role !== 'ADMIN') {
                throw new Error('Solo el personal de la sucursal de destino puede recibir esta mercancía.');
            }

            const items = db.prepare('SELECT * FROM stock_transfer_items WHERE transfer_id = ?').all(transfer_id);
            const addDest = db.prepare(`
                INSERT INTO inventory (branch_id, product_id, stock_quantity) VALUES (?, ?, ?)
                ON CONFLICT(branch_id, product_id) DO UPDATE SET stock_quantity = stock_quantity + ?
            `);

            for (const item of items) {
                addDest.run(trf.to_branch_id, item.product_id, item.quantity_sent, item.quantity_sent);
            }

            db.prepare('UPDATE stock_transfers SET status = "COMPLETED", approved_by = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?')
                .run(recipientUserId, transfer_id);

            db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                trf.to_branch_id, recipientUserId, 'STOCK_TRANSFER_RECEIVED', `Transferencia ${trf.transfer_code} recibida con éxito.`
            );

            return trf.transfer_code;
        });

        const code = receiveTx();

        if (req.app.get('broadcastWS')) {
            req.app.get('broadcastWS')({ type: 'INVENTORY_UPDATED' });
        }

        res.json({ success: true, message: `Transferencia ${code} completada. Inventario ingresado a la sucursal.` });

    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
}

module.exports = {
    getInventory,
    updateStock,
    updatePrice,
    addProduct,
    createStockTransfer,
    receiveStockTransfer
};
