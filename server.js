// 🛠️ ฟังก์ชันบันทึกลง Google Sheets (ปรับให้ Follow Redirect ได้ชัวร์)
async function saveToGoogleSheet(data) {
    if (!GOOGLE_SHEET_URL) return;
    try {
        const url = `${GOOGLE_SHEET_URL}?pm25=${data.pm25}&gas=${data.gas}&temp=${data.temp}`;
        await axios.get(url, {
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });
        console.log("✅ บันทึกลง Google Sheet สำเร็จ!");
    } catch (err) {
        console.error("❌ Save to Sheet Error:", err.message);
    }
}
