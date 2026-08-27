/**
 * LÓGICA DE GESTIÓN DE INVENTARIOS, CAMBIO DE PRECIOS, TRANSFERENCIAS Y ÓRDENES DE COMPRA
 */

let lastLoadedInventoryList = [];
let lastLoadedSuppliers = [];

async function loadInventory() {
    try {
        const search = document.getElementById('inv-search')?.value || '';
        const res = await apiFetch(`/api/inventory?search=${encodeURIComponent(search)}`);
        
        if (res.success) {
            lastLoadedInventoryList = res.inventory;
            lastLoadedSuppliers = res.suppliers || [];
            renderInventoryTable(res.inventory);
        }
    } catch (error) {
        console.error('Error al cargar inventario:', error);
    }
}

document.getElementById('inv-search')?.addEventListener('input', () => {
    loadInventory();
});

function renderInventoryTable(inventory) {
    const tbody = document.getElementById('inventory-table-body');
    const thead = document.getElementById('inventory-table-header');
    const isAdmin = STATE.user && STATE.user.role === 'ADMIN';

    if (thead) {
        if (isAdmin) {
            thead.innerHTML = `
                <th class="p-3">SKU / Barras</th>
                <th class="p-3">Producto</th>
                <th class="p-3">Categoría</th>
                <th class="p-3">Precio Costo</th>
                <th class="p-3">Precio Venta</th>
                <th class="p-3">Suc. Centro</th>
                <th class="p-3">Suc. Norte</th>
                <th class="p-3">Total Global</th>
                <th class="p-3 text-right">Acciones</th>
            `;
        } else {
            thead.innerHTML = `
                <th class="p-3">SKU / Barras</th>
                <th class="p-3">Producto</th>
                <th class="p-3">Categoría</th>
                <th class="p-3">Precio Costo</th>
                <th class="p-3">Precio Venta</th>
                <th class="p-3">Stock Sucursal</th>
                <th class="p-3 text-right">Acciones</th>
            `;
        }
    }

    if (inventory.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${isAdmin ? 9 : 7}" class="text-center py-6 text-gray-400">Sin registros de inventario.</td></tr>`;
        return;
    }

    tbody.innerHTML = inventory.map(item => {
        const isLowStock = item.stock_quantity <= (item.min_stock_alert || 10);
        const isCombo = item.is_combo === 1;

        const actionButtons = `
            <button onclick="openEditPriceModal(${item.product_id}, '${escapeQuote(item.product_name)}', ${item.cost_price}, ${item.sale_price})" 
                    class="px-2 py-1 bg-amber-500 text-slate-950 rounded-lg text-xs font-extrabold hover:bg-amber-400">
                🏷️ Precio
            </button>
            <button onclick="printBarcodeLabel('${item.sku}', '${escapeQuote(item.product_name)}', ${item.sale_price})" 
                    class="px-2 py-1 bg-cyan-700 text-white rounded-lg text-xs font-bold hover:bg-cyan-600">
                🖨️ Etiqueta
            </button>
            <button onclick="promptStockAdjustment(${item.product_id}, '${escapeQuote(item.product_name)}')" 
                    class="px-2 py-1 bg-slate-800 text-white rounded-lg text-xs font-bold hover:bg-slate-700">
                Ajustar
            </button>
        `;

        if (isAdmin) {
            return `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-mono text-xs font-bold text-gray-600">${item.sku}</td>
                    <td class="p-3 font-bold text-slate-800 flex items-center gap-2">
                        <span>${item.product_name}</span>
                        ${isCombo ? '<span class="bg-amber-500/20 text-amber-700 text-[10px] font-black px-1.5 py-0.5 rounded">COMBO</span>' : ''}
                    </td>
                    <td class="p-3 text-xs text-gray-500">${item.category_name || 'Sin Categoría'}</td>
                    <td class="p-3 text-gray-600 font-semibold">$${item.cost_price.toFixed(2)}</td>
                    <td class="p-3 text-amber-600 font-black">$${item.sale_price.toFixed(2)}</td>
                    <td class="p-3 font-bold text-slate-700">${item.stock_centro || 0} ${item.unit_type}</td>
                    <td class="p-3 font-bold text-slate-700">${item.stock_norte || 0} ${item.unit_type}</td>
                    <td class="p-3">
                        <span class="px-2.5 py-1 rounded-full text-xs font-black ${isLowStock ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-emerald-100 text-emerald-700'}">
                            ${item.stock_quantity} ${item.unit_type}
                        </span>
                    </td>
                    <td class="p-3 text-right space-x-1">${actionButtons}</td>
                </tr>
            `;
        } else {
            return `
                <tr class="hover:bg-gray-50">
                    <td class="p-3 font-mono text-xs font-bold text-gray-600">${item.sku}</td>
                    <td class="p-3 font-bold text-slate-800">${item.product_name}</td>
                    <td class="p-3 text-xs text-gray-500">${item.category_name || 'Sin Categoría'}</td>
                    <td class="p-3 text-gray-600 font-semibold">$${item.cost_price.toFixed(2)}</td>
                    <td class="p-3 text-amber-600 font-black">$${item.sale_price.toFixed(2)}</td>
                    <td class="p-3">
                        <span class="px-2.5 py-1 rounded-full text-xs font-black ${isLowStock ? 'bg-rose-100 text-rose-700 animate-pulse' : 'bg-emerald-100 text-emerald-700'}">
                            ${item.stock_quantity} ${item.unit_type}
                        </span>
                    </td>
                    <td class="p-3 text-right space-x-1">${actionButtons}</td>
                </tr>
            `;
        }
    }).join('');
}

function escapeQuote(str) {
    return str.replace(/'/g, "\\'");
}

// Generador e Impresor de Etiquetas con Código de Barras
function printBarcodeLabel(sku, name, price) {
    const printWindow = window.open('', '_blank', 'width=400,height=300');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Etiqueta de Código de Barras - ${sku}</title>
            <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"></script>
            <style>
                body { font-family: sans-serif; text-align: center; margin: 10px; }
                .label-card { border: 2px dashed #000; padding: 10px; border-radius: 8px; display: inline-block; }
                h3 { margin: 2px 0; font-size: 14px; }
                .price { font-size: 18px; font-weight: bold; color: #000; margin: 4px 0; }
            </style>
        </head>
        <body onload="window.print()">
            <div class="label-card">
                <h3>${name}</h3>
                <div class="price">$${price.toFixed(2)} MXN</div>
                <svg id="barcode"></svg>
            </div>
            <script>
                JsBarcode("#barcode", "${sku}", { format: "CODE128", width: 2, height: 40, displayValue: true });
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

// Modal Edición de Precios
function openEditPriceModal(productId, productName, costPrice, salePrice) {
    document.getElementById('edit-price-prod-id').value = productId;
    document.getElementById('edit-price-prod-name').innerText = productName;
    document.getElementById('edit-price-cost').value = costPrice;
    document.getElementById('edit-price-sale').value = salePrice;
    document.getElementById('modal-edit-price').classList.remove('hidden');
}

function closeEditPriceModal() {
    document.getElementById('modal-edit-price').classList.add('hidden');
}

async function handleSavePrice(e) {
    e.preventDefault();
    const productId = document.getElementById('edit-price-prod-id').value;
    const costPrice = parseFloat(document.getElementById('edit-price-cost').value);
    const salePrice = parseFloat(document.getElementById('edit-price-sale').value);

    try {
        const res = await apiFetch('/api/inventory/update-price', {
            method: 'POST',
            body: JSON.stringify({
                product_id: productId,
                new_cost_price: costPrice,
                new_sale_price: salePrice
            })
        });

        if (res.success) {
            alert('✅ Precio actualizado y transmitido en tiempo real.');
            closeEditPriceModal();
            loadInventory();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al cambiar precio.');
    }
}

// Modal Orden de Compra a Proveedores
function openAutoPOModal() {
    const select = document.getElementById('auto-po-supplier-select');
    if (select && lastLoadedSuppliers.length > 0) {
        select.innerHTML = lastLoadedSuppliers.map(s => `<option value="${s.id}">${s.name} (${s.contact_name})</option>`).join('');
    }
    document.getElementById('modal-auto-po').classList.remove('hidden');
}

function closeAutoPOModal() {
    document.getElementById('modal-auto-po').classList.add('hidden');
}

async function handleGenerateAutoPO(e) {
    e.preventDefault();
    const supplierId = document.getElementById('auto-po-supplier-select').value;

    try {
        const res = await apiFetch('/api/inventory/po/generate', {
            method: 'POST',
            body: JSON.stringify({ supplier_id: supplierId })
        });

        if (res.success) {
            alert(`✅ ${res.message}`);
            closeAutoPOModal();
            loadInventory();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al generar Orden de Compra.');
    }
}

// Modal Transferencia a Sucursal
function openTransferModal() {
    const prodSelect = document.getElementById('transfer-prod-id');
    if (lastLoadedInventoryList.length > 0) {
        prodSelect.innerHTML = lastLoadedInventoryList.map(p => `
            <option value="${p.product_id}">${p.product_name} (Stock: ${p.stock_quantity})</option>
        `).join('');
    }
    document.getElementById('modal-transfer').classList.remove('hidden');
}

function closeTransferModal() {
    document.getElementById('modal-transfer').classList.add('hidden');
}

async function handleSendTransfer(e) {
    e.preventDefault();
    const fromBranchId = parseInt(document.getElementById('transfer-from-branch').value);
    const toBranchId = parseInt(document.getElementById('transfer-to-branch').value);
    const productId = parseInt(document.getElementById('transfer-prod-id').value);
    const qty = parseFloat(document.getElementById('transfer-qty').value);
    const notes = document.getElementById('transfer-notes').value;

    if (fromBranchId === toBranchId) {
        alert('La sucursal de origen y destino deben ser distintas.');
        return;
    }

    try {
        const res = await apiFetch('/api/inventory/transfer/create', {
            method: 'POST',
            body: JSON.stringify({
                from_branch_id: fromBranchId,
                to_branch_id: toBranchId,
                items: [{ product_id: productId, quantity: qty }],
                notes
            })
        });

        if (res.success) {
            alert(`✅ ${res.message}`);
            closeTransferModal();
            loadInventory();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al transferir.');
    }
}

async function promptStockAdjustment(productId, productName) {
    const newQtyStr = prompt(`Ajuste Manual de Stock para "${productName}". Ingrese la nueva cantidad:`);
    if (newQtyStr === null) return;
    const newQty = parseFloat(newQtyStr);
    if (isNaN(newQty)) return;

    const reason = prompt('Indique el motivo del ajuste (ej. Conteo físico, Mermas, Dañado):', 'Conteo físico');
    if (!reason) return;

    try {
        const res = await apiFetch('/api/inventory/update-stock', {
            method: 'POST',
            body: JSON.stringify({
                product_id: productId,
                branch_id: STATE.user.branch_id,
                new_quantity: newQty,
                reason
            })
        });

        if (res.success) {
            alert('✅ Stock actualizado correctamente.');
            loadInventory();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al ajustar stock.');
    }
}
