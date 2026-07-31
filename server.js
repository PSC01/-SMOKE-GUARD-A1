const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ URL ของ Google Apps Script Web App สำหรับบันทึกลง Google Sheets
const GOOGLE_SHEET_URL = 'https://script.google.com/macros/s/AKfycbw9_RqA2wLk_j3sre8LDeYSki7kKRzU8DMb-Y7oD80iaGKgSWfJfO-FsrDK2tRxITXB/exec';

let latestData = { pm25: 0, gas: 0, temp: 0, time: "" };
let history = [];

// API รับค่าจาก ESP32
app.post('/api/sensor', async (req, res) => {
    const { pm25, gas, temp } = req.body;
    const now = new Date().toLocaleTimeString('th-TH');
    
    latestData = { pm25, gas, temp, time: now };
    
    history.push(latestData);
    if (history.length > 20) history.shift();

    // 1. ส่งข้อมูลไปบันทึกลง Google Sheets
    saveToGoogleSheet(latestData);

    // 2. ตรวจพบบุหรี่ไฟฟ้า -> ยิง LINE (ปรับแก๊สเป็น > 1200)
    if (gas > 1200 || pm25 >= 300) {
        sendLineNotification(latestData);
    }

    res.status(200).json({ status: "Success" });
});

// API สำหรับ Dashboard
app.get('/api/data', (req, res) => {
    res.json({ latest: latestData, history: history });
});

// ฟังก์ชันส่งข้อมูลลง Google Sheets
async function saveToGoogleSheet(data) {
    if (!GOOGLE_SHEET_URL) return;
    try {
        await axios.post(GOOGLE_SHEET_URL, data);
        console.log("บันทึกลง Google Sheet เรียบร้อย");
    } catch (err) {
        console.error("Save to Sheet Error:", err.message);
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
                text: `🚨 [SMOKE GUARD A1] ตรวจพบบุหรี่ไฟฟ้า!\n💨 PM2.5: ${data.pm25} µg/m³\n🧪 Gas: ${data.gas}\n🌡️ Temp: ${data.temp} °C\n🕒 เวลา: ${data.time}`
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
