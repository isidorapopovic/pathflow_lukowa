// app_new.js — ULTRA MINIMAL TEST

const express = require('express');
const app = express();
const PORT = 4000;

app.get('/', (req, res) => {
    res.send('<h1>HOME: this is / on port 4000</h1><p><a href="/applicant/info">Go to /applicant/info</a></p>');
});

app.get('/applicant/info', (req, res) => {
    console.log('>>> HIT /applicant/info');
    res.send('<h1>TEST: /applicant/info works on port 4000</h1>');
});

app.listen(PORT, () => {
    console.log(`TEST app running at http://localhost:${PORT}`);
});
