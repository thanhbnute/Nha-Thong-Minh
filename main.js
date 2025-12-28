// main.js – HYBRID AUTO-SAVE TO FIRESTORE + FALLBACK

const firebaseConfig = {
    apiKey: "AIzaSyDQz68ykPR1dCcTXDeyaPjKKk3IoMv_HHA",
    authDomain: "smart-home-66573.firebaseapp.com",
    databaseURL: "https://smart-home-66573-default-rtdb.firebaseio.com",
    projectId: "smart-home-66573",
    storageBucket: "smart-home-66573.firebasestorage.app",
    messagingSenderId: "373407938226",
    appId: "1:373407938226:web:8ff2e7758d313353eb7bab"
};

// Load Firebase
const firebaseScript = document.createElement("script");
firebaseScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js";
firebaseScript.onload = () => {
    const dbScript = document.createElement("script");
    dbScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-database-compat.js";
    dbScript.onload = () => {
        const fsScript = document.createElement("script");
        fsScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore-compat.js";
        fsScript.onload = initFirebase;
        document.head.appendChild(fsScript);
    };
    document.head.appendChild(dbScript);
};
document.head.appendChild(firebaseScript);

let db, firestore;
let lastSaveTime = {}; // Theo dõi lần lưu cuối mỗi phòng

window.realtimeData = { 
    livingroom: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } },
    kitchen: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } },
    bedroom: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } }
};
window.charts = { temp: null, humid: null };

function initFirebase() {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    firestore = firebase.firestore();

    window.currentRoom = getCurrentRoom();
    
    if (window.currentRoom) {
        loadHistoryFromFirestore(window.currentRoom);
    }

    startRealtimeListeners();
    setTimeout(() => { updateDeviceStatus(); }, 800);
    
    if (!window.currentRoom) {
        startHomeRealtimeSync();
    }
}

function getCurrentRoom() {
    const path = location.pathname.toLowerCase();
    if (path.includes("bedroom")) return "bedroom";
    if (path.includes("livingroom")) return "livingroom";
    if (path.includes("kitchen")) return "kitchen";
    return null;
}

// === TẢI LỊCH SỬ TỪ FIRESTORE (KHI KHỞI ĐỘNG) ===
function loadHistoryFromFirestore(roomName) {
    console.log(`📊 Đang tải lịch sử Firestore cho phòng: ${roomName}...`);
    
    firestore.collection("history_data")
        .where("room", "==", roomName)
        .orderBy("timestamp", "desc")
        .limit(15)
        .get()
        .then((querySnapshot) => {
            const temps = [];
            const humids = [];
            const labels = [];

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                let timeStr = "00:00";
                if (data.timestamp && data.timestamp.toDate) {
                    timeStr = data.timestamp.toDate().toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'});
                }
                
                temps.push(data.temp || 0);
                humids.push(data.humidity || 0);
                labels.push(timeStr);
            });

            window.realtimeData[roomName].history.labels = labels.reverse();
            window.realtimeData[roomName].history.temp = temps.reverse();
            window.realtimeData[roomName].history.humidity = humids.reverse();

            console.log(`✅ Đã tải ${labels.length} điểm dữ liệu từ Firestore`);
            updateCurrentValues();
        })
        .catch((error) => {
            console.error("❌ Lỗi tải Firestore:", error);
            console.log("💡 Cần tạo Composite Index: room + timestamp (desc)");
        });
}

// === AUTO-SAVE TO FIRESTORE (MỖI 30s) ===
function saveToFirestore(roomName, sensorData) {
    const now = Date.now();
    
    // Chỉ lưu mỗi 30s để tránh spam Firestore
    if (lastSaveTime[roomName] && (now - lastSaveTime[roomName]) < 30000) {
        return;
    }
    
    lastSaveTime[roomName] = now;
    
    const dataToSave = {
        room: roomName,
        temp: sensorData.temp || 0,
        humidity: sensorData.humidity || 0,
        light: sensorData.light || 0,
        gas: sensorData.gas || 0,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    
    firestore.collection("history_data")
        .add(dataToSave)
        .then(() => {
            console.log(`💾 [${roomName}] Đã lưu vào Firestore: ${sensorData.temp}°C, ${sensorData.humidity}%`);
        })
        .catch((error) => {
            console.error(`❌ Lỗi lưu Firestore [${roomName}]:`, error);
        });
}

function startRealtimeListeners() {
    ["livingroom", "kitchen", "bedroom"].forEach(room => {
        db.ref(`rooms/${room}/sensors`).on("value", snap => {
            const newSensors = snap.val() || {};
            window.realtimeData[room].sensors = newSensors;
            
            // 🔥 TỰ ĐỘNG LƯU VÀO FIRESTORE
            if (newSensors.temp !== undefined && newSensors.humidity !== undefined) {
                saveToFirestore(room, newSensors);
            }
            
            if (window.currentRoom === room) {
                const history = window.realtimeData[room].history;
                const time = new Date().toLocaleTimeString('vi-VN', {hour: '2-digit', minute: '2-digit'});
                
                history.labels.push(time);
                history.temp.push(newSensors.temp || 0);
                history.humidity.push(newSensors.humidity || 0);

                if (history.labels.length > 15) {
                    history.labels.shift();
                    history.temp.shift();
                    history.humidity.shift();
                }
                updateCurrentValues();
            }
        });

        db.ref(`rooms/${room}/devices`).on("value", snap => {
            window.realtimeData[room].devices = snap.val() || {};
            if (window.currentRoom === room) updateDeviceStatus();
        });
    });
}

function updateCurrentValues() {
    const room = window.currentRoom;
    if (!room) return;

    const s = window.realtimeData[room]?.sensors || {};
    const h = window.realtimeData[room]?.history || { labels: [], temp: [], humidity: [] };

    // Update text values
    if (document.querySelector('.val-temp')) 
        document.querySelector('.val-temp').innerText = `${s.temp || '--'} °C`;
    if (document.querySelector('.val-humid')) 
        document.querySelector('.val-humid').innerText = `${s.humidity || '--'} %`;
    if (document.querySelector('.light-text')) 
        document.querySelector('.light-text').innerText = `Ánh sáng: ${s.light || 0} Lux`;
    if (document.querySelector('.gas-text')) 
        document.querySelector('.gas-text').innerText = `Khí gas: ${s.gas || 0} %`;

    // Update gauge
    if (room !== "kitchen") {
        const percent = Math.min(((s.light || 0) / 1000) * 100, 100);
        const gauge = document.querySelector('.light-gauge');
        if (gauge) gauge.style.background = `conic-gradient(#ffc107 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
    } else {
        const percent = s.gas || 0;
        const gauge = document.querySelector('.gas-gauge');
        if (gauge) gauge.style.background = `conic-gradient(#e74c3c 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
    }

    // Create/Update charts
    const createOrUpdateChart = (id, label, dataArr, borderColor, bgColor, minY, maxY) => {
        const ctx = document.getElementById(id)?.getContext('2d');
        if (!ctx) return;

        if (!window.charts[id]) {
            window.charts[id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: h.labels,
                    datasets: [{ 
                        label, 
                        data: dataArr, 
                        borderColor, 
                        backgroundColor: bgColor, 
                        borderWidth: 3, 
                        pointBackgroundColor: borderColor,
                        pointRadius: 4, 
                        tension: 0.4, 
                        fill: false 
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { display: false } }, 
                    scales: { y: { suggestedMin: minY, suggestedMax: maxY } }
                }
            });
        } else {
            window.charts[id].data.labels = h.labels;
            window.charts[id].data.datasets[0].data = dataArr;
            window.charts[id].update();
        }
    };

    createOrUpdateChart('chartTemp', 'Nhiệt độ', h.temp, '#e74c3c', 'rgba(231, 76, 60, 0.2)', 20, room === 'kitchen' ? 40 : 35);
    createOrUpdateChart('chartHumid', 'Độ ẩm', h.humidity, '#27ae60', 'rgba(39, 174, 96, 0.2)', room === 'kitchen' ? 40 : 50, 70);
}

function updateDeviceStatus() {
    const devices = window.realtimeData[window.currentRoom]?.devices || {};
    Object.keys(devices).forEach(name => {
        const btn = document.getElementById(`btn-${name}`);
        const icon = document.getElementById(`${name}-icon`);
        if (!btn || !icon) return;
        
        if (devices[name] === true) {
            btn.innerText = "ON";
            btn.classList.add("on");
            icon.src = `icon_${name}_on.gif`;
        } else {
            btn.innerText = "OFF";
            btn.classList.remove("on");
            icon.src = `icon_${name}_off.png`;
        }
    });
}

function toggleDevice(btn) {
    let deviceName = btn.id.replace("btn-", "");
    if (deviceName === "alarm") deviceName = "alarm";
    const current = window.realtimeData[window.currentRoom]?.devices?.[deviceName] ?? false;
    db.ref(`rooms/${window.currentRoom}/devices/${deviceName}`).set(!current);
}

function startClock() {
    setInterval(() => {
        const t = new Date().toLocaleTimeString('vi-VN');
        const el = document.getElementById("time");
        if (el) el.innerText = t;
    }, 1000);
}

function startHomeRealtimeSync() {
    if (!location.pathname.includes("index.html") && location.pathname !== "/") return;

    ["livingroom", "kitchen", "bedroom"].forEach(room => {
        db.ref(`rooms/${room}/sensors`).on("value", snap => {
            const data = snap.val() || {};
            const temp = data.temp !== undefined ? data.temp : '--';
            const humid = data.humidity !== undefined ? data.humidity : '--';
            const light = data.light !== undefined ? data.light : '--';
            const gas = data.gas !== undefined ? data.gas : '--';

            let selector;
            if (room === "livingroom") selector = ".rooms-container .room-card:nth-child(1)";
            if (room === "kitchen") selector = ".rooms-container .room-card:nth-child(2)";
            if (room === "bedroom") selector = ".rooms-container .room-card:nth-child(3)";
            
            const info = document.querySelector(selector);
            if (!info) return;

            info.querySelector(".temp").innerText = `Nhiệt độ: ${temp} °C`;
            info.querySelector(".humid").innerText = `Độ ẩm: ${humid} %`;
            
            if (room === "kitchen") {
                info.querySelector(".extra").innerText = `Khí gas: ${gas} %`;
            } else {
                info.querySelector(".extra").innerText = `Ánh sáng: ${light} Lux`;
            }
        });
    });
}

// Navigation
function goHome() { location.href = "index.html"; }
function goBedroom() { location.href = "bedroom.html"; }
function goLiving() { location.href = "livingroom.html"; }
function goKitchen() { location.href = "kitchen.html"; }

document.addEventListener("DOMContentLoaded", startClock);

