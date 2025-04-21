const express = require('express');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const USPS_USER_ID = '698HAWTP01J45';
const FILE = './data.json';

// 🔐 VAPID keys for push
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

// ✅ Secure shared password login
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === 'track123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
});

// ✅ Subscribe to push notifications
app.post('/subscribe', (req, res) => {
  subscribers.push(req.body);
  res.status(201).json({});
});

// ✅ Send push to all
function sendPushToAll(title, body) {
  subscribers.forEach(sub => {
    webpush.sendNotification(sub, JSON.stringify({ title, body }))
      .catch(err => console.error('❌ Push error:', err));
  });
}

// ✅ Save/load data
function saveData() {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function loadData() {
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE));
  }
}

// ✅ USPS status helpers
function isDelivered(status) {
  return status.toLowerCase().includes("delivered");
}

function extractETA(xml) {
  const match = xml.match(/<ExpectedDeliveryDate>(.*?)<\/ExpectedDeliveryDate>/);
  return match ? `ETA: ${match[1]}` : '';
}

// ✅ Main USPS fetch function with debug logging
async function fetchUSPSStatus(trackingNumber) {
  const xml = `
    <TrackRequest USERID="${USPS_USER_ID}">
      <TrackID ID="${trackingNumber}"></TrackID>
    </TrackRequest>`.trim();

  const url = `https://secure.shippingapis.com/ShippingAPI.dll?API=TrackV2&XML=${encodeURIComponent(xml)}`;

  try {
    const response = await fetch(url);
    const text = await response.text();
    console.log(`📦 USPS RESPONSE for ${trackingNumber}:\n`, text); // 👈 DEBUG LOG

    const match = text.match(/<TrackSummary>(.*?)<\/TrackSummary>/);
    const status = match ? match[1] : "No status found.";
    const eta = extractETA(text);
    return `${status}${eta ? " • " + eta : ""}`;
  } catch (err) {
    console.error("❌ USPS API Error:", err);
    return "Error fetching status.";
  }
}

// ✅ Auto-refresh USPS status every 5 minutes
async function updateStatuses() {
  const updated = [];
  for (let item of data.active) {
    const status = await fetchUSPSStatus(item.number);
    if (isDelivered(status)) {
      data.delivered.push({ number: item.number, status });
      sendPushToAll("Package Delivered", `Package ${item.number} has been delivered.`);
    } else {
      updated.push({ number: item.number, status });
    }
  }
  data.active = updated;
  saveData();
}

// Run auto-update every 5 minutes
setInterval(updateStatuses, 1000 * 60 * 5);

// ✅ API: Add new tracking number
app.post('/add', async (req, res) => {
  const { number } = req.body;
  const all = [...data.active, ...data.delivered];
  if (!all.some(item => item.number === number)) {
    const status = await fetchUSPSStatus(number);
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

// ✅ API: Remove a tracking number
app.post('/remove', (req, res) => {
  const { number } = req.body;
  data.active = data.active.filter(item => item.number !== number);
  data.delivered = data.delivered.filter(item => item.number !== number);
  saveData();
  res.json({ success: true });
});

// ✅ API: List all tracked items
app.get('/list', (req, res) => {
  res.json(data);
});

// ✅ Load and run the app
loadData();
updateStatuses();
app.listen(PORT, () => console.log(`✅ USPS Tracker running at http://localhost:${PORT}`));
