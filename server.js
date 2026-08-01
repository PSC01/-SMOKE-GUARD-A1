const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ URL ของ Google Apps Script Web App
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbz959K1zMBctZm45I6EF5R4wLRvsBBkuJrsCN5Fc8LH6dzFaFTW8tWISTsx00g1-Sso/exec';

let latestData = { pm25: 0, gas: 0, temp: 0, time: "" };

// 📩 1. API รับค่าจาก ESP32
app.post('/api/sensor', async (req, res) => {
    const { pm25, gas, temp } = req.body;
    const now = new Date().toLocaleTimeString('th-TH');
    
    latestData = { pm25, gas, temp, time: now };

    // 1.1 ส่งข้อมูลไปบันทึกลง Google Sheets
    saveToGoogleSheet(latestData);

    // 1.2 ตรวจพบสภาวะเสี่ยง -> ยิง LINE (Gas > 1200 และ PM2.5 >= 300 พร้อมกัน)
    if (gas > 1200 && pm25 >= 300) {
        sendLineNotification(latestData);
    }

    res.status(200).json({ status: "Success" });
});

// 🌐 2. API สำหรับ Dashboard (ดึงค่าล่าสุด + ประวัติตรวจพบ + 20 ค่าล่าสุดสำหรับกราฟ)
app.get('/api/data', async (req, res) => {
    const [alertHistory, recentLogs] = await Promise.all([
        getHistoryFromGoogleSheet(),
        getRecentLogsFromGoogleSheet() // ดึง 20 รายการล่าสุดสำหรับกราฟ
    ]);

    res.json({ 
        latest: latestData, 
        history: alertHistory,
        recent: recentLogs
    });
});

// -------------------------------------------------------------
// 🛠️ Helper Functions
// -------------------------------------------------------------

// 🛠️ ฟังก์ชันส่งข้อมูลลง Google Sheets
async function saveToGoogleSheet(data) {
    if (!GOOGLE_SHEET_URL) return;
    try {
        const url = `${GOOGLE_SHEET_URL}?pm25=${data.pm25}&gas=${data.gas}&temp=${data.temp}`;
        await axios.get(url);
        console.log("✅ บันทึกลง Google Sheet สำเร็จ!");
    } catch (err) {
        console.error("❌ Save to Sheet Error:", err.message);
    }
}

// ฟังก์ชันดึงประวัติตรวจพบจาก Google Sheets (พร้อมกรอง Cooldown 5 นาที)
async function getHistoryFromGoogleSheet() {
    if (!GOOGLE_SHEET_URL) return [];
    try {
        const response = await axios.get(GOOGLE_SHEET_URL);
        const allData = Array.isArray(response.data) ? response.data : [];
        
        let alertHistory = [];
        let lastAlertTime = 0;

        allData.forEach(row => {
            const pm25Val = Number(row.pm25) || 0;
            const gasVal = Number(row.gas) || 0;
            const currentTimeMs = row.timestamp || 0;

            // 🟢 แก้ไขเงื่อนไข: ต้องเกินทั้ง Gas (>1200) และ PM2.5 (>=300) พร้อมกันเท่านั้น
            if (gasVal > 1200 && pm25Val >= 300) {
                if (lastAlertTime === 0 || (currentTimeMs - lastAlertTime) >= 300000) {
                    alertHistory.push(row);
                    lastAlertTime = currentTimeMs;
                }
            }
        });

        // เอาประวัติรายการใหม่อยู่บนสุด
        return alertHistory.reverse();
    } catch (err) {
        console.error("Get Sheet History Error:", err.message);
        return [];
    }
}

// 🟢 ฟังก์ชันดึง 20 ค่าล่าสุดจาก Google Sheets สำหรับวาดกราฟ
async function getRecentLogsFromGoogleSheet() {
    if (!GOOGLE_SHEET_URL) return [];
    try {
        const response = await axios.get(GOOGLE_SHEET_URL);
        const data = Array.isArray(response.data) ? response.data : [];
        // ตัดเอาเฉพาะ 20 รายการล่าสุด
        return data.slice(-20);
    } catch (err) {
        console.error("Get Recent Logs Error:", err.message);
        return [];
    }
}

// ฟังก์ชันยิง LINE Notification
async function sendLineNotification(data) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const userId = process.env.LINE_TARGET_ID;

    if (!token || !userId) return;

    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
                type: "text",
                text: `🚨 [SMOKE GUARD A1] ตรวจพบสภาวะเสี่ยง!\n💨 PM2.5: ${data.pm25} µg/m³\n🧪 Gas: ${data.gas}\n🌡️ Temp: ${data.temp} °C\n🕒 เวลา: ${data.time}`
            }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
    } catch (err) {
        console.error("LINE Send Error:", err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
