const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);

// MongoDB connection setup
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://makkakalanguappa:muthu5454@cluster0.zx043tc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const mongoClient = new MongoClient(MONGODB_URI);
let db;

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    await mongoClient.connect();
    db = mongoClient.db();
    console.log('Connected to MongoDB');
    
    // Create indexes
    await db.collection('rooms').createIndex({ roomId: 1 }, { unique: true });
    await db.collection('users').createIndex({ userId: 1 });
    await db.collection('room_stats').createIndex({ roomId: 1 }, { unique: true });
    
    // Initialize Mongoose for potential schema-based operations
    mongoose.connect(MONGODB_URI);
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later'
});

// CORS configuration
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true
  }
});

const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

// Simple root route for testing
app.get('/', (req, res) => {
  res.json({ 
    message: 'Enhanced Music Room Server with MongoDB is running!',
    version: '2.1.0',
    features: [
      'Real-time synchronized music playback',
      'Queue management with user requests',
      'Room statistics and analytics with MongoDB storage',
      'Enhanced user management',
      'Auto-promotion when admin leaves',
      'Persistent room data'
    ]
  });
});

// In-memory cache for active rooms (we'll sync with MongoDB)
const activeRooms = {};

// Helper functions
const validateRoomId = (roomId) => /^[A-Z0-9]{6}$/.test(roomId);
const validateUserId = (userId) => typeof userId === 'string' && userId.length > 0;

// MongoDB CRUD Operations
const RoomDB = {
  // Save or update a room
  async saveRoom(roomData) {
    try {
      await db.collection('rooms').updateOne(
        { roomId: roomData.roomId },
        { $set: roomData },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error saving room to MongoDB:', err);
    }
  },

  // Get a room by ID
  async getRoom(roomId) {
    try {
      return await db.collection('rooms').findOne({ roomId });
    } catch (err) {
      console.error('Error getting room from MongoDB:', err);
      return null;
    }
  },

  // Delete a room
  async deleteRoom(roomId) {
    try {
      await db.collection('rooms').deleteOne({ roomId });
    } catch (err) {
      console.error('Error deleting room from MongoDB:', err);
    }
  },

  // Get all active rooms
  async getActiveRooms() {
    try {
      return await db.collection('rooms').find({}).toArray();
    } catch (err) {
      console.error('Error getting active rooms from MongoDB:', err);
      return [];
    }
  }
};

const RoomStatsDB = {
  // Save or update room statistics
  async saveStats(roomId, stats) {
    try {
      await db.collection('room_stats').updateOne(
        { roomId },
        { $set: stats },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error saving room stats to MongoDB:', err);
    }
  },

  // Get room statistics
  async getStats(roomId) {
    try {
      return await db.collection('room_stats').findOne({ roomId });
    } catch (err) {
      console.error('Error getting room stats from MongoDB:', err);
      return null;
    }
  },

  // Update room statistics when a song is played
  async recordSongPlayed(roomId, song) {
    try {
      await db.collection('room_stats').updateOne(
        { roomId },
        { 
          $inc: { totalSongsPlayed: 1 },
          $set: { lastSongPlayed: new Date().toISOString() },
          $push: { 
            playedSongs: {
              songId: song.id || song._id,
              title: song.title,
              artist: song.artist,
              playedAt: new Date().toISOString()
            }
          }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error recording song play in MongoDB:', err);
    }
  }
};

const UserDB = {
  // Save or update user session
  async saveUserSession(userId, roomId) {
    try {
      await db.collection('users').updateOne(
        { userId },
        { 
          $set: { 
            lastActive: new Date().toISOString(),
            currentRoom: roomId 
          },
          $inc: { sessionCount: 1 }
        },
        { upsert: true }
      );
    } catch (err) {
      console.error('Error saving user session to MongoDB:', err);
    }
  },

  // Remove user from room (when they leave)
  async removeUserFromRoom(userId) {
    try {
      await db.collection('users').updateOne(
        { userId },
        { $unset: { currentRoom: "" } }
      );
    } catch (err) {
      console.error('Error removing user from room in MongoDB:', err);
    }
  }
};

// Room cleanup with MongoDB sync
setInterval(async () => {
  try {
    // Clean up in-memory rooms that are empty
    for (const roomId in activeRooms) {
      if (activeRooms[roomId].users.length === 0) {
        // Save final stats before cleanup
        if (activeRooms[roomId].stats) {
          await RoomStatsDB.saveStats(roomId, activeRooms[roomId].stats);
        }
        
        // Mark room as inactive in MongoDB (we don't delete for historical data)
        await RoomDB.saveRoom({
          ...activeRooms[roomId],
          isActive: false,
          endedAt: new Date().toISOString()
        });
        
        delete activeRooms[roomId];
        console.log(`Cleaned up empty room ${roomId}`);
      }
    }
    
    // Also clean up any rooms in MongoDB that have been inactive for >24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.collection('rooms').deleteMany({ 
      isActive: false, 
      endedAt: { $lt: twentyFourHoursAgo } 
    });
    
  } catch (err) {
    console.error('Error during room cleanup:', err);
  }
}, 60000); // Run every minute

// ---- Enhanced APIs ----
app.get('/api/search', apiLimiter, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  try {
    const response = await axios.get('https://web-production-0b6a6.up.railway.app/result/', {
      params: { query, lyrics: true },
      timeout: 5000
    });
    res.json(response.data);
  } catch (err) {
    console.error('Search error:', err.message);
    // Provide demo results if the external API fails
    const demoResults = [
      {
        id: 'demo1',
        title: 'Demo Song 1',
        artist: 'Demo Artist',
        cover: 'https://via.placeholder.com/150',
        mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
        _id: 'demo1'
      },
      {
        id: 'demo2',
        title: 'Demo Song 2',
        artist: 'Demo Artist',
        cover: 'https://via.placeholder.com/150',
        mediaUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
        _id: 'demo2'
      }
    ];
    res.json({ songs: demoResults });
  }
});

app.get('/api/playlist', apiLimiter, async (req, res) => {
  const query = req.query.query || 'tamil songs';
  const apiUrl = `https://saavn.dev/api/search/songs?query=${encodeURIComponent(query)}`;

  try {
    const response = await axios.get(apiUrl, { timeout: 5000 });
    const songs = response.data?.data?.results || [];

    const formattedSongs = songs
      .filter(song => song.name && song.primaryArtists && song.image && song.downloadUrl)
      .slice(0, 10)
      .map((song, index) => ({
        id: song.id || index.toString(),
        title: song.name,
        artist: Array.isArray(song.primaryArtists)
          ? song.primaryArtists.join(', ')
          : song.primaryArtists,
        cover: song.image[2]?.link || song.image[0]?.link,
        mediaUrl: song.downloadUrl[2]?.link || song.downloadUrl[0]?.link,
      }));

    res.json({ songs: formattedSongs });
  } catch (error) {
    console.error('Saavn API error:', error.message);
    res.status(500).json({ error: 'Failed to fetch songs' });
  }
});

// Enhanced room creation with MongoDB storage
app.post('/api/start-room', apiLimiter, async (req, res) => {
  const { userId, password, roomName } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

  const roomId = uuidv4().slice(0, 6).toUpperCase();
  const roomData = {
    roomId,
    users: [{ id: userId, isAdmin: true, socketId: null, joinedAt: new Date().toISOString() }],
    queue: [],
    currentSong: null,
    password: password || null,
    roomName: roomName || `Room ${roomId}`,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    isActive: true,
    playbackState: {
      isPlaying: false,
      position: 0,
      songId: null,
      timestamp: Date.now()
    },
    settings: {
      autoPlay: true,
      shuffle: false,
      repeat: 'none', // none, one, all
      maxUsers: 50,
      allowUserRequests: true
    }
  };

  // Save to in-memory cache and MongoDB
  activeRooms[roomId] = roomData;
  await RoomDB.saveRoom(roomData);
  
  // Initialize room statistics
  const initialStats = {
    roomId,
    totalUsers: 1,
    totalSongsPlayed: 0,
    totalPlayTime: 0,
    createdAt: new Date().toISOString(),
    lastSongPlayed: null,
    playedSongs: []
  };
  
  activeRooms[roomId].stats = initialStats;
  await RoomStatsDB.saveStats(roomId, initialStats);
  
  // Save user session
  await UserDB.saveUserSession(userId, roomId);

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

// Enhanced room joining with MongoDB sync
app.post('/api/join-room', apiLimiter, async (req, res) => {
  const { userId, roomId, password } = req.body;
  
  console.log('Join room request:', { userId, roomId, password, passwordType: typeof password });
  
  if (!validateUserId(userId) || !validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  // Check if room is in active cache, if not try to load from MongoDB
  let room = activeRooms[roomId];
  if (!room) {
    const dbRoom = await RoomDB.getRoom(roomId);
    if (dbRoom && dbRoom.isActive) {
      activeRooms[roomId] = dbRoom;
      room = dbRoom;
    }
  }
  
  if (!room) return res.status(404).json({ error: 'Room not found' });
  
  // Force allow user requests for all rooms
  room.settings.allowUserRequests = true;

  console.log('Room data:', { 
    roomPassword: room.password, 
    roomPasswordType: typeof room.password,
    hasPassword: !!room.password,
    passwordMatch: room.password === password
  });
  
  if (room.password && room.password !== password) {
    console.log('Password check failed - returning 403');
    return res.status(403).json({ error: 'Incorrect room password' });
  }

  // Check room capacity
  if (room.users.length >= room.settings.maxUsers) {
    return res.status(403).json({ error: 'Room is full' });
  }

  const exists = room.users.find(u => u.id === userId);
  if (!exists) {
    room.users.push({ 
      id: userId, 
      isAdmin: false, 
      socketId: null, 
      joinedAt: new Date().toISOString() 
    });
    
    // Update room statistics
    if (room.stats) {
      room.stats.totalUsers = Math.max(room.stats.totalUsers, room.users.length);
      await RoomStatsDB.saveStats(roomId, room.stats);
    }
    
    // Save user session
    await UserDB.saveUserSession(userId, roomId);
    
    // Update room in MongoDB
    await RoomDB.saveRoom(room);
  }

  room.lastActivity = new Date().toISOString();

  console.log('Join successful - returning 200');
  res.status(200).json({ 
    message: 'Joined room successfully', 
    roomId, 
    users: room.users,
    currentSong: room.currentSong,
    playbackState: room.playbackState,
    settings: room.settings,
    roomName: room.roomName,
    queue: room.queue
  });
});

// New API: Get room statistics
app.get('/api/room/:roomId/stats', apiLimiter, async (req, res) => {
  const { roomId } = req.params;
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  const room = activeRooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const stats = room.stats || await RoomStatsDB.getStats(roomId) || {};
  res.json({
    roomId,
    currentUsers: room.users.length,
    totalUsers: stats.totalUsers || 0,
    totalSongsPlayed: stats.totalSongsPlayed || 0,
    totalPlayTime: stats.totalPlayTime || 0,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    currentSong: room.currentSong,
    queueLength: room.queue.length,
    playedSongs: stats.playedSongs || []
  });
});

// New API: Get room info (for checking if room exists and requires password)
app.get('/api/room/:roomId/info', apiLimiter, async (req, res) => {
  const { roomId } = req.params;
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  // Check active rooms first, then fall back to MongoDB
  let room = activeRooms[roomId];
  if (!room) {
    room = await RoomDB.getRoom(roomId);
    if (!room || !room.isActive) {
      return res.status(404).json({ error: 'Room not found' });
    }
  }

  res.json({
    roomId,
    roomName: room.roomName,
    hasPassword: !!room.password,
    userCount: room.users ? room.users.length : 0,
    currentSong: room.currentSong ? {
      title: room.currentSong.title,
      artist: room.currentSong.artist
    } : null,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    isActive: room.isActive
  });
});

// New API: Get available rooms
app.get('/api/rooms', apiLimiter, async (req, res) => {
  // Combine active in-memory rooms with any active rooms from MongoDB
  const activeRoomIds = new Set(Object.keys(activeRooms));
  const dbRooms = await RoomDB.getActiveRooms();
  
  const availableRooms = [
    ...Object.values(activeRooms),
    ...dbRooms.filter(room => !activeRoomIds.has(room.roomId) && room.isActive)
  ].map(room => ({
    roomId: room.roomId,
    roomName: room.roomName,
    userCount: room.users ? room.users.length : 0,
    hasPassword: !!room.password,
    currentSong: room.currentSong ? {
      title: room.currentSong.title,
      artist: room.currentSong.artist
    } : null,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity
  })).filter(room => room.userCount > 0);

  res.json({ rooms: availableRooms });
});

// ---- Enhanced Socket.IO with MongoDB sync ----
io.use((socket, next) => {
  const { roomId, userId } = socket.handshake.auth;
  if (!validateRoomId(roomId) || !validateUserId(userId)) {
    return next(new Error('Invalid authentication'));
  }
  next();
});

io.on('connection', (socket) => {
  console.log('New socket connected:', socket.id);
  
  const { roomId, userId } = socket.handshake.auth;
  const room = activeRooms[roomId];
  
  if (!room) {
    socket.emit('error', 'Room not found');
    socket.disconnect();
    return;
  }

  // Update user's socketId
  const user = room.users.find(u => u.id === userId);
  if (!user) {
    socket.emit('error', 'User not in room');
    socket.disconnect();
    return;
  }

  user.socketId = socket.id;
  socket.join(roomId);
  room.lastActivity = new Date().toISOString();
  
  // Update room in MongoDB
  RoomDB.saveRoom(room);

  // Notify others
  socket.to(roomId).emit('user_joined', { userId, user });
  io.to(roomId).emit('room_users', room.users);

  // Send current state to new user
  if (room.currentSong) {
    socket.emit('play_song', room.currentSong);
  }
  
  // Send current playback state
  socket.emit('sync_playback', room.playbackState);

  console.log(`User ${userId} joined room ${roomId}`);

  // Enhanced admin streaming with queue management
  socket.on('admin_stream_song', async ({ song, addToQueue = false }) => {
    if (!user.isAdmin) {
      socket.emit('error', 'Only admin can stream');
      return;
    }

    console.log(`🎵 Admin ${userId} ${addToQueue ? 'adding to queue' : 'streaming'} in room ${roomId}: ${song.title}`);

    // Ensure song has all necessary data for viewers
    const songForViewers = {
      ...song,
      id: song.id || song._id,
      _id: song._id || song.id,
      mediaUrl: song.mediaUrl || song.media_url || song.downloadUrl || song.url,
      title: song.title,
      artist: song.artist,
      thumbnail: song.thumbnail || song.artwork || song.cover
    };

    console.log(`📡 Song data for viewers:`, {
      id: songForViewers.id,
      title: songForViewers.title,
      artist: songForViewers.artist,
      hasMediaUrl: !!songForViewers.mediaUrl,
      hasThumbnail: !!songForViewers.thumbnail
    });

    if (addToQueue) {
      room.queue.push(songForViewers);
      io.to(roomId).emit('queue_updated', { queue: room.queue });
    } else {
      room.currentSong = songForViewers;
      room.playbackState = {
        isPlaying: false,
        position: 0,
        songId: songForViewers.id,
        timestamp: Date.now()
      };
      
      // Update statistics
      if (room.stats) {
        room.stats.totalSongsPlayed++;
        room.stats.lastSongPlayed = new Date().toISOString();
        await RoomStatsDB.recordSongPlayed(roomId, songForViewers);
      }
      
      // Send to all viewers immediately with complete data
      socket.to(roomId).emit('play_song', songForViewers);
      
      // Send sync playback state to all users
      io.to(roomId).emit('sync_playback', room.playbackState);
      
      console.log(`📡 Streamed song to ${room.users.length - 1} viewers in room ${roomId}`);
    }
    
    // Update room in MongoDB
    await RoomDB.saveRoom(room);
  });

  // Enhanced playback synchronization
  socket.on('sync_playback', async (action) => {
    if (!user.isAdmin) return;
    
    console.log(`🔄 Admin ${userId} syncing playback in room ${roomId}:`, action);
    
    room.playbackState = {
      ...action,
      timestamp: Date.now()
    };
    
    // Broadcast to all viewers
    socket.to(roomId).emit('sync_playback', action);
    
    // Update room in MongoDB
    await RoomDB.saveRoom(room);
  });

  socket.on('sync_seek', async (time) => {
    if (!user.isAdmin) return;
    
    console.log(`⏩ Admin ${userId} seeking to ${time}s in room ${roomId}`);
    
    room.playbackState.position = time;
    room.playbackState.timestamp = Date.now();
    
    socket.to(roomId).emit('sync_seek', time);
    
    // Update room in MongoDB
    await RoomDB.saveRoom(room);
  });

  // Handle song data requests from viewers
  socket.on('request_song_data', ({ songId }) => {
    if (!user.isAdmin) return;
    
    // Find the song in the room's current song or queue
    let songData = null;
    if (room.currentSong && (room.currentSong.id === songId || room.currentSong._id === songId)) {
      songData = room.currentSong;
    } else {
      songData = room.queue.find(song => song.id === songId || song._id === songId);
    }
    
    if (songData) {
      // Send the song data back to the requesting user
      socket.emit('song_data_response', songData);
      console.log(`Admin sent song data for ${songId} to user ${userId}`);
    } else {
      console.log(`Song ${songId} not found in room ${roomId}`);
    }
  });

  // Queue management with MongoDB sync
  socket.on('add_to_queue', async ({ song }) => {
    // Allow all users to add songs to queue
    room.queue.push(song);
    io.to(roomId).emit('queue_updated', { queue: room.queue });
    console.log(`Song added to queue in room ${roomId}: ${song.title} by ${userId}`);
    
    // Update room in MongoDB
    await RoomDB.saveRoom(room);
  });

  socket.on('remove_from_queue', async ({ songId }) => {
    if (!user.isAdmin) return;
    
    const index = room.queue.findIndex(song => 
      (song.id || song._id) === songId
    );
    
    if (index !== -1) {
      room.queue.splice(index, 1);
      io.to(roomId).emit('queue_updated', { queue: room.queue });
      
      // Update room in MongoDB
      await RoomDB.saveRoom(room);
    }
  });

  socket.on('play_next', async () => {
    if (!user.isAdmin) return;
    
    if (room.queue.length > 0) {
      const nextSong = room.queue.shift();
      room.currentSong = nextSong;
      room.playbackState = {
        isPlaying: false,
        position: 0,
        songId: nextSong.id || nextSong._id,
        timestamp: Date.now()
      };
      
      io.to(roomId).emit('play_song', nextSong);
      io.to(roomId).emit('sync_playback', room.playbackState);
      io.to(roomId).emit('queue_updated', { queue: room.queue });
      
      // Update statistics
      if (room.stats) {
        room.stats.totalSongsPlayed++;
        room.stats.lastSongPlayed = new Date().toISOString();
        await RoomStatsDB.recordSongPlayed(roomId, nextSong);
      }
      
      // Update room in MongoDB
      await RoomDB.saveRoom(room);
    }
  });

  // Room settings management with MongoDB sync
  socket.on('update_room_settings', async (settings) => {
    if (!user.isAdmin) return;
    
    room.settings = { ...room.settings, ...settings };
    io.to(roomId).emit('room_settings_updated', room.settings);
    
    // Update room in MongoDB
    await RoomDB.saveRoom(room);
  });

  // Enhanced room management with MongoDB sync
  socket.on('promote_user', async ({ targetUserId }) => {
    if (!user.isAdmin) return;
    
    const targetUser = room.users.find(u => u.id === targetUserId);
    if (targetUser) {
      targetUser.isAdmin = true;
      io.to(roomId).emit('user_promoted', { userId: targetUserId });
      io.to(roomId).emit('room_users', room.users);
      
      // Update room in MongoDB
      await RoomDB.saveRoom(room);
    }
  });

  socket.on('kick_user', async ({ targetUserId }) => {
    if (!user.isAdmin) return;
    
    const targetUser = room.users.find(u => u.id === targetUserId);
    if (targetUser && !targetUser.isAdmin) {
      const targetSocket = io.sockets.sockets.get(targetUser.socketId);
      if (targetSocket) {
        targetSocket.emit('kicked_from_room', { reason: 'Kicked by admin' });
        targetSocket.disconnect();
      }
      
      const index = room.users.findIndex(u => u.id === targetUserId);
      if (index !== -1) {
        room.users.splice(index, 1);
        io.to(roomId).emit('user_left', targetUserId);
        io.to(roomId).emit('room_users', room.users);
        
        // Update user session in MongoDB
        await UserDB.removeUserFromRoom(targetUserId);
        
        // Update room in MongoDB
        await RoomDB.saveRoom(room);
      }
    }
  });

  // Enhanced disconnection handling with MongoDB sync
  socket.on('disconnect', async () => {
    console.log(`User ${userId} disconnected from room ${roomId}`);
    
    const index = room.users.findIndex(u => u.id === userId);
    if (index !== -1) {
      room.users.splice(index, 1);
      room.lastActivity = new Date().toISOString();
      
      io.to(roomId).emit('user_left', userId);
      io.to(roomId).emit('room_users', room.users);
      
      // Update user session in MongoDB
      await UserDB.removeUserFromRoom(userId);
      
      // If admin left and there are other users, promote the first user
      if (user.isAdmin && room.users.length > 0) {
        room.users[0].isAdmin = true;
        io.to(roomId).emit('user_promoted', { userId: room.users[0].id });
        io.to(roomId).emit('room_users', room.users);
      }
      
      // Update room in MongoDB
      await RoomDB.saveRoom(room);
    }
    
    // Clear room data if empty
    if (room.users.length === 0) {
      if (room.stats) {
        console.log(`Room ${roomId} statistics:`, room.stats);
        await RoomStatsDB.saveStats(roomId, room.stats);
      }
      
      // Mark room as inactive in MongoDB
      await RoomDB.saveRoom({
        ...room,
        isActive: false,
        endedAt: new Date().toISOString()
      });
      
      delete activeRooms[roomId];
      console.log(`Room ${roomId} cleared immediately after last user disconnected.`);
    }
  });
});

// ---- Start Server ----
connectToMongoDB().then(() => {
  server.listen(PORT, () => {
    console.log(`Enhanced Music Room Server with MongoDB running at http://localhost:${PORT}`);
    console.log('Features:');
    console.log('- Real-time synchronized music playback');
    console.log('- Persistent room data with MongoDB');
    console.log('- Queue management with user requests');
    console.log('- Room statistics and analytics with historical data');
    console.log('- Enhanced user management with session tracking');
    console.log('- Auto-promotion when admin leaves');
  });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});