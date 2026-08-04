const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ URL ของ Google Apps Script Web App
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbxDy8ui92lCzR4Kmm9lWzZxWvKHUg5K7Dn2TWqh-iqHKeiyw4AqsABL_5w0CKsjjXtz/exec';

// 🔋 โครงสร้างข้อมูลเริ่มต้นรองรับ battery
let latestData = { pm25: 0, gas: 0, temp: 0, battery: 0, time: "" };

// ⏱️ ตัวแปรสำหรับเก็บเวลาการแจ้งเตือน LINE ครั้งล่าสุด (Cooldown 1 นาที)
let lastLineAlertTime = 0;

// 📩 1. API รับค่าจาก ESP32
app.post('/api/sensor', (req, res) => {
    const { pm25, gas, temp, battery } = req.body;
    
    // 🇹🇭 บังคับแปลงเวลาให้ออกมาเป็นเวลาไทย (Asia/Bangkok) แม้รันบน Cloud Server
    const now = new Date().toLocaleTimeString('th-TH', { 
        timeZone: 'Asia/Bangkok',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    latestData = { 
        pm25: Number(pm25) || 0, 
        gas: Number(gas) || 0, 
        temp: Number(temp) || 0, 
        battery: Number(battery) || 0, 
        time: now 
    };

    // ตอบกลับ ESP32 ทันที เพื่อป้องกันการเชื่อมต่อค้าง (Timeout)
    res.status(200).json({ status: "Success", data: latestData });

    // 1.1 ส่งข้อมูลไปบันทึกลง Google Sheets แบบเบื้องหลัง
    saveToGoogleSheet(latestData);

    // 1.2 ตรวจพบสภาวะเสี่ยง -> ยิง LINE (Gas > 1200 และ PM2.5 >= 300 พร้อมกัน)
    if (latestData.gas > 1200 && latestData.pm25 >= 300) {
        const currentTime = Date.now();
        
        // ⏳ เว้นระยะแจ้งเตือน LINE อย่างน้อย 1 นาที (60,000 ms)
        if (currentTime - lastLineAlertTime >= 60000) {
            sendLineNotification(latestData);
            lastLineAlertTime = currentTime; // อัปเดตเวลาแจ้งเตือนล่าสุด
        } else {
            console.log("⏳ ข้ามการส่ง LINE: ยังไม่พ้นระยะ Cooldown 1 นาที");
        }
    }
});

// 🌐 2. API สำหรับ Dashboard (ดึงค่าล่าสุด + ประวัติตรวจพบ + 20 ค่าล่าสุดสำหรับกราฟ)
app.get('/api/data', async (req, res) => {
    try {
        const [alertHistory, recentLogs] = await Promise.all([
            getHistoryFromGoogleSheet(),
            getRecentLogsFromGoogleSheet() // ดึง 20 รายการล่าสุดสำหรับกราฟ
        ]);

        res.json({ 
            latest: latestData, 
            history: alertHistory,
            recent: recentLogs
        });
    } catch (err) {
        console.error("API /api/data Error:", err.message);
        res.json({
            latest: latestData,
            history: [],
            recent: []
        });
    }
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
            
            // แปลงค่าเวลา timestamp หากส่งเป็น string หรือ Date
            let currentTimeMs = 0;
            if (row.timestamp) {
                currentTimeMs = new Date(row.timestamp).getTime() || Number(row.timestamp) || 0;
            }

            // 🟢 เงื่อนไข: ต้องเกินทั้ง Gas (>1200) และ PM2.5 (>=300) พร้อมกัน
            if (gasVal > 1200 && pm25Val >= 300) {
                if (lastAlertTime === 0 || (currentTimeMs - lastAlertTime) >= 300000) {
                    alertHistory.push(row);
                    if (currentTimeMs > 0) {
                        lastAlertTime = currentTimeMs;
                    }
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

// ฟังก์ชันยิง LINE Notification (แสดงระดับแบตเตอรี่ด้วย)
async function sendLineNotification(data) {
    const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const userId = process.env.LINE_TARGET_ID;

    if (!token || !userId) {
        console.log("⚠️ ข้ามการส่ง LINE: ไม่พบ Token หรือ Target ID ใน .env");
        return;
    }

    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages: [{
                type: "text",
                text: `🚨 [SMOKE GUARD A1] ตรวจพบสภาวะเสี่ยง!\n💨 PM2.5: ${data.pm25} µg/m³\n🧪 Gas: ${data.gas}\n🌡️ Temp: ${data.temp} °C\n🔋 Battery: ${data.battery}%\n🕒 เวลา: ${data.time}`
            }]
        }, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });
        console.log("📲 ส่งการแจ้งเตือน LINE เรียบร้อย!");
    } catch (err) {
        console.error("LINE Send Error:", err.message);
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
