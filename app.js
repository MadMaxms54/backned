const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');

// MongoDB connection
mongoose.connect('mongodb+srv://makkakalanguappa:muthu5454@cluster0.zx043tc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// MongoDB Room Schema
const RoomSchema = new mongoose.Schema({
  roomId: String,
  users: Array,
  currentSong: Object,
  queue: Array,
  password: String,
  roomName: String,
  createdAt: String,
  lastActivity: String,
  settings: Object,
  playbackState: Object,
  stats: {
    totalUsers: Number,
    totalSongsPlayed: Number,
    totalPlayTime: Number,
    lastSongPlayed: String
  }
});

const RoomModel = mongoose.model('Room', RoomSchema);

const app = express();
const server = http.createServer(app);

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later'
});

// CORS and middleware
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use('/api/', apiLimiter);

const rooms = {};
const roomStats = {};

// Root Route
app.get('/', (req, res) => {
  res.json({ message: 'Server running', version: '2.0.0' });
});

// Start Room API
app.post('/api/start-room', async (req, res) => {
  const { userId, password, roomName } = req.body;
  if (!userId || userId.length === 0) return res.status(400).json({ error: 'Invalid userId' });

  const roomId = uuidv4().slice(0, 6).toUpperCase();
  const roomData = {
    users: [{ id: userId, isAdmin: true, socketId: null, joinedAt: new Date().toISOString() }],
    queue: [],
    currentSong: null,
    password: password || null,
    roomName: roomName || `Room ${roomId}`,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    playbackState: {
      isPlaying: false,
      position: 0,
      songId: null,
      timestamp: Date.now()
    },
    settings: {
      autoPlay: true,
      shuffle: false,
      repeat: 'none',
      maxUsers: 50,
      allowUserRequests: true
    },
    stats: {
      totalUsers: 1,
      totalSongsPlayed: 0,
      totalPlayTime: 0,
      lastSongPlayed: null
    }
  };

  rooms[roomId] = roomData;
  roomStats[roomId] = roomData.stats;

  await RoomModel.create({ roomId, ...roomData });

  res.status(200).json({ 
    message: 'Room created successfully', 
    roomId, 
    users: roomData.users,
    hasPassword: !!password,
    roomName: roomData.roomName,
    settings: roomData.settings,
    currentSong: roomData.currentSong,
    playbackState: roomData.playbackState
  });
});

// Room Info API
app.get('/api/room/:roomId/info', async (req, res) => {
  const { roomId } = req.params;
  if (!roomId || roomId.length !== 6) return res.status(400).json({ error: 'Invalid room ID' });

  const room = await RoomModel.findOne({ roomId });
  if (!room) return res.status(404).json({ error: 'Room not found' });

  res.json({
    roomId,
    roomName: room.roomName,
    hasPassword: !!room.password,
    userCount: room.users.length,
    currentSong: room.currentSong ? {
      title: room.currentSong.title,
      artist: room.currentSong.artist
    } : null,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🎵 Music Room Server running at http://localhost:${PORT}`);
});
