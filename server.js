const express = require('express');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

const FILE = './data.json';

// ✅ Web Tools User ID (no OAuth needed)
const USPS_WEBTOOLS_USERID = '698HAWTP01J45'; // Replace with your Web Tools User ID

// 🔔 Push notification setup
webpush.setVapidDetails(
  'mailto:you@example.com',
  'BGeKJeLpzO5bY1UyLtXG2vQ85X0-oPA7Jpx_KbvQ3qpHDrFt8-D3dvYdwGZCqcObdel2gnNj3tL1TupT_TiePNk',
  'wTLcaFiaQXg8ERKP5QHEJDXCu6pF_erePqFcn5Evk_U'
);

let data = { active: [], delivered: [] };
let subscribers = [];

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 🔐 Login endpoint
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === 'track123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
});

// 🔔 Push subscription endpoint
app.post('/subscribe', (req, res) => {
  subscribers.push(req.body);
  res.status(201).json({});
});

function sendPushToAll(title, body) {
  subscribers.forEach(sub => {
    webpush.sendNotification(sub, JSON.stringify({ title, body }))
      .catch(err => console.error('❌ Push error:', err));
  });
}

function saveData() {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE));
  }
}

function isDelivered(status) {
  return status.toLowerCase().includes("delivered");
}

// ✅ USPS Web Tools Tracking API
async function fetchUSPSStatus(trackingNumber) {
  const xmlRequest = `
    <TrackRequest USERID="${USPS_WEBTOOLS_USERID}">
      <TrackID ID="${trackingNumber}"></TrackID>
    </TrackRequest>`.trim();

  const url = `https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML=${encodeURIComponent(xmlRequest)}`;

  try {
    const response = await fetch(url);
    const text = await response.text();
    console.log("📦 USPS XML Response:\n", text);

    const match = text.match(/<TrackSummary>(.*?)<\/TrackSummary>/);
    const status = match ? match[1] : "No status found.";
    const etaMatch = text.match(/<ExpectedDeliveryDate>(.*?)<\/ExpectedDeliveryDate>/);
    const eta = etaMatch ? ` • ETA: ${etaMatch[1]}` : '';
    return `${status}${eta}`;
  } catch (err) {
    console.error("❌ USPS Web Tools API error:", err);
    return "Error fetching tracking info.";
  }
}

// ✅ Periodic updates
async function updateStatuses() {
  const updated = [];
  for (let item of data.active) {
    try {
      const status = await fetchUSPSStatus(item.number);
      if (isDelivered(status)) {
        data.delivered.push({ number: item.number, status });
        sendPushToAll("Package Delivered", `Package ${item.number} has been delivered.`);
      } else {
        updated.push({ number: item.number, status });
      }
    } catch (e) {
      console.error("❌ Update error:", e);
    }
  }
  data.active = updated;
  saveData();
}
setInterval(updateStatuses, 1000 * 60 * 5); // Every 5 minutes

// ✅ Add tracking
app.post('/add', async (req, res) => {
  const { number } = req.body;
  const all = [...data.active, ...data.delivered];
  if (!all.some(item => item.number === number)) {
    let status = "Tracking pending...";
    try {
      status = await fetchUSPSStatus(number);
    } catch (e) {
      console.error("❌ Error adding tracking:", e);
    }

    if (isDelivered(status)) {
      data.delivered.push({ number, status });
      sendPushToAll("Package Delivered", `Package ${number} has been delivered.`);
    } else {
      data.active.push({ number, status });
    }
    saveData();
  }
  res.json({ success: true });
});

// ✅ Remove tracking
app.post('/remove', (req, res) => {
  const { number } = req.body;
  data.active = data.active.filter(item => item.number !== number);
  data.delivered = data.delivered.filter(item => item.number !== number);
  saveData();
  res.json({ success: true });
});

// ✅ Get all tracking
app.get('/list', (req, res) => {
  res.json(data);
});

// Start server
loadData();
updateStatuses();
app.listen(PORT, () => console.log(`✅ USPS Tracker running at http://localhost:${PORT}`));
