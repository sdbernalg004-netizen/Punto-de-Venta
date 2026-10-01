/**
 * CONTROLADOR DE FACTURACIÓN ELECTRÓNICA SAT CFDI 4.0 Y AUTO-FACTURACIÓN POR QR
 */

const { db } = require('../config/database');

/**
 * Auto-Generación de Factura SAT CFDI 4.0 a partir del Folio de Ticket
 */
function generateInvoice(req, res) {
    try {
        const { ticket_number, rfc, business_name, tax_regime, postal_code, use_cfdi } = req.body;

        if (!ticket_number || !rfc || !business_name || !tax_regime || !postal_code || !use_cfdi) {
            return res.status(400).json({ success: false, message: 'Ingrese todos los datos fiscales (RFC, Razón Social, Régimen, CP, Uso CFDI).' });
        }

        const sale = db.prepare('SELECT id, total_amount, status FROM sales WHERE ticket_number = ?').get(ticket_number);
        if (!sale) {
            return res.status(404).json({ success: false, message: 'Folio de ticket no encontrado.' });
        }
        if (sale.status !== 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'El ticket especificado fue cancelado.' });
        }

        const existingInv = db.prepare('SELECT * FROM invoices WHERE sale_id = ?').get(sale.id);
        if (existingInv) {
            return res.status(400).json({ success: false, message: `El ticket ${ticket_number} ya fue facturado previamente (UUID: ${existingInv.uuid}).` });
        }

        const uuidMock = `SAT-CFDI40-${Date.now()}-${Math.floor(Math.random()*10000)}`;
        const pdfUrl = `/api/invoices/download/${uuidMock}.pdf`;
        const xmlUrl = `/api/invoices/download/${uuidMock}.xml`;

        const stmt = db.prepare(`
            INSERT INTO invoices (sale_id, rfc, business_name, tax_regime, postal_code, use_cfdi, uuid, pdf_url, xml_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'GENERATED')
        `);
        stmt.run(sale.id, rfc.toUpperCase().trim(), business_name.trim(), tax_regime, postal_code.trim(), use_cfdi, uuidMock, pdfUrl, xmlUrl);

        res.json({
            success: true,
            message: `¡Factura CFDI 4.0 generada exitosamente!`,
            invoice: {
                uuid: uuidMock,
                rfc: rfc.toUpperCase(),
                business_name,
                total: sale.total_amount,
                pdf_url: pdfUrl,
                xml_url: xmlUrl
            }
        });

    } catch (error) {
        console.error('Error al generar factura:', error);
        res.status(500).json({ success: false, message: 'Error al timbrar factura SAT.' });
    }
}

function getInvoiceByTicket(req, res) {
    try {
        const { ticket_number } = req.params;
        const sale = db.prepare('SELECT id, total_amount, ticket_number, created_at FROM sales WHERE ticket_number = ?').get(ticket_number);
        if (!sale) return res.status(404).json({ success: false, message: 'Ticket no encontrado.' });

        const invoice = db.prepare('SELECT * FROM invoices WHERE sale_id = ?').get(sale.id);
        res.json({ success: true, sale, invoice: invoice || null });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al consultar ticket.' });
    }
}

module.exports = {
    generateInvoice,
    getInvoiceByTicket
};
