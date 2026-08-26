/**
 * CONTROLADOR DE ANALÍTICA AVANZADA, INTELIGENCIA DE INVERSIÓN Y AUDITORÍA ANTI-FRAUDE
 */

const { db } = require('../config/database');

/**
 * Resumen General del Negocio (Dashboard Multi-Sucursal para el Dueño)
 */
function getDashboardOverview(req, res) {
    try {
        const { branch_id, time_range } = req.query;

        let branchFilter = '';
        const params = [];
        if (branch_id) {
            branchFilter = 'WHERE branch_id = ?';
            params.push(branch_id);
        }

        // 1. Métricas Globales de Ventas
        const salesToday = db.prepare(`
            SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(id) as tickets_count
            FROM sales
            WHERE status = 'COMPLETED' ${branch_id ? 'AND branch_id = ?' : ''} AND date(created_at) = date('now')
        `).get(...(branch_id ? [branch_id] : []));

        const salesMonth = db.prepare(`
            SELECT COALESCE(SUM(total_amount), 0) as total, COUNT(id) as tickets_count
            FROM sales
            WHERE status = 'COMPLETED' ${branch_id ? 'AND branch_id = ?' : ''} AND strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
        `).get(...(branch_id ? [branch_id] : []));

        // 2. Comparativa de Ventas por Sucursal
        const branchSales = db.prepare(`
            SELECT b.id, b.name, b.code, COALESCE(SUM(s.total_amount), 0) as total_sales, COUNT(s.id) as ticket_count
            FROM branches b
            LEFT JOIN sales s ON b.id = s.branch_id AND s.status = 'COMPLETED'
            GROUP BY b.id
        `).all();

        // 3. Ventas por Categoría (Dulcería vs Desechables vs Mascotas vs Materias Primas)
        const categorySales = db.prepare(`
            SELECT c.name as category_name, c.icon, COALESCE(SUM(si.subtotal), 0) as total_sales
            FROM categories c
            JOIN products p ON c.id = p.category_id
            JOIN sale_items si ON p.id = si.product_id
            JOIN sales s ON si.sale_id = s.id AND s.status = 'COMPLETED'
            ${branch_id ? 'WHERE s.branch_id = ?' : ''}
            GROUP BY c.id
            ORDER BY total_sales DESC
        `).all(...(branch_id ? [branch_id] : []));

        // 4. Productos Estrella (Top Sellers)
        const topProducts = db.prepare(`
            SELECT p.name, p.unit_type, SUM(si.quantity) as total_qty, SUM(si.subtotal) as total_revenue
            FROM sale_items si
            JOIN products p ON si.product_id = p.id
            JOIN sales s ON si.sale_id = s.id AND s.status = 'COMPLETED'
            ${branch_id ? 'WHERE s.branch_id = ?' : ''}
            GROUP BY p.id
            ORDER BY total_revenue DESC LIMIT 5
        `).all(...(branch_id ? [branch_id] : []));

        // 5. Ventas Desglosadas por Cajero
        const cashierSales = db.prepare(`
            SELECT u.id, u.full_name, u.role, COALESCE(b.name, 'Sin Sucursal') as branch_name, 
                   COALESCE(SUM(s.total_amount), 0) as total_sales, 
                   COUNT(s.id) as ticket_count
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN sales s ON u.id = s.cashier_id AND s.status = 'COMPLETED'
            WHERE u.role IN ('CASHIER', 'MANAGER') ${branch_id ? 'AND u.branch_id = ?' : ''}
            GROUP BY u.id
            ORDER BY total_sales DESC
        `).all(...(branch_id ? [branch_id] : []));

        // 6. Resumen de Alertas Anti-Fraude Activas
        const activeFraudAlerts = db.prepare(`
            SELECT fa.*, b.name as branch_name, u.full_name as cashier_name
            FROM fraud_alerts fa
            JOIN branches b ON fa.branch_id = b.id
            JOIN users u ON fa.user_id = u.id
            WHERE fa.resolved = 0
            ORDER BY fa.created_at DESC LIMIT 10
        `).all();

        res.json({
            success: true,
            overview: {
                sales_today: salesToday,
                sales_month: salesMonth,
                branch_sales: branchSales,
                category_sales: categorySales,
                top_products: topProducts,
                cashier_sales: cashierSales,
                fraud_alerts: activeFraudAlerts
            }
        });
    } catch (error) {
        console.error('Error en Dashboard Analytics:', error);
        res.status(500).json({ success: false, message: 'Error interno al consultar analíticas.' });
    }
}

/**
 * Inteligencia de Inversión y Sugerencias de Reabastecimiento
 * Analiza la velocidad de venta para calcular días de inventario restante y retorno de inversión.
 */
function getReorderSuggestions(req, res) {
    try {
        const { branch_id } = req.query;

        // Calcular ventas promedio por día en los últimos 30 días
        const sql = `
            SELECT 
                p.id as product_id, p.name as product_name, p.sku, p.unit_type, p.cost_price, p.sale_price,
                c.name as category_name, b.name as branch_name, b.id as branch_id,
                COALESCE(i.stock_quantity, 0) as current_stock,
                COALESCE(i.min_stock_alert, 10) as min_stock_alert,
                COALESCE(sales_30d.total_qty_sold, 0) as sold_30d,
                ROUND(COALESCE(sales_30d.total_qty_sold, 0) / 30.0, 2) as daily_velocity
            FROM products p
            CROSS JOIN branches b
            LEFT JOIN categories c ON p.category_id = c.id
            LEFT JOIN inventory i ON p.id = i.product_id AND i.branch_id = b.id
            LEFT JOIN (
                SELECT si.product_id, s.branch_id, SUM(si.quantity) as total_qty_sold
                FROM sale_items si
                JOIN sales s ON si.sale_id = s.id
                WHERE s.status = 'COMPLETED' AND s.created_at >= date('now', '-30 days')
                GROUP BY si.product_id, s.branch_id
            ) sales_30d ON p.id = sales_30d.product_id AND b.id = sales_30d.branch_id
            WHERE p.is_active = 1 ${branch_id ? 'AND b.id = ?' : ''}
            ORDER BY daily_velocity DESC, current_stock ASC
        `;

        const params = branch_id ? [branch_id] : [];
        const rawResults = db.prepare(sql).all(...params);

        const reorderSuggestions = rawResults.map(item => {
            const daysLeft = item.daily_velocity > 0 ? Math.round(item.current_stock / item.daily_velocity) : 999;
            const suggestedReorderQty = Math.max(0, Math.ceil((item.daily_velocity * 15) - item.current_stock)); // Surtir para 15 días
            const estimatedCost = Math.round(suggestedReorderQty * item.cost_price);
            const estimatedRevenue = Math.round(suggestedReorderQty * item.sale_price);
            const estimatedProfit = estimatedRevenue - estimatedCost;

            return {
                ...item,
                days_left: daysLeft,
                suggested_reorder_qty: suggestedReorderQty,
                estimated_cost: estimatedCost,
                estimated_profit: estimatedProfit,
                urgency: daysLeft <= 3 ? 'CRITICAL' : (daysLeft <= 7 ? 'HIGH' : 'NORMAL')
            };
        }).filter(item => item.suggested_reorder_qty > 0 || item.days_left <= 7);

        res.json({ success: true, reorder_suggestions: reorderSuggestions });
    } catch (error) {
        console.error('Error en Reorder Suggestions:', error);
        res.status(500).json({ success: false, message: 'Error al calcular proyecciones de inversión.' });
    }
}

/**
 * Reporte de Auditoría Anti-Fraude
 */
function getFraudAuditTrail(req, res) {
    try {
        const logs = db.prepare(`
            SELECT al.*, u.full_name as user_name, u.username, b.name as branch_name
            FROM audit_logs al
            LEFT JOIN users u ON al.user_id = u.id
            LEFT JOIN branches b ON al.branch_id = b.id
            ORDER BY al.created_at DESC LIMIT 50
        `).all();

        const alerts = db.prepare(`
            SELECT fa.*, u.full_name as user_name, b.name as branch_name
            FROM fraud_alerts fa
            LEFT JOIN users u ON fa.user_id = u.id
            LEFT JOIN branches b ON fa.branch_id = b.id
            ORDER BY fa.created_at DESC LIMIT 50
        `).all();

        const shiftDiscrepancies = db.prepare(`
            SELECT s.*, u.full_name as cashier_name, b.name as branch_name
            FROM shifts s
            JOIN users u ON s.cashier_id = u.id
            JOIN branches b ON s.branch_id = b.id
            WHERE s.discrepancy IS NOT NULL AND ABS(s.discrepancy) > 5.0
            ORDER BY s.closed_at DESC LIMIT 30
        `).all();

        res.json({ success: true, logs, alerts, shiftDiscrepancies });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al obtener bitácora de auditoría.' });
    }
}

module.exports = {
    getDashboardOverview,
    getReorderSuggestions,
    getFraudAuditTrail
};
