const bcrypt = require('bcrypt');
const saltRounds = 10;
const plainPassword = 'b5restaurant'; // รหัสผ่านเดิมของคุณ

bcrypt.hash(plainPassword, saltRounds, function(err, hash) {
    if (err) {
        console.error('เกิดข้อผิดพลาดในการสร้าง Hash:', err);
        return;
    }
    console.log('--- รหัสผ่านที่เข้ารหัสแล้ว ---');
    console.log(hash);
    console.log('--- คัดลอกข้อความข้างบนนี้ไปใช้ได้เลย ---');
});