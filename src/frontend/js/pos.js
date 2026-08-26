/**
 * LÓGICA DEL PUNTO DE VENTA (POS), CARRITO, TECLADO Y ESCÁNER
 */

let posProductsList = [];
let barcodeBuffer = '';
let lastKeyTime = Date.now();

// Listener para Escáner de Código de Barras USB (Keyboard Wedge)
window.addEventListener('keydown', (e) => {
    // Si estamos escribiendo en un input normal, no interceptar
    if (document.activeElement.tagName === 'INPUT' && document.activeElement.id !== 'pos-search-input') {
        return;
    }

    const currentTime = Date.now();
    // Los escáneres USB envían teclas con menos de 30ms de intervalo
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
            renderPOSProductsGrid(posProductsList);
            renderCategoryPills();
        }
    } catch (error) {
        console.error('Error al cargar productos:', error);
    }
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

    grid.innerHTML = products.map(p => `
        <div onclick="addToCart(${p.id})" class="product-card bg-white p-3 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md cursor-pointer flex flex-col justify-between h-36">
            <div>
                <span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 uppercase">${p.unit_type}</span>
                <h4 class="font-bold text-xs text-slate-800 line-clamp-2 mt-1">${p.name}</h4>
            </div>
            <div>
                <div class="text-[11px] text-gray-400 font-semibold">Stock: ${p.stock_quantity}</div>
                <div class="text-base font-black text-amber-600">$${p.sale_price.toFixed(2)}</div>
            </div>
        </div>
    `).join('');
}

// Búsqueda en vivo al escribir en input
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
        // Venta a granel / Peso (alimento o materias primas)
        const qtyStr = prompt(`Ingrese la cantidad en ${product.unit_type} para "${product.name}":`, '1.0');
        const qty = parseFloat(qtyStr);
        if (isNaN(qty) || qty <= 0) return;

        if (existingIndex > -1) {
            STATE.cart[existingIndex].quantity += qty;
        } else {
            STATE.cart.push({ product_id: product.id, name: product.name, unit_price: product.sale_price, quantity: qty, unit_type: product.unit_type });
        }
    } else {
        if (existingIndex > -1) {
            STATE.cart[existingIndex].quantity += 1;
        } else {
            STATE.cart.push({ product_id: product.id, name: product.name, unit_price: product.sale_price, quantity: 1, unit_type: product.unit_type });
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
        const itemTotal = item.unit_price * item.quantity;
        subtotal += itemTotal;

        return `
            <div class="py-2.5 flex items-center justify-between gap-2">
                <div class="flex-1">
                    <h5 class="font-bold text-xs text-slate-800 leading-tight">${item.name}</h5>
                    <span class="text-[11px] text-gray-400 font-semibold">$${item.unit_price.toFixed(2)} / ${item.unit_type}</span>
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

    if (method === 'CASH' && cashReceived < total) {
        alert('El efectivo recibido es menor al monto total del ticket.');
        return;
    }

    try {
        const payload = {
            items: STATE.cart,
            payment_method: method,
            cash_received: cashReceived
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
        alert(err.message || 'Error al procesar el cobro.');
    }
}
