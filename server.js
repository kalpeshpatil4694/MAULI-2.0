const express = require('express');
const app = express();
const port = 3000;
const wifi = require('node-wifi');

app.use(express.json());

// Initialize wifi
wifi.init({
  iface: null
});

// Get wifi networks
app.get('/networks', (req, res) => {
  wifi.scan().then((networks) => {
    res.json(networks);
  }).catch((err) => {
    res.status(500).json({ message: 'Error scanning wifi networks' });
  });
});

// Connect to wifi network
app.post('/connect', (req, res) => {
  const { ssid, password } = req.body;
  wifi.connect({ ssid, password }).then(() => {
    res.json({ message: 'Connected to wifi network' });
  }).catch((err) => {
    res.status(500).json({ message: 'Error connecting to wifi network' });
  });
});

// Start server
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
