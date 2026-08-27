-- ESQUEMA DE BASE DE DATOS PARA SISTEMA POS MULTISUCURSAL
-- Compatible con SQLite3 y PostgreSQL

-- 1. Sucursales (Aislamiento Multi-Inquilino)
CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    address TEXT,
    phone VARCHAR(20),
    max_cash_drawer_limit REAL DEFAULT 3000.0, -- Umbral para sangrías obligatorias de caja
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Usuarios y Permisos RBAC + PIN Anti-Fraude
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'CASHIER')),
    pin_hash VARCHAR(255), -- Hash del PIN de 4 dígitos para autorizaciones rápidas
    branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
    can_add_products INTEGER DEFAULT 0, -- 1 si tiene permiso especial para registrar productos
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Categorías de Productos (Dulcería, Desechables, Mascotas, Materias Primas)
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(50) NOT NULL,
    icon VARCHAR(30) DEFAULT 'box',
    description TEXT
);

-- 4. Catálogo Maestro de Productos
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sku VARCHAR(50) UNIQUE NOT NULL,
    barcode VARCHAR(100) UNIQUE,
    name VARCHAR(150) NOT NULL,
    category_id INTEGER REFERENCES categories(id),
    unit_type VARCHAR(20) NOT NULL CHECK (unit_type IN ('piece', 'kg', 'gram', 'box', 'liter')),
    cost_price REAL NOT NULL DEFAULT 0.0,
    sale_price REAL NOT NULL DEFAULT 0.0,
    is_weighted INTEGER DEFAULT 0, -- 1 si requiere peso (ej. alimento granel)
    is_combo INTEGER DEFAULT 0,    -- 1 si es un paquete/kit armado
    quick_key INTEGER DEFAULT 0,   -- 1 si se muestra en el grid de cobro rápido
    image_url TEXT,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 5. Inventario por Sucursal
CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    stock_quantity REAL NOT NULL DEFAULT 0.0,
    min_stock_alert REAL NOT NULL DEFAULT 10.0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(branch_id, product_id)
);

-- 6. Lotes y Fechas de Caducidad (FEFO - First Expired, First Out)
CREATE TABLE IF NOT EXISTS product_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    branch_id INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
    batch_number VARCHAR(50) NOT NULL,
    expiration_date DATE NOT NULL,
    initial_quantity REAL NOT NULL,
    current_quantity REAL NOT NULL,
    received_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Turnos de Caja (Arqueo a Ciegas y Control de Efectivo)
CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    cashier_id INTEGER NOT NULL REFERENCES users(id),
    opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at DATETIME,
    initial_cash REAL NOT NULL DEFAULT 0.0,
    blind_cash_counted REAL, -- Dinero que contó físicamente el cajero sin ver el sistema
    expected_cash REAL,     -- Dinero teórico calculated por el sistema
    discrepancy REAL,         -- Diferencia (Faltante / Sobrante)
    status VARCHAR(20) DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    notes TEXT
);

-- 8. Movimientos de Caja en Turno (Sangrías, Retiros y Gastos)
CREATE TABLE IF NOT EXISTS shift_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    shift_id INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('DROP', 'EXPENSE', 'DEPOSIT')),
    amount REAL NOT NULL,
    reason TEXT NOT NULL,
    witness_user_id INTEGER REFERENCES users(id), -- Gerente que atestigua el retiro
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 9. Clientes, Programa de Puntos/Fidelización y Crédito
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(100),
    credit_limit REAL DEFAULT 0.0,
    current_balance REAL DEFAULT 0.0,
    points_balance INTEGER DEFAULT 0, -- Puntos acumulados por compras
    last_purchase_date DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 10. Ventas (Tickets con Encadenamiento Hash SHA-256 Anti-Borrado)
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_number VARCHAR(50) UNIQUE NOT NULL,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    shift_id INTEGER NOT NULL REFERENCES shifts(id),
    cashier_id INTEGER NOT NULL REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    subtotal REAL NOT NULL,
    discount_amount REAL DEFAULT 0.0,
    points_redeemed INTEGER DEFAULT 0,
    tax_amount REAL DEFAULT 0.0,
    total_amount REAL NOT NULL,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('CASH', 'CARD', 'MIXED', 'CREDIT')),
    cash_received REAL DEFAULT 0.0,
    change_given REAL DEFAULT 0.0,
    previous_hash VARCHAR(64) DEFAULT 'GENESIS_HASH',
    ticket_hash VARCHAR(64) NOT NULL, -- SHA-256 (ticket_number + total + created_at + previous_hash)
    status VARCHAR(20) DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED', 'VOIDED')),
    void_approved_by INTEGER REFERENCES users(id),
    void_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 11. Detalle de Artículos Vendidos por Ticket
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name VARCHAR(150) NOT NULL,
    unit_price REAL NOT NULL,
    quantity REAL NOT NULL,
    subtotal REAL NOT NULL,
    batch_id INTEGER REFERENCES product_batches(id)
);

-- 12. Transferencias de Inventario Inter-Sucursales
CREATE TABLE IF NOT EXISTS stock_transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_code VARCHAR(50) UNIQUE NOT NULL,
    from_branch_id INTEGER NOT NULL REFERENCES branches(id),
    to_branch_id INTEGER NOT NULL REFERENCES branches(id),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    approved_by INTEGER REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_TRANSIT', 'COMPLETED', 'REJECTED')),
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity_sent REAL NOT NULL,
    quantity_received REAL
);

-- 13. Bitácora Inmutable de Auditoría
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER REFERENCES branches(id),
    user_id INTEGER REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    details TEXT,
    ip_address VARCHAR(45),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 14. Alertas de Fraude y Anomalías Detectadas
CREATE TABLE IF NOT EXISTS fraud_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) DEFAULT 'MEDIUM' CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT NOT NULL,
    resolved INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ================= MÓDULOS AVANZADOS ESPECIALIZADOS =================

-- 15. Combos / Kits / Bundles (Desglose automático de stock)
CREATE TABLE IF NOT EXISTS product_combos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    combo_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    item_product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity REAL NOT NULL DEFAULT 1.0
);

-- 16. Precios por Volumen / Mayoreo y Menudeo (Tiered Pricing)
CREATE TABLE IF NOT EXISTS product_tiered_prices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    min_quantity REAL NOT NULL,
    max_quantity REAL,
    tiered_price REAL NOT NULL
);

-- 17. Proveedores y Órdenes de Compra Automáticas
CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    contact_name VARCHAR(100),
    phone VARCHAR(20),
    email VARCHAR(100),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_code VARCHAR(50) UNIQUE NOT NULL,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    branch_id INTEGER NOT NULL REFERENCES branches(id),
    status VARCHAR(20) DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SENT', 'RECEIVED')),
    total_cost REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    received_at DATETIME
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity REAL NOT NULL,
    unit_cost REAL NOT NULL
);
