const express = require('express');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const USPS_USER_ID = '698HAWTP01J45'; // Deprecated - not used in new API
const FILE = './data.json';

// ✅ New USPS API credentials
const USPS_CONSUMER_KEY = 'ogioN65TFIK0IzdaAduJu0ZijFXdovxHdVxjfpR0AX6c7f6t';
const USPS_CONSUMER_SECRET = 'dt7dWjBthEszIZu7o47FzEShh9GOB6caEbilAwQe3jCUHTPcVQslFZ0Divn0vzF5';

// ✅ VAPID keys for push
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

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === 'track123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, error: 'Unauthorized' });
  }
});

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

function extractETA(data) {
  return data?.trackInfo?.[0]?.estimatedDeliveryDate || '';
}

async function getUSPSAccessToken() {
  const credentials = Buffer.from(`${USPS_CONSUMER_KEY}:${USPS_CONSUMER_SECRET}`).toString('base64');

  const response = await fetch('https://api.usps.com/oauth2/v1/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();
  if (!data.access_token) {
    console.error("❌ Failed to get USPS token:", data);
    return null;
  }
  return data.access_token;
}

async function fetchUSPSStatus(trackingNumber) {
  const token = await getUSPSAccessToken();
  if (!token) return "Unable to authenticate with USPS.";

  const response = await fetch('https://api.usps.com/tracking/v1/track', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ trackingNumber })
  });

  const data = await response.json();
  console.log("📦 USPS Tracking Response:", data);

  const status = data?.trackInfo?.[0]?.status || "No status found.";
  const eta = extractETA(data);
  return `${status}${eta ? " • ETA: " + eta : ""}`;
}

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

setInterval(updateStatuses, 1000 * 60 * 5);

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

app.post('/remove', (req, res) => {
  const { number } = req.body;
  data.active = data.active.filter(item => item.number !== number);
  data.delivered = data.delivered.filter(item => item.number !== number);
  saveData();
  res.json({ success: true });
});

app.get('/list', (req, res) => {
  res.json(data);
});

loadData();
updateStatuses();
app.listen(PORT, () => console.log(`✅ USPS Tracker running at http://localhost:${PORT}`));
