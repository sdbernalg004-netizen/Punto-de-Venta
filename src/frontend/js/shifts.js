/**
 * LÓGICA DE TURNOS DE CAJA, ARQUEO A CIEGAS Y SANGRÍAS
 */

async function loadShiftStatus() {
    try {
        const res = await apiFetch('/api/shifts/current');
        const container = document.getElementById('shift-status-card');

        if (res.success) {
            if (!res.active_shift) {
                renderNoShiftState(container);
            } else {
                renderActiveShiftState(container, res.active_shift);
            }
        }
    } catch (error) {
        console.error('Error al cargar estado de turno:', error);
    }
}

function renderNoShiftState(container) {
    container.innerHTML = `
        <div class="text-center py-8 max-w-md mx-auto">
            <div class="w-16 h-16 bg-cyan-100 text-cyan-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <i class="fa-solid fa-vault text-3xl"></i>
            </div>
            <h3 class="text-2xl font-black text-slate-900">Sin Turno de Caja Abierto</h3>
            <p class="text-xs text-gray-500 mt-1 mb-6">Para comenzar a realizar ventas y cobros en el POS, active su turno de caja ingresando el fondo inicial.</p>
            <form onsubmit="handleOpenShift(event)" class="space-y-4 text-left bg-gray-50 p-5 rounded-2xl border border-gray-200">
                <div>
                    <label class="block text-xs font-bold text-gray-700 uppercase mb-1">Monto de Fondo Inicial ($)</label>
                    <input type="number" id="shift-initial-cash" required placeholder="500.00" step="0.01" value="500.00"
                           class="w-full px-4 py-3 border border-gray-300 rounded-xl text-lg font-bold text-slate-900">
                </div>
                <button type="submit" class="w-full py-3.5 bg-cyan-600 hover:bg-cyan-700 text-white font-extrabold text-sm rounded-xl shadow-lg transition">
                    ABRIR TURNO DE CAJA
                </button>
            </form>
        </div>
    `;
}

function renderActiveShiftState(container, shift) {
    container.innerHTML = `
        <div class="space-y-6">
            <div class="flex justify-between items-center border-b border-gray-100 pb-4">
                <div>
                    <span class="px-2.5 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold text-xs">TURNO ACTIVO # ${shift.id}</span>
                    <h3 class="text-xl font-black text-slate-900 mt-1">Caja en Operación</h3>
                    <p class="text-xs text-gray-500">Iniciado el ${new Date(shift.opened_at).toLocaleString()}</p>
                </div>
                <button onclick="promptCloseShift(${shift.id})" class="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow">
                    <i class="fa-solid fa-lock mr-1"></i> CIERRA DE TURNO (ARQUEO A CIEGAS)
                </button>
            </div>

            <!-- RESUMEN DE MOVIMIENTOS EN TURNO -->
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <span class="text-[11px] font-bold text-gray-400 uppercase">Fondo Inicial</span>
                    <div class="text-2xl font-black text-slate-800">$${shift.initial_cash.toFixed(2)}</div>
                </div>
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <span class="text-[11px] font-bold text-gray-400 uppercase">Ventas en Efectivo</span>
                    <div class="text-2xl font-black text-emerald-600">$${shift.sales_summary.cash_sales.toFixed(2)}</div>
                </div>
                <div class="bg-gray-50 p-4 rounded-xl border border-gray-200">
                    <span class="text-[11px] font-bold text-gray-400 uppercase">Ventas con Tarjeta</span>
                    <div class="text-2xl font-black text-cyan-600">$${shift.sales_summary.card_sales.toFixed(2)}</div>
                </div>
            </div>

            <!-- BOTONES DE MOVIMIENTOS DE CAJA (SANGRÍAS) -->
            <div class="bg-amber-50 p-4 rounded-xl border border-amber-200 flex flex-wrap gap-3 items-center justify-between">
                <div>
                    <h4 class="font-bold text-sm text-amber-900">Retiros de Seguridad (Sangrías de Caja)</h4>
                    <p class="text-xs text-amber-700">Deposite dinero en efectivo a caja fuerte para no sobrepasar el límite de seguridad en cajón.</p>
                </div>
                <button onclick="promptCashMovement(${shift.id})" class="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow">
                    + Registrar Sangría / Retiro
                </button>
            </div>
        </div>
    `;
}

async function handleOpenShift(e) {
    e.preventDefault();
    const initialCash = parseFloat(document.getElementById('shift-initial-cash').value) || 0;

    try {
        const res = await apiFetch('/api/shifts/open', {
            method: 'POST',
            body: JSON.stringify({ initial_cash: initialCash })
        });

        if (res.success) {
            alert('✅ Turno de caja abierto correctamente.');
            loadShiftStatus();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al abrir turno.');
    }
}

async function promptCashMovement(shiftId) {
    const amountStr = prompt('Monto a retirar en efectivo ($):');
    if (!amountStr) return;
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) return;

    const reason = prompt('Motivo del retiro / Sangría (ej. Depósito a Caja Fuerte):', 'Sangría de seguridad');
    if (!reason) return;

    try {
        const res = await apiFetch('/api/shifts/movement', {
            method: 'POST',
            body: JSON.stringify({
                shift_id: shiftId,
                type: 'DROP',
                amount,
                reason
            })
        });

        if (res.success) {
            alert('✅ Sangría de caja registrada.');
            loadShiftStatus();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al registrar sangría.');
    }
}

async function promptCloseShift(shiftId) {
    const countedStr = prompt('🔒 ARQUEO A CIEGAS: Ingrese la cantidad exacta de dinero físico que contó en la caja ($):');
    if (countedStr === null) return;
    const counted = parseFloat(countedStr);
    if (isNaN(counted)) {
        alert('Debe ingresar una cantidad numérica válida.');
        return;
    }

    const notes = prompt('Notas de cierre de turno (opcional):', '');

    try {
        const res = await apiFetch('/api/shifts/close', {
            method: 'POST',
            body: JSON.stringify({
                shift_id: shiftId,
                blind_cash_counted: counted,
                notes
            })
        });

        if (res.success) {
            const summary = res.summary;
            const diff = summary.discrepancy;
            let diffMsg = 'Caja Cuadrada Exacta ($0.00)';
            if (diff < 0) diffMsg = `⚠️ FALTANTE DE DINERO: -$${Math.abs(diff).toFixed(2)}`;
            if (diff > 0) diffMsg = `ℹ️ SOBRANTE DE DINERO: +$${diff.toFixed(2)}`;

            alert(`📋 RESUMEN DE ARQUEO A CIEGAS:\n\n• Efectivo Contado por usted: $${summary.blind_cash_counted.toFixed(2)}\n• Efectivo Teórico Esperado: $${summary.expected_cash.toFixed(2)}\n• Resultado: ${diffMsg}\n\nEl turno ha sido CERRADO.`);
            loadShiftStatus();
        } else {
            alert(res.message);
        }
    } catch (err) {
        alert(err.message || 'Error al cerrar turno.');
    }
}
