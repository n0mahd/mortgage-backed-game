'use strict';

// The SQLite database (node:sqlite), migrated on first require.

const { DatabaseSync } = require('node:sqlite');
const { getConfig } = require('./config');
const { migrate } = require('./migrations');

const DB_PATH = getConfig().dbPath;
const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA foreign_keys = ON`);

migrate(db);

// Runs fn between BEGIN and COMMIT and returns its result; rolls back and
// rethrows if fn throws.
db.withTransaction = function withTransaction(fn) {
    db.exec('BEGIN');
    try {
        const result = fn();
        db.exec('COMMIT');
        return result;
    } catch (err) {
        try {
            db.exec('ROLLBACK');
        } catch (rollbackErr) {
            if (!/no transaction is active/i.test(rollbackErr.message || '')) throw rollbackErr;
        }
        throw err;
    }
};

module.exports = db;
