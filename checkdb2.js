const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(process.cwd(), 'data', 'app.db'));
console.log('CHATS_NO_USER:', JSON.stringify(db.prepare("SELECT * FROM chats WHERE user_id IS NULL").all()));
console.log('Total chats:', db.prepare('SELECT COUNT(*) as c FROM chats').get().c);
console.log('Total users:', db.prepare('SELECT COUNT(*) as c FROM users').get().c);
db.close();
