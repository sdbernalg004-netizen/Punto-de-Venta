/**
 * CONTROLADOR DE RESPALDOS AUTOMÁTICOS Y DESCARGA DE BASE DE DATOS (BACKUPS)
 */

const fs = require('fs');
const path = require('path');
const { db } = require('../config/database');

const dbFolder = fs.existsSync('/app/data') ? '/app/data' : path.join(__dirname, '../../../');
const dbPath = process.env.DATABASE_FILE || path.join(dbFolder, 'pos_database.db');
const backupsFolder = path.join(dbFolder, 'backups');

if (!fs.existsSync(backupsFolder)) {
    fs.mkdirSync(backupsFolder, { recursive: true });
}

/**
 * Generar un nuevo respaldo de la base de datos
 */
function createBackup(req, res) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `pos_backup_${timestamp}.db`;
        const targetPath = path.join(backupsFolder, backupFileName);

        // SQLite Online Backup API (Garantiza consistencia incluso durante transacciones activas)
        db.backup(targetPath)
            .then(() => {
                const stats = fs.statSync(targetPath);
                db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
                    req.user.branch_id || null, req.user.id, 'BACKUP_CREATED', `Respaldo de base de datos generado: ${backupFileName} (${(stats.size / 1024).toFixed(1)} KB)`
                );

                res.json({
                    success: true,
                    message: `Copia de seguridad "${backupFileName}" creada exitosamente.`,
                    filename: backupFileName,
                    size_kb: (stats.size / 1024).toFixed(1),
                    created_at: new Date()
                });
            })
            .catch((err) => {
                console.error('Error al generar respaldo SQLite:', err);
                res.status(500).json({ success: false, message: 'Error al generar copia de seguridad.' });
            });
    } catch (error) {
        console.error('Error en createBackup:', error);
        res.status(500).json({ success: false, message: 'Error interno al procesar respaldo.' });
    }
}

/**
 * Listar los respaldos disponibles
 */
function listBackups(req, res) {
    try {
        if (!fs.existsSync(backupsFolder)) {
            return res.json({ success: true, backups: [] });
        }

        const files = fs.readdirSync(backupsFolder)
            .filter(f => f.startsWith('pos_backup_') && f.endsWith('.db'))
            .map(filename => {
                const filePath = path.join(backupsFolder, filename);
                const stats = fs.statSync(filePath);
                return {
                    filename,
                    size_kb: (stats.size / 1024).toFixed(1),
                    created_at: stats.mtime
                };
            })
            .sort((a, b) => b.created_at - a.created_at);

        res.json({ success: true, backups: files });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al listar respaldos.' });
    }
}

/**
 * Descargar un respaldo de la base de datos
 */
function downloadBackup(req, res) {
    try {
        const { filename } = req.params;

        // Prevenir ataques de Directory Traversal (seguridad)
        const safeFilename = path.basename(filename);
        const filePath = path.join(backupsFolder, safeFilename);

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Archivo de respaldo no encontrado.' });
        }

        db.prepare('INSERT INTO audit_logs (branch_id, user_id, action, details) VALUES (?, ?, ?, ?)').run(
            req.user.branch_id || null, req.user.id, 'BACKUP_DOWNLOADED', `Respaldo descargado por el dueño: ${safeFilename}`
        );

        res.download(filePath, safeFilename);
    } catch (error) {
        res.status(500).json({ success: false, message: 'Error al descargar respaldo.' });
    }
}

module.exports = {
    createBackup,
    listBackups,
    downloadBackup
};
