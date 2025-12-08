// main.js – PHIÊN BẢN HOÀN CHỈNH FIX GIÁ TRỊ + CHART REALTIME
const firebaseConfig = {
    apiKey: "AIzaSyDQz68ykPR1dCcTXDeyaPjKKk3IoMv_HHA",
    authDomain: "smart-home-66573.firebaseapp.com",
    databaseURL: "https://smart-home-66573-default-rtdb.firebaseio.com",
    projectId: "smart-home-66573",
    storageBucket: "smart-home-66573.firebasestorage.app",
    messagingSenderId: "373407938226",
    appId: "1:373407938226:web:8ff2e7758d313353eb7bab"
};

// Load Firebase từ CDN
const firebaseScript = document.createElement("script");
firebaseScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-app-compat.js";
firebaseScript.onload = () => {
    const dbScript = document.createElement("script");
    dbScript.src = "https://www.gstatic.com/firebasejs/10.14.0/firebase-database-compat.js";
    dbScript.onload = initFirebase;
    document.head.appendChild(dbScript);
};
document.head.appendChild(firebaseScript);

let db;
window.realtimeData = { 
    bedroom: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } },
    livingroom: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } },
    kitchen: { sensors: {}, devices: {}, history: { labels: [], temp: [], humidity: [] } } 
};
window.charts = { temp: null, humid: null };

function initFirebase() {
    firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    window.currentRoom = getCurrentRoom();
    startRealtimeListeners();
    setTimeout(() => { updateCurrentValues(); updateDeviceStatus(); }, 800);
    // THÊM: Gọi sync cho trang Home nếu đang ở Home
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

function startRealtimeListeners() {
    ["bedroom", "livingroom", "kitchen"].forEach(room => {
        db.ref(`rooms/${room}/sensors`).on("value", snap => {
            const newSensors = snap.val() || {};
            window.realtimeData[room].sensors = newSensors;
            if (window.currentRoom === room) {
                // Push vào history tạm (max 6 points)
                const history = window.realtimeData[room].history;
                const time = new Date().toLocaleTimeString();
                history.labels.push(time);
                history.temp.push(newSensors.temp || 0);
                history.humidity.push(newSensors.humidity || 0);
                if (history.labels.length > 6) {
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
    const s = window.realtimeData[room]?.sensors || {};
    const h = window.realtimeData[room]?.history || { labels: [], temp: [], humidity: [] };

    // Update text values
    if (document.querySelector('.val-temp')) document.querySelector('.val-temp').innerText = `${s.temp || '--'} °C`;
    if (document.querySelector('.val-humid')) document.querySelector('.val-humid').innerText = `${s.humidity || '--'} %`;
    if (document.querySelector('.light-text')) document.querySelector('.light-text').innerText = `Ánh sáng: ${s.light || 0} Lux`;
    if (document.querySelector('.gas-text')) document.querySelector('.gas-text').innerText = `Khí gas: ${s.gas || 0} %`;

    // Update gauge
    if (room !== "kitchen") {
        const percent = Math.min(((s.light || 0) / 1000) * 100, 100); // Fix: max 1000 Lux = 100%
        const gauge = document.querySelector('.light-gauge');
        if (gauge) gauge.style.background = `conic-gradient(#ffc107 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
    } else {
        const percent = s.gas || 0;
        const gauge = document.querySelector('.gas-gauge');
        if (gauge) gauge.style.background = `conic-gradient(#e74c3c 0% ${percent}%, #e0e0e0 ${percent}% 100%)`;
    }

    // Create/Update charts (realtime with history)
    const createOrUpdateChart = (id, label, dataArr, borderColor, bgColor, minY, maxY) => {
        const ctx = document.getElementById(id)?.getContext('2d');
        if (!ctx) return;
        if (!window.charts[id]) {
            window.charts[id] = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: h.labels,
                    datasets: [{ label, data: dataArr, borderColor, backgroundColor: bgColor, borderWidth: 3, pointBackgroundColor: borderColor, pointRadius: 4, tension: 0.4, fill: false }]
                },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { suggestedMin: minY, suggestedMax: maxY } } }
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

// Đồng hồ
function startClock() {
    setInterval(() => {
        const t = new Date().toTimeString().slice(0,8);
        const el = document.getElementById("time");
        if (el) el.innerText = t;
    }, 1000);
}
// ===  HOME: Đồng bộ realtime 3 phòng ===
function startHomeRealtimeSync() {
    if (!location.pathname.includes("index.html") && location.pathname !== "/") return;

    ["bedroom", "livingroom", "kitchen"].forEach(room => {
        db.ref(`rooms/${room}/sensors`).on("value", snap => {
            const data = snap.val() || {};
            const temp = data.temp !== undefined ? data.temp : '--';
            const humid = data.humidity !== undefined ? data.humidity : '--';
            const light = data.light !== undefined ? data.light : '--';
            const gas = data.gas !== undefined ? data.gas : '--';

            // Tìm card tương ứng
            let selector;
            if (room === "livingroom")  selector = ".rooms-container .room-card:nth-child(1)";
            if (room === "kitchen")     selector = ".rooms-container .room-card:nth-child(2)";
            if (room === "bedroom")     selector = ".rooms-container .room-card:nth-child(3)";
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

// Khởi động
document.addEventListener("DOMContentLoaded", startClock);