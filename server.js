const express = require('express');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ USPS API credentials
const USPS_CONSUMER_KEY = 'ogioN65TFIK0IzdaAduJu0ZijFXdovxHdVxjfpR0AX6c7f6t';
const USPS_CONSUMER_SECRET = 'dt7dWjBthEszIZu7o47FzEShh9GOB6caEbilAwQe3jCUHTPcVQslFZ0Divn0vzF5';

const FILE = './data.json';

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

// 🔐 Simple password login
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === 'track123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
});

// 🔔 Subscribe to push notifications
app.post('/subscribe', (req, res) => {
  subscribers.push(req.body);
  res.status(201).json({});
});

// ✅ Push to all subscribers
function sendPushToAll(title, body) {
  subscribers.forEach(sub => {
    webpush.sendNotification(sub, JSON.stringify({ title, body }))
      .catch(err => console.error('❌ Push error:', err));
  });
}

// ✅ Load/save tracking data
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

function extractETA(info) {
  return info?.estimatedDeliveryDate || '';
}

// ✅ Step 1: Get USPS token
async function getUSPSAccessToken() {
  const credentials = Buffer.from(`${USPS_CONSUMER_KEY}:${USPS_CONSUMER_SECRET}`).toString('base64');

  const response = await fetch('https://api.usps.com/oauth2/v1/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    },
    body: 'grant_type=client_credentials'
  });

  const text = await response.text();
  console.log("🔐 USPS OAuth Response:\n", text);

  try {
    const data = JSON.parse(text);
    return data.access_token || null;
  } catch (e) {
    console.error("❌ USPS token JSON parse error:", e);
    return null;
  }
}



// ✅ Step 2: Fetch tracking status using token
async function fetchUSPSStatus(trackingNumber) {
  const token = await getUSPSAccessToken();
  if (!token) return "Unable to authenticate with USPS.";

  try {
    const response = await fetch('https://api.usps.com/tracking/v1/track', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ trackingNumber })
    });

    const text = await response.text();
    console.log("📦 USPS Tracking Response:\n", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return "USPS tracking response could not be parsed.";
    }

    const info = data?.trackInfo?.[0];
    const status = info?.status || "No status found.";
    const eta = extractETA(info);
    return `${status}${eta ? " • ETA: " + eta : ""}`;
  } catch (err) {
    console.error("❌ USPS fetch error:", err);
    return "Error fetching tracking info.";
  }
}

// ✅ Auto refresh all tracking statuses
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
      console.error("❌ Update failed:", e);
    }
  }
  data.active = updated;
  saveData();
}

setInterval(updateStatuses, 1000 * 60 * 5); // every 5 mins

// ✅ Add a new tracking number
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

// ✅ Remove a tracking number
app.post('/remove', (req, res) => {
  const { number } = req.body;
  data.active = data.active.filter(item => item.number !== number);
  data.delivered = data.delivered.filter(item => item.number !== number);
  saveData();
  res.json({ success: true });
});

// ✅ Get all tracked numbers
app.get('/list', (req, res) => {
  res.json(data);
});

// 🔄 Init
loadData();
updateStatuses();

app.listen(PORT, () => console.log(`✅ USPS Tracker running on http://localhost:${PORT}`));
