const express = require('express');
const fs = require('fs');
const cors = require('cors');
const fetch = require('node-fetch');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = './data.json';

// Replace with your USPS OAuth v3 credentials
const USPS_CLIENT_ID = 'ogioN65TFIK0IzdaAduJu0ZijFXdovxHdVxjfpR0AX6c7f6t';
const USPS_CLIENT_SECRET = 'dt7dWjBthEszIZu7o47FzEShh9GOB6caEbilAwQe3jCUHTPcVQslFZ0Divn0vzF5';

// Web push config (replace with your real keys)
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

// Push subscription
app.post('/subscribe', (req, res) => {
  subscribers.push(req.body);
  res.status(201).json({});
});

function sendPushToAll(title, body) {
  subscribers.forEach(sub => {
    webpush.sendNotification(sub, JSON.stringify({ title, body }))
      .catch(err => console.error('❌ Push Error:', err));
  });
}

// Load & save
function loadData() {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE));
  }
}
function saveData() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}
function isDelivered(status) {
  return status.toLowerCase().includes('delivered');
}

// 🔐 Get USPS access token
let uspsToken = null;
async function getUSPSAccessToken() {
  try {
    const res = await fetch('https://apis.usps.com/oauth2/v3/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: USPS_CLIENT_ID,
        client_secret: USPS_CLIENT_SECRET
      })
    });

    const data = await res.json();
    uspsToken = data.access_token;
    return uspsToken;
  } catch (e) {
    console.error('❌ Token error:', e);
    return null;
  }
}

// 📦 Fetch tracking status
async function fetchUSPSStatus(trackingNumber) {
  const token = uspsToken || await getUSPSAccessToken();
  if (!token) return 'Error: no USPS token';

  try {
    const res = await fetch(`https://api.usps.com/tracking/v3/tracking/${trackingNumber}?expand=DETAIL`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const data = await res.json();
    const summary = data?.trackingInfo?.trackingSummary?.eventDescription || "No status found.";
    const eta = data?.trackingInfo?.expectedDeliveryDate;
    return `${summary}${eta ? ` • ETA: ${eta}` : ''}`;
  } catch (err) {
    console.error('❌ USPS fetch error:', err);
    return 'Error fetching tracking info';
  }
}

// 🔁 Auto-update statuses
async function updateStatuses() {
  const updated = [];
  for (let item of data.active) {
    const status = await fetchUSPSStatus(item.number);
    if (isDelivered(status)) {
      data.delivered.push({ number: item.number, name: item.name, status });
      sendPushToAll('Package Delivered', `${item.name || item.number} has been delivered.`);
    } else {
      updated.push({ number: item.number, name: item.name, status });
    }
  }
  data.active = updated;
  saveData();
}
setInterval(updateStatuses, 1000 * 60 * 5);

// 📥 Add tracking
app.post('/add', async (req, res) => {
  const { number, name } = req.body;
  const exists = [...data.active, ...data.delivered].some(item => item.number === number);
  if (!exists) {
    const status = await fetchUSPSStatus(number);
    const entry = { number, name, status };
    if (isDelivered(status)) {
      data.delivered.push(entry);
      sendPushToAll('Package Delivered', `${name || number} has been delivered.`);
    } else {
      data.active.push(entry);
    }
    saveData();
  }
  res.json({ success: true });
});

// 🗑 Remove tracking
app.post('/remove', (req, res) => {
  const { number } = req.body;
  data.active = data.active.filter(item => item.number !== number);
  data.delivered = data.delivered.filter(item => item.number !== number);
  saveData();
  res.json({ success: true });
});

// 📤 Get list
app.get('/list', (req, res) => {
  res.json(data);
});

// 🔐 Login check
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === 'track123') {
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false });
  }
});


// 🔄 Start server
loadData();
updateStatuses();
app.listen(PORT, () => {
  console.log(`✅ USPS Tracker running at http://localhost:${PORT}`);
});
