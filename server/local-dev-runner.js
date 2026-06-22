const express = require('express');
const serverlessHandler = require('./api/brew.js');
const app = express();
app.use(express.json({ limit: '2mb' }));
app.post('/api/brew', serverlessHandler);
app.listen(5000, () => console.log('🛡️ Local Serverless API Environment simulator running on port 5000'));