/**
 * CONFIGURACIÓN DE BASE DE DATOS E INTEGRIDAD ACID
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbFolder = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, '../../../');
const dbPath = process.env.DATABASE_FILE || path.join(dbFolder, 'pos_database.db');
const schemaPath = path.join(__dirname, '../models/schema.sql');

// Abrir la base de datos SQLite
const db = new Database(dbPath, { verbose: null });

// Activar Pragma de Claves Foráneas (Foreign Keys) y Modo WAL (Write-Ahead Logging) para concurrencia
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// Inicializar esquemas e insertar datos semilla
function initDatabase() {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    db.exec(schemaSql);

    const comboCount = db.prepare('SELECT COUNT(*) as count FROM product_combos').get().count;
    if (comboCount === 0) {
        seedInitialData();
    }
}

function seedInitialData() {
    console.log('🌱 Sembrando datos iniciales de demostración en la Base de Datos...');

    const salt = bcrypt.genSaltSync(10);
    const adminPassHash = bcrypt.hashSync('admin123', salt);
    const cashierPassHash = bcrypt.hashSync('cajero123', salt);
    const pinHash = bcrypt.hashSync('1234', salt); // PIN anti-fraude '1234'

    const insertBranch = db.prepare('INSERT INTO branches (code, name, address, phone, max_cash_drawer_limit) VALUES (?, ?, ?, ?, ?)');
    const b1 = insertBranch.run('SUC-CENTRO', 'Sucursal Centro (Dulcería & Mascotas)', 'Av. Hidalgo #102, Centro', '555-0101', 3000.0);
    const b2 = insertBranch.run('SUC-NORTE', 'Sucursal Norte (Materias Primas & Desechables)', 'Blvd. Norte #504', '555-0202', 4000.0);

    const insertUser = db.prepare('INSERT INTO users (username, password_hash, full_name, role, pin_hash, branch_id) VALUES (?, ?, ?, ?, ?, ?)');
    insertUser.run('dueno', adminPassHash, 'Carlos Mendoza (Dueño)', 'ADMIN', pinHash, null);
    insertUser.run('gerente_centro', adminPassHash, 'Ana López (Gerente Centro)', 'MANAGER', pinHash, b1.lastInsertRowid);
    insertUser.run('cajero_centro', cashierPassHash, 'Pedro Ramírez (Cajero)', 'CASHIER', pinHash, b1.lastInsertRowid);
    insertUser.run('cajero_norte', cashierPassHash, 'Sofía Torres (Cajera)', 'CASHIER', pinHash, b2.lastInsertRowid);

    // Categorías
    const insertCat = db.prepare('INSERT INTO categories (name, icon, description) VALUES (?, ?, ?)');
    const cDulces = insertCat.run('Dulcería & Gominolas', 'candy-cane', 'Chicles, chocolates, paletas y gomitas').lastInsertRowid;
    const cDesechables = insertCat.run('Desechables & Empaques', 'box-open', 'Vasos, platos, bolsas y recipientes').lastInsertRowid;
    const cMascotas = insertCat.run('Alimento para Mascotas', 'dog', 'Croquetas por kilo, sobres y premios').lastInsertRowid;
    const cMateriasPrimas = insertCat.run('Materias Primas', 'wheat-awn', 'Harinas, azúcares, esencias y coberturas').lastInsertRowid;

    // Productos individuales
    const insertProd = db.prepare('INSERT INTO products (sku, barcode, name, category_id, unit_type, cost_price, sale_price, is_weighted, is_combo, quick_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    
    const p1 = insertProd.run('DUL-001', '750100000001', 'Paleta Tutsi Pop Pkt 20 pzs', cDulces, 'piece', 45.0, 65.0, 0, 0, 1).lastInsertRowid;
    const p2 = insertProd.run('DUL-002', '750100000002', 'Gomitas Panditas 1kg', cDulces, 'kg', 70.0, 110.0, 1, 0, 1).lastInsertRowid;
    const p3 = insertProd.run('DES-001', '750100000003', 'Vaso Térmico #12 Paq 50 pzs', cDesechables, 'piece', 32.0, 50.0, 0, 0, 1).lastInsertRowid;
    const p4 = insertProd.run('DES-002', '750100000004', 'Bolsa Camiseta 30x60 1kg', cDesechables, 'kg', 38.0, 58.0, 1, 0, 0).lastInsertRowid;
    const p5 = insertProd.run('MAS-001', '750100000005', 'Croqueta Perro Adulto (Granel)', cMascotas, 'kg', 28.0, 48.0, 1, 0, 1).lastInsertRowid;
    const p6 = insertProd.run('MAS-002', '750100000006', 'Sobres Alimento Gato Whiskas 85g', cMascotas, 'piece', 9.0, 14.5, 0, 0, 1).lastInsertRowid;
    const p7 = insertProd.run('MAT-001', '750100000007', 'Harina de Trigo Selecta 1kg', cMateriasPrimas, 'piece', 16.0, 24.0, 0, 0, 0).lastInsertRowid;
    const p8 = insertProd.run('MAT-002', '750100000008', 'Cobertura Chocolate Obscuro (Granel)', cMateriasPrimas, 'kg', 65.0, 105.0, 1, 0, 1).lastInsertRowid;

    // MÓDULO 1: Producto Combo / Kit Fiesta Armado
    const combo1 = insertProd.run('KIT-FIESTA-01', '750100000099', '🎉 Super Kit Fiesta Infantil (Dulces + Vasos)', cDulces, 'piece', 130.0, 199.0, 0, 1, 1).lastInsertRowid;
    
    // Componentes del Combo 1 (Kit contiene 1x Tutsi Pop + 1x Gomitas + 1x Vasos)
    const insertComboItem = db.prepare('INSERT INTO product_combos (combo_product_id, item_product_id, quantity) VALUES (?, ?, ?)');
    insertComboItem.run(combo1, p1, 1.0);
    insertComboItem.run(combo1, p2, 0.5); // 500g gomitas
    insertComboItem.run(combo1, p3, 1.0);

    // MÓDULO 2: Precios por Volumen / Mayoreo para Vasos Térmicos (p3)
    const insertTier = db.prepare('INSERT INTO product_tiered_prices (product_id, min_quantity, max_quantity, tiered_price) VALUES (?, ?, ?, ?)');
    insertTier.run(p3, 1, 5, 50.0);   // Menudeo
    insertTier.run(p3, 6, 19, 42.0);  // Medio Mayoreo
    insertTier.run(p3, 20, 999, 35.0); // Mayoreo Total

    // MÓDULO 3: Proveedores Demo
    const insertSup = db.prepare('INSERT INTO suppliers (name, contact_name, phone, email) VALUES (?, ?, ?, ?)');
    insertSup.run('Reyma Desechables S.A.', 'Jorge Ramos', '555-3344', 'ventas@reyma.com');
    insertSup.run('Dulces Vero México', 'María González', '555-5566', 'contacto@vero.com');
    insertSup.run('Purina PetCare', 'Carlos Ruíz', '555-7788', 'distribucion@purina.com');

    // Asignar Inventarios Iniciales por Sucursal
    const insertInv = db.prepare('INSERT INTO inventory (branch_id, product_id, stock_quantity, min_stock_alert) VALUES (?, ?, ?, ?)');
    [p1, p2, p3, p4, p5, p6, p7, p8, combo1].forEach(prodId => {
        insertInv.run(b1.lastInsertRowid, prodId, Math.floor(Math.random() * 80) + 20, 10);
        insertInv.run(b2.lastInsertRowid, prodId, Math.floor(Math.random() * 80) + 20, 10);
    });

    // Lotes con caducidad (FEFO)
    const insertBatch = db.prepare('INSERT INTO product_batches (product_id, branch_id, batch_number, expiration_date, initial_quantity, current_quantity) VALUES (?, ?, ?, ?, ?, ?)');
    insertBatch.run(p2, b1.lastInsertRowid, 'LOT-2026-A', '2026-11-15', 50.0, 50.0);
    insertBatch.run(p5, b1.lastInsertRowid, 'LOT-2026-B', '2026-12-01', 100.0, 100.0);

    // MÓDULO 5: Clientes con Puntos de Fidelidad
    db.prepare('INSERT INTO customers (name, phone, email, credit_limit, current_balance, points_balance, last_purchase_date) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        'Panadería El Sol', '555-9988', 'contacto@elsol.com', 2000.0, 350.0, 120, '2026-08-20'
    );
    db.prepare('INSERT INTO customers (name, phone, email, credit_limit, current_balance, points_balance, last_purchase_date) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        'Juan Pérez (Cliente Frecuente Mascotas)', '555-4422', 'juan@gmail.com', 500.0, 0.0, 240, '2026-07-28'
    );

    console.log('✅ Base de Datos sembrada con éxito con Módulos Avanzados (Combos, Mayoreo, Proveedores y Puntos).');
}

/**
 * Función para generar Hash Criptográfico Secuencial (SHA-256) por ticket
 */
function calculateTicketHash(ticketNumber, totalAmount, createdAt, previousHash = 'GENESIS_HASH') {
    const dataString = `${ticketNumber}|${totalAmount}|${createdAt}|${previousHash}`;
    return crypto.createHash('sha256').update(dataString).digest('hex');
}

initDatabase();

module.exports = {
    db,
    calculateTicketHash
};
