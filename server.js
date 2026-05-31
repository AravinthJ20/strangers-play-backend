require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const socketIo = require('socket.io');
const connectDB = require('./config/db');
const { corsOrigins, port, statusFeatureEnabled } = require('./config/env');
const socketManager = require('./socket/socketManager');

const app = express();
const corsOptions = {
  origin: corsOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true
};
const server = http.createServer(app);
const io = socketIo(server, {
  cors: corsOptions
});

connectDB();

app.use(express.json({ limit: '25mb' }));
app.use(cors(corsOptions));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/user'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/groups', require('./routes/group'));
if (statusFeatureEnabled) {
  app.use('/api/status', require('./routes/status'));
}

socketManager(io);

app.get('/', (req, res) => {
  res.json({ message: 'Strangers Play backend is running' });
});

server.listen(port, () => console.log(`Backend listening on port ${port}`));
