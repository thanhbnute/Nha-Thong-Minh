const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const firestore = admin.firestore();

// === XÓA TẤT CẢ DỮ LIỆU ===
async function deleteAllData() {
    console.log('⚠️ CẢNH BÁO: Xóa TẤT CẢ dữ liệu trong collection history_data');
    console.log('Nhấn Ctrl+C trong 5 giây để hủy...');
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const batchSize = 500;
    let deletedCount = 0;
    
    const collectionRef = firestore.collection('history_data');
    
    while (true) {
        const snapshot = await collectionRef.limit(batchSize).get();
        
        if (snapshot.empty) {
            break;
        }
        
        const batch = firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        deletedCount += snapshot.size;
        console.log(`🗑️ Đã xóa ${deletedCount} documents...`);
    }
    
    console.log(`✅ Hoàn tất! Đã xóa tổng cộng ${deletedCount} documents`);
    process.exit(0);
}

// === XÓA THEO PHÒNG ===
async function deleteByRoom(roomName) {
    console.log(`⚠️ Xóa tất cả dữ liệu của phòng: ${roomName}`);
    
    const batchSize = 500;
    let deletedCount = 0;
    
    while (true) {
        const snapshot = await firestore.collection('history_data')
            .where('room', '==', roomName)
            .limit(batchSize)
            .get();
        
        if (snapshot.empty) break;
        
        const batch = firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        deletedCount += snapshot.size;
        console.log(`🗑️ Đã xóa ${deletedCount} documents của ${roomName}...`);
    }
    
    console.log(`✅ Đã xóa ${deletedCount} documents của phòng ${roomName}`);
    process.exit(0);
}

// === XÓA THEO KHOẢNG THỜI GIAN ===
async function deleteByDateRange(daysOld) {
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - daysOld);
    
    console.log(`⚠️ Xóa dữ liệu cũ hơn ${daysOld} ngày (trước ${dateThreshold.toLocaleDateString()})`);
    
    const batchSize = 500;
    let deletedCount = 0;
    
    while (true) {
        const snapshot = await firestore.collection('history_data')
            .where('timestamp', '<', dateThreshold)
            .limit(batchSize)
            .get();
        
        if (snapshot.empty) break;
        
        const batch = firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        deletedCount += snapshot.size;
        console.log(`🗑️ Đã xóa ${deletedCount} documents...`);
    }
    
    console.log(`✅ Đã xóa ${deletedCount} documents cũ hơn ${daysOld} ngày`);
    process.exit(0);
}

// === GIỚI HẠN SỐ LƯỢNG RECORDS ===
async function keepOnlyLatest(maxRecords = 1000) {
    console.log(`⚠️ Giữ lại ${maxRecords} records mới nhất, xóa phần còn lại`);
    
    // Đếm tổng số documents
    const countSnapshot = await firestore.collection('history_data').count().get();
    const totalDocs = countSnapshot.data().count;
    
    if (totalDocs <= maxRecords) {
        console.log(`✅ Chỉ có ${totalDocs} documents, không cần xóa`);
        process.exit(0);
    }
    
    const docsToDelete = totalDocs - maxRecords;
    console.log(`🗑️ Cần xóa ${docsToDelete} documents cũ nhất...`);
    
    // Lấy documents cũ nhất
    const snapshot = await firestore.collection('history_data')
        .orderBy('timestamp', 'asc')
        .limit(docsToDelete)
        .get();
    
    const batchSize = 500;
    let deletedCount = 0;
    
    for (let i = 0; i < snapshot.docs.length; i += batchSize) {
        const batch = firestore.batch();
        const batchDocs = snapshot.docs.slice(i, i + batchSize);
        batchDocs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        deletedCount += batchDocs.length;
        console.log(`🗑️ Đã xóa ${deletedCount}/${docsToDelete} documents...`);
    }
    
    console.log(`✅ Hoàn tất! Còn lại ${maxRecords} records mới nhất`);
    process.exit(0);
}

// === MENU CHỌN ===
const args = process.argv.slice(2);
const command = args[0];
const param = args[1];

switch(command) {
    case 'all':
        deleteAllData();
        break;
    case 'room':
        if (!param) {
            console.log('❌ Cần chỉ định tên phòng: node cleanup.js room livingroom');
            process.exit(1);
        }
        deleteByRoom(param);
        break;
    case 'days':
        const days = parseInt(param) || 30;
        deleteByDateRange(days);
        break;
    case 'keep':
        const maxRecords = parseInt(param) || 1000;
        keepOnlyLatest(maxRecords);
        break;
    default:
        console.log(`
📋 HƯỚNG DẪN SỬ DỤNG:

1. Xóa TẤT CẢ dữ liệu:
   node cleanup.js all

2. Xóa theo phòng:
   node cleanup.js room livingroom
   node cleanup.js room kitchen
   node cleanup.js room bedroom

3. Xóa dữ liệu cũ hơn X ngày:
   node cleanup.js days 30    (xóa cũ hơn 30 ngày)
   node cleanup.js days 7     (xóa cũ hơn 7 ngày)

4. Giữ lại X records mới nhất:
   node cleanup.js keep 1000  (giữ 1000 records mới nhất)
   node cleanup.js keep 500   (giữ 500 records mới nhất)
        `);
        process.exit(0);
}