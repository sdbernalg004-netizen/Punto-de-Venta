/**
 * LÓGICA DE DASHBOARD DEL DUEÑO, ANALÍTICA, CHART.JS Y AUDITORÍA ANTI-FRAUDE
 */

let chartBranchSales = null;
let chartCategorySales = null;

async function loadDashboardOverview() {
    try {
        const res = await apiFetch('/api/analytics/dashboard');
        if (res.success) {
            renderDashboardKPIs(res.overview);
            renderDashboardCharts(res.overview);
            renderCashiersTable(res.overview.cashier_sales);
            loadReorderSuggestions();
            loadBackupsList();
        }
    } catch (error) {
        console.error('Error al cargar dashboard:', error);
    }
}

function renderDashboardKPIs(overview) {
    document.getElementById('dash-sales-today').innerText = `$${overview.sales_today.total.toFixed(2)}`;
    document.getElementById('dash-tickets-today').innerText = `${overview.sales_today.tickets_count} tickets procesados hoy`;
    document.getElementById('dash-sales-month').innerText = `$${overview.sales_month.total.toFixed(2)}`;
    document.getElementById('dash-alerts-count').innerText = overview.fraud_alerts ? overview.fraud_alerts.length : 0;
}

function renderCashiersTable(cashiers) {
    const tbody = document.getElementById('cashiers-table-body');
    if (!tbody) return;

    if (!cashiers || cashiers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-gray-400">Sin registros de ventas por cajero.</td></tr>';
        return;
    }

    tbody.innerHTML = cashiers.map(c => `
        <tr class="hover:bg-gray-50 text-xs">
            <td class="p-2.5 font-bold text-slate-800 flex items-center gap-2">
                <div class="w-6 h-6 rounded-full bg-slate-800 text-amber-400 flex items-center justify-center font-bold text-[10px]">
                    ${c.full_name.charAt(0)}
                </div>
                <span>${c.full_name}</span>
            </td>
            <td class="p-2.5 font-semibold text-gray-600">${c.role}</td>
            <td class="p-2.5 text-gray-700 font-medium">${c.branch_name}</td>
            <td class="p-2.5 font-bold text-cyan-700">${c.ticket_count} tickets</td>
            <td class="p-2.5 font-black text-emerald-600 text-sm">$${c.total_sales.toFixed(2)}</td>
        </tr>
    `).join('');
}

function renderDashboardCharts(overview) {
    // 1. Gráfica Comparativa de Ventas por Sucursal
    const branchCtx = document.getElementById('chart-branch-sales')?.getContext('2d');
    if (branchCtx) {
        if (chartBranchSales) chartBranchSales.destroy();

        const labels = overview.branch_sales.map(b => b.name);
        const data = overview.branch_sales.map(b => b.total_sales);

        chartBranchSales = new Chart(branchCtx, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Ventas Totales ($)',
                    data,
                    backgroundColor: ['#f59e0b', '#10b981', '#6366f1', '#ec4899'],
                    borderRadius: 8
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } }
            }
        });
    }

    // 2. Gráfica de Ventas por Categoría
    const catCtx = document.getElementById('chart-category-sales')?.getContext('2d');
    if (catCtx) {
        if (chartCategorySales) chartCategorySales.destroy();

        const labels = overview.category_sales.map(c => c.category_name);
        const data = overview.category_sales.map(c => c.total_sales);

        chartCategorySales = new Chart(catCtx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: ['#ec4899', '#3b82f6', '#10b981', '#f59e0b']
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }
}

async function loadReorderSuggestions() {
    try {
        const res = await apiFetch('/api/analytics/reorder-suggestions');
        if (res.success) {
            renderReorderTable(res.reorder_suggestions);
        }
    } catch (error) {
        console.error('Error en sugerencias de reabastecimiento:', error);
    }
}

function renderReorderTable(suggestions) {
    const tbody = document.getElementById('reorder-table-body');
    if (!tbody) return;

    if (suggestions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-6 text-gray-400">Todo el inventario está en niveles óptimos.</td></tr>';
        return;
    }

    tbody.innerHTML = suggestions.map(item => `
        <tr class="hover:bg-gray-50">
            <td class="p-2.5 font-bold text-slate-800">${item.product_name}</td>
            <td class="p-2.5 text-gray-600 font-medium">${item.branch_name}</td>
            <td class="p-2.5 font-semibold text-gray-700">${item.current_stock} ${item.unit_type}</td>
            <td class="p-2.5 font-semibold text-cyan-700">${item.daily_velocity} / día</td>
            <td class="p-2.5 font-bold ${item.days_left <= 3 ? 'text-rose-600 animate-pulse' : 'text-amber-600'}">${item.days_left} días</td>
            <td class="p-2.5 font-black text-emerald-600">+ ${item.suggested_reorder_qty} ${item.unit_type}</td>
            <td class="p-2.5 font-black text-slate-900">$${item.estimated_cost.toFixed(2)}</td>
        </tr>
    `).join('');
}

async function loadAuditLogs() {
    try {
        const res = await apiFetch('/api/analytics/fraud-trail');
        if (res.success) {
            renderAuditTable(res.logs);
        }
    } catch (error) {
        console.error('Error al cargar auditoría:', error);
    }
}

function renderAuditTable(logs) {
    const tbody = document.getElementById('audit-table-body');
    if (!tbody) return;

    if (logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center py-6 text-gray-400">Sin eventos de auditoría registrados.</td></tr>';
        return;
    }

    tbody.innerHTML = logs.map(log => `
        <tr class="hover:bg-gray-50 text-xs">
            <td class="p-2.5 text-gray-500 font-mono">${new Date(log.created_at).toLocaleString()}</td>
            <td class="p-2.5 font-bold text-slate-800">${log.user_name || log.username || 'Sistema'}</td>
            <td class="p-2.5">
                <span class="px-2 py-0.5 rounded font-mono font-bold text-[10px] bg-slate-100 text-slate-700 uppercase">
                    ${log.action}
                </span>
            </td>
            <td class="p-2.5 text-gray-700 font-medium">${log.details}</td>
        </tr>
    `).join('');
}

async function loadBackupsList() {
    const container = document.getElementById('backups-list-container');
    if (!container) return;

    try {
        const res = await apiFetch('/api/admin/backup/list');
        if (res.success && res.backups.length > 0) {
            container.innerHTML = res.backups.map(b => `
                <div class="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                    <div>
                        <div class="font-extrabold text-xs text-slate-900">${b.filename}</div>
                        <div class="text-[10px] text-gray-500">${new Date(b.created_at).toLocaleString()} | ${b.size_kb} KB</div>
                    </div>
                    <a href="/api/admin/backup/download/${b.filename}" download 
                       class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-lg flex items-center gap-1 shadow">
                        <i class="fa-solid fa-file-arrow-down"></i> Descargar
                    </a>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="text-center py-3 text-gray-400 font-semibold text-xs">No hay copias de seguridad generadas aún. Presione "Generar Respaldo Ahora".</div>';
        }
    } catch (e) {
        container.innerHTML = '<div class="text-center py-2 text-rose-500 font-bold text-xs">Error al cargar lista de respaldos.</div>';
    }
}
