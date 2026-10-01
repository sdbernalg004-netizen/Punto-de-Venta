/**
 * CONTROLADOR DE PROMOCIONES AUTOMATIZADAS (2x1, 3x2, % DESCUENTOS Y DÍAS ESPECIALES)
 */

const { db } = require('../config/database');

function getActivePromotions(req, res) {
    try {
        const currentDay = new Date().getDay(); // 0 = Domingo, 1 = Lunes, 3 = Miércoles...

        const promotions = db.prepare(`
            SELECT p.*, prod.name as product_name, cat.name as category_name
            FROM promotions p
            LEFT JOIN products prod ON p.product_id = prod.id
            LEFT JOIN categories cat ON p.category_id = cat.id
            WHERE p.is_active = 1 AND (p.day_of_week IS NULL OR p.day_of_week = ?)
            ORDER BY p.id DESC
        `).all(currentDay);

        res.json({ success: true, promotions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al consultar promociones.' });
    }
}

function createPromotion(req, res) {
    try {
        const { name, promo_type, buy_qty, pay_qty, discount_percent, product_id, category_id, day_of_week } = req.body;

        if (!name || !promo_type) {
            return res.status(400).json({ success: false, message: 'Nombre y tipo de promoción son requeridos.' });
        }

        const stmt = db.prepare(`
            INSERT INTO promotions (name, promo_type, buy_qty, pay_qty, discount_percent, product_id, category_id, day_of_week, is_active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `);
        const result = stmt.run(
            name, promo_type, buy_qty || 1, pay_qty || 1, discount_percent || 0.0,
            product_id || null, category_id || null, day_of_week !== undefined && day_of_week !== '' ? day_of_week : null
        );

        res.json({ success: true, message: `Promoción "${name}" creada con éxito.`, promo_id: result.lastInsertRowid });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al crear promoción.' });
    }
}

module.exports = {
    getActivePromotions,
    createPromotion
};
