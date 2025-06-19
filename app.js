const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const app = express();
const server = http.createServer(app);

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
    message: 'Enhanced Music Room Server is running!',
    version: '2.0.0',
    features: [
      'Real-time synchronized music playback',
      'Queue management with user requests',
      'Room statistics and analytics',
      'Enhanced user management',
      'Auto-promotion when admin leaves'
    ]
  });
});

// Enhanced in-memory stores
const rooms = {};
const userSessions = {};
const roomStats = {};

// Middleware
app.use('/api/', apiLimiter);

// Helper functions
const validateRoomId = (roomId) => /^[A-Z0-9]{6}$/.test(roomId);
const validateUserId = (userId) => typeof userId === 'string' && userId.length > 0;

// Enhanced room cleanup with statistics
setInterval(() => {
  for (const roomId in rooms) {
    if (rooms[roomId].users.length === 0) {
      // Save room statistics before cleanup
      if (roomStats[roomId]) {
        console.log(`Room ${roomId} statistics:`, roomStats[roomId]);
      }
      delete rooms[roomId];
      delete roomStats[roomId];
      console.log(`Cleaned up empty room ${roomId}`);
    }
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

// Enhanced room creation with better metadata
app.post('/api/start-room', apiLimiter, (req, res) => {
  const { userId, password, roomName } = req.body;
  if (!validateUserId(userId)) return res.status(400).json({ error: 'Invalid userId' });

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
      repeat: 'none', // none, one, all
      maxUsers: 50,
      allowUserRequests: true
    }
  };

  rooms[roomId] = roomData;
  
  // Initialize room statistics
  roomStats[roomId] = {
    totalUsers: 1,
    totalSongsPlayed: 0,
    totalPlayTime: 0,
    createdAt: new Date().toISOString(),
    lastSongPlayed: null
  };

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

// Enhanced room joining with better validation
app.post('/api/join-room', apiLimiter, (req, res) => {
  const { userId, roomId, password } = req.body;
  
  console.log('Join room request:', { userId, roomId, password, passwordType: typeof password });
  
  if (!validateUserId(userId) || !validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid request parameters' });
  }

  const room = rooms[roomId];
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
    if (roomStats[roomId]) {
      roomStats[roomId].totalUsers = Math.max(roomStats[roomId].totalUsers, room.users.length);
    }
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
app.get('/api/room/:roomId/stats', apiLimiter, (req, res) => {
  const { roomId } = req.params;
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  const room = rooms[roomId];
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const stats = roomStats[roomId] || {};
  res.json({
    roomId,
    currentUsers: room.users.length,
    totalUsers: stats.totalUsers || 0,
    totalSongsPlayed: stats.totalSongsPlayed || 0,
    totalPlayTime: stats.totalPlayTime || 0,
    createdAt: room.createdAt,
    lastActivity: room.lastActivity,
    currentSong: room.currentSong,
    queueLength: room.queue.length
  });
});

// New API: Get room info (for checking if room exists and requires password)
app.get('/api/room/:roomId/info', apiLimiter, (req, res) => {
  const { roomId } = req.params;
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  const room = rooms[roomId];
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

// New API: Get available rooms
app.get('/api/rooms', apiLimiter, (req, res) => {
  const availableRooms = Object.keys(rooms).map(roomId => {
    const room = rooms[roomId];
    return {
      roomId,
      roomName: room.roomName,
      userCount: room.users.length,
      hasPassword: !!room.password,
      currentSong: room.currentSong ? {
        title: room.currentSong.title,
        artist: room.currentSong.artist
      } : null,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity
    };
  }).filter(room => room.userCount > 0);

  res.json({ rooms: availableRooms });
});

// ---- Enhanced Socket.IO ----
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
  const room = rooms[roomId];
  
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
  socket.on('admin_stream_song', ({ song, addToQueue = false }) => {
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
      if (roomStats[roomId]) {
        roomStats[roomId].totalSongsPlayed++;
        roomStats[roomId].lastSongPlayed = new Date().toISOString();
      }
      
      // Send to all viewers immediately with complete data
      socket.to(roomId).emit('play_song', songForViewers);
      
      // Send sync playback state to all users
      io.to(roomId).emit('sync_playback', room.playbackState);
      
      console.log(`📡 Streamed song to ${room.users.length - 1} viewers in room ${roomId}`);
    }
  });

  // Enhanced playback synchronization
  socket.on('sync_playback', (action) => {
    if (!user.isAdmin) return;
    
    console.log(`🔄 Admin ${userId} syncing playback in room ${roomId}:`, action);
    
    room.playbackState = {
      ...action,
      timestamp: Date.now()
    };
    
    // Broadcast to all viewers
    socket.to(roomId).emit('sync_playback', action);
  });

  socket.on('sync_seek', (time) => {
    if (!user.isAdmin) return;
    
    console.log(`⏩ Admin ${userId} seeking to ${time}s in room ${roomId}`);
    
    room.playbackState.position = time;
    room.playbackState.timestamp = Date.now();
    
    socket.to(roomId).emit('sync_seek', time);
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

  // Handle stream state requests from viewers
  socket.on('request_stream_state', ({ roomId: requestedRoomId }) => {
    if (!user.isAdmin) return;
    
    console.log(`Viewer ${userId} requested stream state for room ${requestedRoomId}`);
    
    const streamState = {
      currentSong: room.currentSong,
      queue: room.queue,
      playbackState: room.playbackState,
      settings: room.settings,
      timestamp: Date.now()
    };
    
    socket.emit('stream_state_response', streamState);
    console.log(`Admin sent stream state to user ${userId}`);
  });

  // Handle stream recovery requests from viewers
  socket.on('request_stream_recovery', ({ roomId: requestedRoomId, lastSongId, lastPosition }) => {
    if (!user.isAdmin) return;
    
    console.log(`Viewer ${userId} requested stream recovery for room ${requestedRoomId}`);
    
    let recoveryData = { success: false, message: 'No current song' };
    
    if (room.currentSong) {
      // Send current song and playback state
      recoveryData = {
        success: true,
        song: room.currentSong,
        playbackState: room.playbackState,
        message: 'Stream recovered successfully'
      };
      
      // If the viewer was on a different song, send the current one
      if (lastSongId && lastSongId !== (room.currentSong.id || room.currentSong._id)) {
        console.log(`Viewer was on different song (${lastSongId}), sending current song (${room.currentSong.id || room.currentSong._id})`);
      }
    }
    
    socket.emit('stream_recovery_response', recoveryData);
    console.log(`Admin sent stream recovery data to user ${userId}:`, recoveryData.success ? 'success' : 'failed');
  });

  // Queue management
  socket.on('add_to_queue', ({ song }) => {
    // Allow all users to add songs to queue
    room.queue.push(song);
    io.to(roomId).emit('queue_updated', { queue: room.queue });
    console.log(`Song added to queue in room ${roomId}: ${song.title} by ${userId}`);
  });

  socket.on('remove_from_queue', ({ songId }) => {
    if (!user.isAdmin) return;
    
    const index = room.queue.findIndex(song => 
      (song.id || song._id) === songId
    );
    
    if (index !== -1) {
      room.queue.splice(index, 1);
      io.to(roomId).emit('queue_updated', { queue: room.queue });
    }
  });

  socket.on('play_next', () => {
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
      if (roomStats[roomId]) {
        roomStats[roomId].totalSongsPlayed++;
        roomStats[roomId].lastSongPlayed = new Date().toISOString();
      }
    }
  });

  // Room settings management
  socket.on('update_room_settings', (settings) => {
    if (!user.isAdmin) return;
    
    room.settings = { ...room.settings, ...settings };
    io.to(roomId).emit('room_settings_updated', room.settings);
  });

  // Typing indicators
  socket.on('typing', (isTyping) => {
    socket.to(roomId).emit('user_typing', { userId, isTyping });
  });

  // Enhanced room management
  socket.on('promote_user', ({ targetUserId }) => {
    if (!user.isAdmin) return;
    
    const targetUser = room.users.find(u => u.id === targetUserId);
    if (targetUser) {
      targetUser.isAdmin = true;
      io.to(roomId).emit('user_promoted', { userId: targetUserId });
      io.to(roomId).emit('room_users', room.users);
    }
  });

  socket.on('kick_user', ({ targetUserId }) => {
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
      }
    }
  });

  // Enhanced disconnection handling
  socket.on('disconnect', () => {
    console.log(`User ${userId} disconnected from room ${roomId}`);
    
    const index = room.users.findIndex(u => u.id === userId);
    if (index !== -1) {
      room.users.splice(index, 1);
      room.lastActivity = new Date().toISOString();
      
      io.to(roomId).emit('user_left', userId);
      io.to(roomId).emit('room_users', room.users);
      
      // If admin left and there are other users, promote the first user
      if (user.isAdmin && room.users.length > 0) {
        room.users[0].isAdmin = true;
        io.to(roomId).emit('user_promoted', { userId: room.users[0].id });
        io.to(roomId).emit('room_users', room.users);
      }
    }
    // --- Clear room data if empty ---
    if (room.users.length === 0) {
      if (roomStats[roomId]) {
        console.log(`Room ${roomId} statistics:`, roomStats[roomId]);
      }
      delete rooms[roomId];
      delete roomStats[roomId];
      console.log(`Room ${roomId} cleared immediately after last user disconnected.`);
    }
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`Socket error from ${userId}:`, error);
  });
});

// ---- Start Server ----
server.listen(PORT, () => {
  console.log(`Enhanced Music Room Server running at http://localhost:${PORT}`);
  console.log('Features:');
  console.log('- Real-time synchronized music playback');
  console.log('- Queue management with user requests');
  console.log('- Room statistics and analytics');
  console.log('- Enhanced user management');
  console.log('- Auto-promotion when admin leaves');
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});