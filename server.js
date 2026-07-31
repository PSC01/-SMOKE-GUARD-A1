const express = require('express');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

let latestData = { pm25: 0, gas: 0, temp: 0, time: "" };
let history = [];

// API รับค่าจาก ESP32
app.post('/api/sensor', async (req, res) => {
    const { pm25, gas, temp } = req.body;
    const now = new Date().toLocaleTimeString('th-TH');
    
    latestData = { pm25, gas, temp, time: now };
    
    history.push(latestData);
    if (history.length > 20) history.shift();

    // ตรวจพบบุหรี่ไฟฟ้า -> ยิง LINE
    if (gas > 1500 || pm25 >= 300) {
        sendLineNotification(latestData);
    }

    res.status(200).json({ status: "Success" });
});

// API สำหรับ Dashboard
app.get('/api/data', (req, res) => {
    res.json({ latest: latestData, history: history });
});

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
