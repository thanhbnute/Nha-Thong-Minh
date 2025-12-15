// main.js – PHIÊN BẢN HYBRID (REALTIME + FIRESTORE)

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBS48BmEVVyos7otVkHMVEsB4zeHmgELz8",
  authDomain: "kientrucgiaothuciot.firebaseapp.com",
  databaseURL: "https://kientrucgiaothuciot-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "kientrucgiaothuciot",
  //storageBucket: "kientrucgiaothuciot.firebasestorage.app",
  messagingSenderId: "973537465226",
  appId: "1:973537465226:web:96e8f9cd8b0955b2ceae73",
  measurementId: "G-PRVZ08T1YV"
};

// 1. Load Firebase (App, Database, AND Firestore)
const firebaseScript = document.createElement("script");
firebaseScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js";
firebaseScript.onload = () => {
    const dbScript = document.createElement("script");
    dbScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-database-compat.js";
    dbScript.onload = () => {
        // Load thêm Firestore
        const fsScript = document.createElement("script");
        fsScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-firestore-compat.js";
        fsScript.onload = initFirebase;
        document.head.appendChild(fsScript);
    };
    document.head.appendChild(dbScript);
};
document.head.appendChild(firebaseScript);

let db, firestore;

// Lưu trữ dữ liệu cục bộ
window.realtimeData = { 
    livingroom: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } },
    kitchen: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } },
    bedroom: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } }
};
window.charts = { temp: null, humid: null };

function initFirebase() {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    firestore = firebase.firestore(); // Khởi tạo Firestore

    window.currentRoom = getCurrentRoom();
    
    // Nếu đang ở trong 1 phòng cụ thể, tải lịch sử từ Firestore trước
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

// === TÍNH NĂNG MỚI: TẢI LỊCH SỬ TỪ FIRESTORE ===
function loadHistoryFromFirestore(roomName) {
    console.log(`Đang tải lịch sử Firestore cho phòng: ${roomName}...`);
    
    // Query: Lấy collection "history_data", lọc theo phòng, lấy 10 dòng mới nhất
    firestore.collection("history_data")
        .where("room", "==", roomName) // Lọc theo tên phòng
        .orderBy("timestamp", "desc")  // Lấy mới nhất trước
        .limit(10)
        .get()
        .then((querySnapshot) => {
            const temps = [];
            const humids = [];
            const labels = [];

            querySnapshot.forEach((doc) => {
                const data = doc.data();
                // Convert Timestamp Firestore sang giờ VN
                let timeStr = "00:00";
                if (data.timestamp && data.timestamp.toDate) {
                    timeStr = data.timestamp.toDate().toLocaleTimeString('vi-VN');
                }
                
                // Đẩy vào mảng tạm
                temps.push(data.temp);
                humids.push(data.humidity);
                labels.push(timeStr);
            });

            // Vì lấy desc (mới -> cũ) nên cần đảo ngược lại để vẽ biểu đồ (cũ -> mới)
            window.realtimeData[roomName].history.labels = labels.reverse();
            window.realtimeData[roomName].history.temp = temps.reverse();
            window.realtimeData[roomName].history.humidity = humids.reverse();

            console.log("Đã tải xong lịch sử:", window.realtimeData[roomName].history);
            updateCurrentValues(); // Vẽ lại biểu đồ ngay lập tức
        })
        .catch((error) => {
            console.error("Lỗi tải Firestore (Có thể do thiếu Index hoặc chưa tạo Data):", error);
            // Gợi ý: Nếu thấy lỗi 'The query requires an index', hãy mở Console trình duyệt click vào link để tạo Index.
        });
}

function startRealtimeListeners() {
    ["livingroom", "kitchen", "bedroom"].forEach(room => {
        // Lắng nghe dữ liệu cảm biến mới nhất
        db.ref(`rooms/${room}/sensors`).on("value", snap => {
            const newSensors = snap.val() || {};
            window.realtimeData[room].sensors = newSensors;
            
            if (window.currentRoom === room) {
                // Khi có dữ liệu mới từ Realtime, ta đẩy tiếp vào mảng lịch sử đang có
                const history = window.realtimeData[room].history;
                const time = new Date().toLocaleTimeString('vi-VN');
                
                history.labels.push(time);
                history.temp.push(newSensors.temp || 0);
                history.humidity.push(newSensors.humidity || 0);

                // Giới hạn hiển thị 15 điểm (cả cũ lẫn mới) để biểu đồ không bị dày đặc
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

    // Update text
    if (document.querySelector('.val-temp')) document.querySelector('.val-temp').innerText = `${s.temp || '--'} °C`;
    if (document.querySelector('.val-humid')) document.querySelector('.val-humid').innerText = `${s.humidity || '--'} %`;
    
    // Update Extra Info Text
    if (document.querySelector('.light-text') && s.light !== undefined) 
        document.querySelector('.light-text').innerText = `Ánh sáng: ${s.light} Lux`;
    if (document.querySelector('.gas-text') && s.gas !== undefined) 
        document.querySelector('.gas-text').innerText = `Khí gas: ${s.gas} %`;

    // Update Gauge
    if (room !== "kitchen") {
        const percent = Math.min(((s.light || 0) / 1000) * 100, 100);
        const gauge = document.querySelector('.light-gauge');
        if (gauge) gauge.style.background = `conic-gradient(#ffc107 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
    } else {
        const percent = s.gas || 0;
        const gauge = document.querySelector('.gas-gauge');
        if (gauge) gauge.style.background = `conic-gradient(#e74c3c 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
    }

    // Vẽ Chart
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
                        borderWidth: 2, 
                        pointRadius: 3, 
                        tension: 0.3, 
                        fill: true 
                    }]
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false, 
                    plugins: { legend: { display: false } }, 
                    scales: { y: { suggestedMin: minY, suggestedMax: maxY } },
                    animation: { duration: 0 } // Tắt animation để cập nhật mượt hơn
                }
            });
        } else {
            window.charts[id].data.labels = h.labels;
            window.charts[id].data.datasets[0].data = dataArr;
            window.charts[id].update();
        }
    };

    createOrUpdateChart('chartTemp', 'Nhiệt độ', h.temp, '#e74c3c', 'rgba(231, 76, 60, 0.2)', 20, room === 'kitchen' ? 50 : 40);
    createOrUpdateChart('chartHumid', 'Độ ẩm', h.humidity, '#27ae60', 'rgba(39, 174, 96, 0.2)', 40, 90);
}

function updateDeviceStatus() {
    const devices = window.realtimeData[window.currentRoom]?.devices || {};
    Object.keys(devices).forEach(name => {
        const btn = document.getElementById(`btn-${name}`);
        const icon = document.getElementById(`${name}-icon` ) || document.getElementById(`${name}-icon`); // Fallback
        
        if (!btn) return;
        
        // Logic hiển thị icon đặc thù cho từng loại
        let iconName = name; 
        if(name === "fankc") iconName = "fankc"; // mapping tên nếu cần

        const imgElement = document.getElementById(`${iconName}-icon`);

        if (devices[name] === true) {
            btn.innerText = "ON";
            btn.classList.add("on");
            if(imgElement) imgElement.src = `image/icon_${iconName}_on.gif`; // Dùng gif khi on
        } else {
            btn.innerText = "OFF";
            btn.classList.remove("on");
            if(imgElement) imgElement.src = `image/icon_${iconName}_off.png`;
        }
    });
}

function toggleDevice(btn) {
    let deviceName = btn.id.replace("btn-", "");
    const current = window.realtimeData[window.currentRoom]?.devices?.[deviceName] ?? false;
    db.ref(`rooms/${window.currentRoom}/devices/${deviceName}`).set(!current);
}

// Đồng hồ
function startClock() {
    setInterval(() => {
        const t = new Date().toLocaleTimeString('vi-VN');
        const el = document.getElementById("time");
        if (el) el.innerText = t;
    }, 1000);
}

// ===  HOME SYNC ===
function startHomeRealtimeSync() {
    if (!location.pathname.includes("index.html") && location.pathname !== "/") return;

    ["livingroom", "kitchen", "bedroom"].forEach(room => {
        db.ref(`rooms/${room}/sensors`).on("value", snap => {
            const data = snap.val() || {};
            
            // Selector mapping
            let childIndex = 1;
            if (room === "kitchen") childIndex = 2;
            if (room === "bedroom") childIndex = 3;

            const info = document.querySelector(`.rooms-container .room-card:nth-child(${childIndex})`);
            if (!info) return;

            info.querySelector(".temp").innerText = `${data.temp || '--'} °C`;
            info.querySelector(".humid").innerText = `${data.humidity || '--'} %`;
            
            const extraEl = info.querySelector(".extra");
            if (room === "kitchen") {
                extraEl.innerText = `${data.gas || '--'} %`;
            } else {
                extraEl.innerText = `${data.light || '--'} Lux`;
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
