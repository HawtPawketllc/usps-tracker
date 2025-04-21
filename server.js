const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const webpush = require('web-push');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;
const PASSWORD = 'your-password'; // Replace with your shared password
const DATA_FILE = './data.json';

// USPS OAuth credentials
const USPS_CLIENT_ID = 'ogioN65TFIK0IzdaAduJu0ZijFXdovxHdVxjfpR0AX6c7f6t';
const USPS_CLIENT_SECRET = 'dt7dWjBthEszIZu7o47FzEShh9GOB6caEbilAwQe3jCUHTPcVQslFZ0Divn0vzF5';

let uspsToken = null;
let data = { active: [], delivered: [] };
let subscribers = [];

// VAPID keys for push notifications
webpush.setVapidDetails(
  'mailto:you@example.com',
  'BGeKJeLpzO5bY1UyLtXG2vQ85X0-oPA7Jpx_KbvQ3qpHDrFt8-D3dvYdwGZCqcObdel2gnNj3tL1TupT_TiePNk',
  'wTLcaFiaQXg8ERKP5QHEJDXCu6pF_erePqFcn5Evk_U'
);

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use(session({
  secret: 'hawtpawket-session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 4 } // 4 hours
}));

// Load/save tracking data
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

// Get USPS OAuth token
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

    const json = await res.json();
    uspsToken = json.access_token;
    return uspsToken;
  } catch (err) {
    console.error('❌ Token Error:', err);
    return null;
  }
}

// Fetch USPS tracking info
async function fetchUSPSStatus(trackingNumber) {
  const token = uspsToken || await getUSPSAccessToken();
  if (!token) return "Error: No valid USPS token.";

  try {
    const res = await fetch(`https://api.usps.com/tracking/v3/tracking/${trackingNumber}?expand=DETAIL`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    const json = await res.json();
    if (json?.error?.code) {
      return "Tracking error: " + json.error.code;
    }

    const summary = json?.trackingInfo?.trackingSummary?.eventDescription || "No status found.";
    const eta = json?.trackingInfo?.expectedDeliveryDate;
    return `${summary}${eta ? ` • ETA: ${eta}` : ''}`;
  } catch (err) {
    console.error('❌ USPS fetch error:', err);
    return 'Error fetching tracking info.';
  }
}

// Session login
app.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    req.session.loggedIn = true;
    return res.json({ success: true });
  }
  res.status(401).json({ success: false });
});

// Route protection
app.get('/tracker.html', (req, res) => {
  if (req.session.loggedIn) {
    return res.sendFile(path.join(__dirname, 'public', 'tracker.html'));
  }
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.redirect('/');
  });
});

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

// Add tracking
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

// Remove tracking
app.post('/remove', (req, res) => {
  const { number } = req.body;
  data.active = data.active.filter(item => item.number !== number);
  data.delivered = data.delivered.filter(item => item.number !== number);
  saveData();
  res.json({ success: true });
});

// List tracking
app.get('/list', (req, res) => {
  res.json(data);
});

// Start the server
loadData();
app.listen(PORT, () => {
  console.log(`✅ USPS Tracker with OAuth live at http://localhost:${PORT}`);
});
