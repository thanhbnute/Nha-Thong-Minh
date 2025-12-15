// server.js - HiveMQ → Firebase Realtime → Firestore
const mqtt = require('mqtt');
const admin = require('firebase-admin');

// === 1. KHỞI TẠO FIREBASE ADMIN SDK ===
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://smart-home-66573-default-rtdb.firebaseio.com"
});

const realtimeDB = admin.database();
const firestore = admin.firestore();

// === 2. KẾT NỐI HIVEMQ BROKER ===
const MQTT_CONFIG = {
    broker: 'broker.hivemq.com',  // Public broker
    port: 1883,
    // Nếu dùng HiveMQ Cloud (tính phí):
    // broker: 'your-cluster.hivemq.cloud',
    // port: 8883,
    // username: 'your-username',
    // password: 'your-password',
};

const client = mqtt.connect(`mqtt://${MQTT_CONFIG.broker}:${MQTT_CONFIG.port}`);

// === 3. MQTT TOPICS (Theo cấu trúc của bạn) ===
const TOPICS = {
    livingroom: 'smarthome/livingroom/sensors',
    kitchen: 'smarthome/kitchen/sensors',
    bedroom: 'smarthome/bedroom/sensors',
    // Devices control (nếu cần)
    devicesLiving: 'smarthome/livingroom/devices',
    devicesKitchen: 'smarthome/kitchen/devices',
    devicesBedroom: 'smarthome/bedroom/devices'
};

// Theo dõi thời gian lưu Firestore
const lastSaveTime = {
    livingroom: 0,
    kitchen: 0,
    bedroom: 0
};

const SAVE_INTERVAL = 30000; // 30 giây

// === 4. XỬ LÝ KẾT NỐI MQTT ===
client.on('connect', () => {
    console.log('✅ Đã kết nối HiveMQ Broker!');
    console.log(`📡 Broker: ${MQTT_CONFIG.broker}:${MQTT_CONFIG.port}`);
    console.log('-------------------------------------------');
    
    // Subscribe tất cả topics
    Object.values(TOPICS).forEach(topic => {
        client.subscribe(topic, (err) => {
            if (!err) {
                console.log(`🔔 Đang lắng nghe: ${topic}`);
            } else {
                console.error(`❌ Lỗi subscribe ${topic}:`, err);
            }
        });
    });
});

client.on('error', (error) => {
    console.error('❌ Lỗi MQTT:', error);
});

client.on('reconnect', () => {
    console.log('🔄 Đang kết nối lại HiveMQ...');
});

// === 5. NHẬN MESSAGE TỪ MQTT ===
client.on('message', async (topic, message) => {
    try {
        const payload = JSON.parse(message.toString());
        console.log(`📩 [${topic}] Nhận data:`, payload);
        
        // Xác định phòng từ topic
        let room = null;
        if (topic.includes('livingroom')) room = 'livingroom';
        else if (topic.includes('kitchen')) room = 'kitchen';
        else if (topic.includes('bedroom')) room = 'bedroom';
        
        if (!room) return;
        
        // === LƯU VÀO FIREBASE REALTIME DATABASE ===
        if (topic.includes('sensors')) {
            await realtimeDB.ref(`rooms/${room}/sensors`).set({
                temp: payload.temp || 0,
                humidity: payload.humidity || 0,
                light: payload.light || 0,
                gas: payload.gas || 0,
                timestamp: Date.now()
            });
            console.log(`🔥 [${room}] Đã cập nhật Realtime DB`);
            
            // === TỰ ĐỘNG LƯU VÀO FIRESTORE (MỖI 30s) ===
            saveToFirestore(room, payload);
        }
        
        // === XỬ LÝ DEVICES (nếu MCU gửi status thiết bị) ===
        if (topic.includes('devices')) {
            await realtimeDB.ref(`rooms/${room}/devices`).update(payload);
            console.log(`💡 [${room}] Đã cập nhật devices`);
        }
        
    } catch (error) {
        console.error(`❌ Lỗi parse message [${topic}]:`, error);
    }
});

// === 6. HÀM LƯU VÀO FIRESTORE ===
async function saveToFirestore(roomName, sensorData) {
    const now = Date.now();
    
    // Chỉ lưu mỗi 30s
    if (now - lastSaveTime[roomName] < SAVE_INTERVAL) {
        return;
    }
    
    lastSaveTime[roomName] = now;
    
    try {
        const dataToSave = {
            room: roomName,
            temp: sensorData.temp || 0,
            humidity: sensorData.humidity || 0,
            light: sensorData.light || 0,
            gas: sensorData.gas || 0,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        };
        
        await firestore.collection('history_data').add(dataToSave);
        console.log(`💾 [${roomName}] Đã lưu Firestore: ${sensorData.temp}°C, ${sensorData.humidity}%`);
        
    } catch (error) {
        console.error(`❌ Lỗi lưu Firestore [${roomName}]:`, error);
    }
}

// === 7. CONTROL DEVICES TỪ FIREBASE → MQTT (2 CHIỀU) ===
function listenDeviceControl() {
    ['livingroom', 'kitchen', 'bedroom'].forEach(room => {
        realtimeDB.ref(`rooms/${room}/devices`).on('value', (snapshot) => {
            const devices = snapshot.val();
            if (devices) {
                // Gửi lệnh điều khiển về MCU qua MQTT
                const topic = `smarthome/${room}/control`;
                client.publish(topic, JSON.stringify(devices), { qos: 1 });
                console.log(`📤 [${room}] Đã gửi control:`, devices);
            }
        });
    });
}

// Bật tính năng điều khiển 2 chiều
listenDeviceControl();

// === 8. XÓA DỮ LIỆU CŨ (TÙY CHỌN) ===
async function cleanOldData() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    try {
        const snapshot = await firestore.collection('history_data')
            .where('timestamp', '<', thirtyDaysAgo)
            .get();
        
        if (snapshot.empty) {
            console.log('✅ Không có dữ liệu cũ cần xóa');
            return;
        }
        
        const batch = firestore.batch();
        snapshot.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        
        console.log(`🗑️ Đã xóa ${snapshot.size} bản ghi cũ hơn 30 ngày`);
    } catch (error) {
        console.error('❌ Lỗi xóa dữ liệu cũ:', error);
    }
}

// Xóa dữ liệu cũ mỗi 24h
setInterval(cleanOldData, 24 * 60 * 60 * 1000);

// === 9. XỬ LÝ TẮT SERVER AN TOÀN ===
process.on('SIGINT', () => {
    console.log('\n⚠️ Đang tắt server...');
    client.end();
    process.exit(0);
});

console.log('🚀 Server Node.js đã khởi động!');
console.log('⏰ Lưu Firestore mỗi 30 giây');
console.log('📦 Collection: history_data');
console.log('🔄 Điều khiển 2 chiều: Web ↔ MCU');