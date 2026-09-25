/**
 * LÓGICA DEL PUNTO DE VENTA (POS), CARRITO, MAYOREO, COMBOS Y PUNTOS
 */

let posProductsList = [];
let customerList = [];
let barcodeBuffer = '';
let lastKeyTime = Date.now();

// Listener para Escáner de Código de Barras USB (Keyboard Wedge)
window.addEventListener('keydown', (e) => {
    if (document.activeElement.tagName === 'INPUT' && document.activeElement.id !== 'pos-search-input') {
        return;
    }

    const currentTime = Date.now();
    if (currentTime - lastKeyTime > 50) {
        barcodeBuffer = '';
    }
    lastKeyTime = currentTime;

    if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 3) {
            handleBarcodeScanned(barcodeBuffer);
            barcodeBuffer = '';
            e.preventDefault();
        }
    } else if (e.key.length === 1) {
        barcodeBuffer += e.key;
    }
});

async function loadPOSProducts(categoryId = null) {
    try {
        let url = '/api/pos/products';
        if (categoryId) url += `?category_id=${categoryId}`;

        const res = await apiFetch(url);
        if (res.success) {
            posProductsList = res.products;
            customerList = res.customers || [];
            renderPOSProductsGrid(posProductsList);
            renderCategoryPills();
            renderCustomerDropdown();
        }
    } catch (error) {
        console.error('Error al cargar productos:', error);
    }
}

function renderCustomerDropdown() {
    const select = document.getElementById('checkout-customer-select');
    if (!select) return;

    select.innerHTML = '<option value="">-- Cliente General --</option>' + customerList.map(c => `
        <option value="${c.id}">${c.name} (${c.points_balance || 0} Puntos | Bal: $${c.current_balance.toFixed(2)})</option>
    `).join('');
}

function renderCategoryPills() {
    const categories = [
        { id: null, name: 'Todos los Productos' },
        { id: 1, name: 'Dulcería' },
        { id: 2, name: 'Desechables' },
        { id: 3, name: 'Mascotas' },
        { id: 4, name: 'Materias Primas' }
    ];

    const container = document.getElementById('category-pills');
    container.innerHTML = categories.map(cat => `
        <button onclick="loadPOSProducts(${cat.id})" class="category-pill ${cat.id === null ? 'active' : ''}">
            ${cat.name}
        </button>
    `).join('');
}

function renderPOSProductsGrid(products) {
    const grid = document.getElementById('products-grid');
    if (products.length === 0) {
        grid.innerHTML = '<div class="col-span-full text-center py-12 text-gray-400">No se encontraron productos.</div>';
        return;
    }

    grid.innerHTML = products.map(p => {
        const isCombo = p.is_combo === 1;
        const hasMayoreo = p.tiers && p.tiers.length > 0;

        return `
            <div onclick="addToCart(${p.id})" class="product-card bg-white p-3 rounded-2xl border ${isCombo ? 'border-amber-400 bg-amber-50/30' : 'border-gray-200'} shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between h-36 relative">
                ${isCombo ? '<span class="absolute -top-2 -right-2 bg-amber-500 text-slate-950 text-[9px] font-black px-2 py-0.5 rounded-full shadow">COMBO / KIT</span>' : ''}
                ${hasMayoreo ? '<span class="absolute -top-2 -left-2 bg-emerald-600 text-white text-[9px] font-black px-1.5 py-0.5 rounded-full shadow">MAYOREO</span>' : ''}
                <div>
                    <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">${p.unit_type}</span>
                    <h4 class="font-bold text-xs text-slate-800 line-clamp-2 mt-1">${p.name}</h4>
                </div>
                <div>
                    <div class="text-[11px] text-gray-400 font-semibold">Stock: ${p.stock_quantity}</div>
                    <div class="text-base font-black text-amber-600">$${p.sale_price.toFixed(2)}</div>
                </div>
            </div>
        `;
    }).join('');
}

document.getElementById('pos-search-input')?.addEventListener('input', (e) => {
    const term = e.target.value.toLowerCase().trim();
    if (!term) {
        renderPOSProductsGrid(posProductsList);
        return;
    }

    const filtered = posProductsList.filter(p => 
        p.name.toLowerCase().includes(term) || 
        p.sku.toLowerCase().includes(term) || 
        (p.barcode && p.barcode.includes(term))
    );
    renderPOSProductsGrid(filtered);
});

function handleBarcodeScanned(barcode) {
    const product = posProductsList.find(p => p.barcode === barcode || p.sku === barcode);
    if (product) {
        addToCart(product.id);
        document.getElementById('pos-search-input').value = '';
    } else {
        alert(`Producto con código ${barcode} no encontrado en catálogo.`);
    }
}

function addToCart(productId) {
    const product = posProductsList.find(p => p.id === productId);
    if (!product) return;

    const existingIndex = STATE.cart.findIndex(item => item.product_id === productId);

    if (product.is_weighted) {
        const qtyStr = prompt(`Ingrese la cantidad en ${product.unit_type} para "${product.name}":`, '1.0');
        const qty = parseFloat(qtyStr);
        if (isNaN(qty) || qty <= 0) return;

        if (existingIndex > -1) {
            STATE.cart[existingIndex].quantity += qty;
        } else {
            STATE.cart.push({ 
                product_id: product.id, 
                name: product.name, 
                unit_price: product.sale_price, 
                quantity: qty, 
                unit_type: product.unit_type,
                tiers: product.tiers || [],
                is_combo: product.is_combo === 1
            });
        }
    } else {
        if (existingIndex > -1) {
            STATE.cart[existingIndex].quantity += 1;
        } else {
            STATE.cart.push({ 
                product_id: product.id, 
                name: product.name, 
                unit_price: product.sale_price, 
                quantity: 1, 
                unit_type: product.unit_type,
                tiers: product.tiers || [],
                is_combo: product.is_combo === 1
            });
        }
    }

    renderCart();
}

function updateCartQty(index, delta) {
    STATE.cart[index].quantity += delta;
    if (STATE.cart[index].quantity <= 0) {
        STATE.cart.splice(index, 1);
    }
    renderCart();
}

function removeFromCart(index) {
    STATE.cart.splice(index, 1);
    renderCart();
}

function clearCart() {
    STATE.cart = [];
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items-container');
    const subtotalEl = document.getElementById('cart-subtotal');
    const totalEl = document.getElementById('cart-total');
    const btnCheckout = document.getElementById('btn-checkout');

    if (STATE.cart.length === 0) {
        container.innerHTML = `
            <div class="text-center py-12 text-gray-400 text-xs">
                <i class="fa-solid fa-basket-shopping text-3xl mb-2 text-gray-300"></i>
                <p>Carrito Vacío</p>
            </div>
        `;
        subtotalEl.innerText = '$0.00';
        totalEl.innerText = '$0.00';
        btnCheckout.disabled = true;
        return;
    }

    let subtotal = 0;
    container.innerHTML = STATE.cart.map((item, idx) => {
        let priceToUse = item.unit_price;
        let tierAppliedLabel = '';

        if (item.tiers && item.tiers.length > 0) {
            const applicableTier = item.tiers.slice().reverse().find(t => item.quantity >= t.min_quantity && (item.quantity <= t.max_quantity || !t.max_quantity));
            if (applicableTier) {
                priceToUse = applicableTier.tiered_price;
                tierAppliedLabel = `<span class="bg-emerald-100 text-emerald-800 text-[9px] font-bold px-1 rounded">Precio Mayoreo</span>`;
            }
        }

        const itemTotal = priceToUse * item.quantity;
        subtotal += itemTotal;

        return `
            <div class="py-2.5 flex items-center justify-between gap-2 border-b border-gray-100">
                <div class="flex-1">
                    <div class="flex items-center gap-1">
                        <h5 class="font-bold text-xs text-slate-800 leading-tight">${item.name}</h5>
                        ${tierAppliedLabel}
                    </div>
                    <span class="text-[11px] text-gray-400 font-semibold">$${priceToUse.toFixed(2)} / ${item.unit_type}</span>
                </div>
                <div class="flex items-center gap-1.5 bg-gray-100 rounded-lg p-1">
                    <button onclick="updateCartQty(${idx}, -1)" class="w-6 h-6 bg-white rounded flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">-</button>
                    <span class="text-xs font-black px-1.5">${item.quantity}</span>
                    <button onclick="updateCartQty(${idx}, 1)" class="w-6 h-6 bg-white rounded flex items-center justify-center font-bold text-xs text-gray-700 shadow-sm">+</button>
                </div>
                <div class="text-right">
                    <div class="font-black text-xs text-slate-900">$${itemTotal.toFixed(2)}</div>
                    <button onclick="removeFromCart(${idx})" class="text-[10px] text-rose-500 font-bold hover:underline">Quitar</button>
                </div>
            </div>
        `;
    }).join('');

    subtotalEl.innerText = `$${subtotal.toFixed(2)}`;
    totalEl.innerText = `$${subtotal.toFixed(2)}`;
    btnCheckout.disabled = false;
}

// Modales de Cobro
function openCheckoutModal() {
    const totalStr = document.getElementById('cart-total').innerText;
    document.getElementById('modal-checkout-total').innerText = totalStr;
    document.getElementById('modal-checkout').classList.remove('hidden');
    document.getElementById('checkout-cash-received').focus();
}

function closeCheckoutModal() {
    document.getElementById('modal-checkout').classList.add('hidden');
}

function toggleCashInput() {
    const method = document.getElementById('checkout-method').value;
    document.getElementById('cash-input-group').style.display = method === 'CASH' ? 'block' : 'none';
}

function calculateChange() {
    const total = parseFloat(document.getElementById('modal-checkout-total').innerText.replace('$', '')) || 0;
    const received = parseFloat(document.getElementById('checkout-cash-received').value) || 0;
    const change = Math.max(0, received - total);
    document.getElementById('checkout-change-given').innerText = `$${change.toFixed(2)}`;
}

async function confirmCheckout() {
    const method = document.getElementById('checkout-method').value;
    const total = parseFloat(document.getElementById('modal-checkout-total').innerText.replace('$', '')) || 0;
    const cashReceived = parseFloat(document.getElementById('checkout-cash-received').value) || 0;
    const customerId = document.getElementById('checkout-customer-select')?.value || null;

    if (method === 'CASH' && cashReceived < total) {
        alert('El efectivo recibido es menor al monto total del ticket.');
        return;
    }

    try {
        const payload = {
            items: STATE.cart,
            payment_method: method,
            cash_received: cashReceived,
            customer_id: customerId
        };

        const res = await apiFetch('/api/pos/checkout', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        if (res.success) {
            alert(`✅ Venta Exitosa!\nTicket Folio: ${res.sale.ticket_number}\nCambio: $${res.sale.change_given.toFixed(2)}`);
            
            if (res.sale.drawer_warning) {
                document.getElementById('drawer-warning-banner').classList.remove('hidden');
            }

            closeCheckoutModal();
            clearCart();
            loadPOSProducts();
        } else {
            alert(res.message);
        }
    } catch (err) {
        if (!navigator.onLine || (err.message && (err.message.includes('fetch') || err.message.includes('Failed') || err.message.includes('Network')))) {
            const offlineQueue = JSON.parse(localStorage.getItem('pos_offline_sales') || '[]');
            const offlinePayload = {
                items: STATE.cart,
                payment_method: method,
                cash_received: cashReceived,
                customer_id: customerId,
                offline_timestamp: new Date()
            };
            offlineQueue.push(offlinePayload);
            localStorage.setItem('pos_offline_sales', JSON.stringify(offlineQueue));

            alert(`🟡 MODO OFFLINE: Venta cobrada y guardada localmente.\nSe sincronizará automáticamente con la nube cuando regrese el internet.`);
            closeCheckoutModal();
            clearCart();
        } else {
            alert(err.message || 'Error al procesar el cobro.');
        }
    }
}

// Ventas en Espera / Parked Tickets (Eleventa / SICAR Style)
async function handleParkCurrentCart() {
    if (STATE.cart.length === 0) {
        alert('El carrito está vacío. Agregue productos antes de poner la venta en espera.');
        return;
    }

    const ticketName = prompt('Nombre o número para identificar la venta en espera (ej. Cliente playera azul):', `Ticket #${Date.now().toString().slice(-4)}`);
    if (ticketName === null) return;

    try {
        const res = await apiFetch('/api/pos/park-ticket', {
            method: 'POST',
            body: JSON.stringify({
                cart: STATE.cart,
                ticket_name: ticketName
            })
        });

        if (res.success) {
            alert(`⏸️ ${res.message}`);
            clearCart();
            loadParkedTicketsCount();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al poner venta en espera.');
    }
}

async function loadParkedTicketsCount() {
    try {
        const res = await apiFetch('/api/pos/parked-tickets');
        if (res.success) {
            const badge = document.getElementById('parked-count-badge');
            if (badge) badge.innerText = res.parked_tickets.length;
        }
    } catch (e) {}
}

async function openParkedTicketsModal() {
    const listEl = document.getElementById('parked-tickets-list');
    listEl.innerHTML = '<div class="text-center py-4 text-gray-500 font-medium">Cargando ventas pausadas...</div>';
    document.getElementById('modal-parked-tickets').classList.remove('hidden');

    try {
        const res = await apiFetch('/api/pos/parked-tickets');
        if (res.success && res.parked_tickets.length > 0) {
            listEl.innerHTML = res.parked_tickets.map(t => {
                const cartItems = JSON.parse(t.cart_json || '[]');
                const total = cartItems.reduce((acc, i) => acc + (i.sale_price * i.quantity), 0);
                return `
                    <div class="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                        <div>
                            <div class="font-extrabold text-sm text-slate-900">${t.ticket_name}</div>
                            <div class="text-xs text-gray-500">${cartItems.length} artículos | Total: <span class="font-bold text-amber-600">$${total.toFixed(2)}</span></div>
                        </div>
                        <div class="flex gap-2">
                            <button onclick="resumeParkedTicket(${t.id}, '${t.cart_json.replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-emerald-600 text-white font-bold text-xs rounded-xl shadow hover:bg-emerald-500">
                                Reanudar ➡️
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            listEl.innerHTML = '<div class="text-center py-6 text-gray-400 font-bold text-sm">No hay ventas pausadas en espera.</div>';
        }
    } catch (e) {
        listEl.innerHTML = '<div class="text-center py-4 text-rose-500 font-bold">Error al cargar ventas en espera.</div>';
    }
}

function closeParkedTicketsModal() {
    document.getElementById('modal-parked-tickets').classList.add('hidden');
}

async function resumeParkedTicket(parkedId, cartJsonStr) {
    if (STATE.cart.length > 0) {
        if (!confirm('Actualmente hay artículos en el carrito. ¿Desea reemplazarlos con la venta pausada?')) return;
    }

    try {
        STATE.cart = JSON.parse(cartJsonStr);
        updateCartUI();
        await apiFetch('/api/pos/delete-parked-ticket', {
            method: 'POST',
            body: JSON.stringify({ parked_id: parkedId })
        });
        closeParkedTicketsModal();
        loadParkedTicketsCount();
    } catch (e) {
        alert('Error al reanudar venta.');
    }
}

// Teclas Rápidas F1-F12 (Eleventa Style)
window.addEventListener('keydown', (e) => {
    if (STATE.currentView !== 'pos') return;

    if (e.key === 'F2') {
        e.preventDefault();
        const searchInput = document.getElementById('pos-search-input');
        if (searchInput) searchInput.focus();
    } else if (e.key === 'F4') {
        e.preventDefault();
        const custSelect = document.getElementById('checkout-customer-select');
        if (custSelect) custSelect.focus();
    } else if (e.key === 'F8') {
        e.preventDefault();
        handleParkCurrentCart();
    } else if (e.key === 'F12') {
        e.preventDefault();
        if (STATE.cart.length > 0) {
            openCheckoutModal();
        }
    }
});
