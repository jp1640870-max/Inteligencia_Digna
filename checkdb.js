const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.cwd(), 'data', 'app.db'));
console.log('USERS:', JSON.stringify(db.prepare('SELECT * FROM users').all()));
console.log('CHATS:', JSON.stringify(db.prepare('SELECT * FROM chats').all()));
console.log('CHATS_NO_USER:', JSON.stringify(db.prepare('SELECT * FROM chats WHERE user_id IS NULL OR user_id = ""').all()));
db.close();
