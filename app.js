const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');
const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb');

const app = express();
const server = http.createServer(app);

// MongoDB Atlas connection
const MONGODB_URI =  'mongodb+srv://makkakalanguappa:muthu5454@cluster0.zx043tc.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Connect to MongoDB
async function connectToMongoDB() {
  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');
    
    // Create collections if they don't exist
    const db = client.db();
    await db.collection('rooms').createIndex({ roomId: 1 }, { unique: true });
    await db.collection('room_stats').createIndex({ roomId: 1 }, { unique: true });
    await db.collection('user_sessions').createIndex({ userId: 1, roomId: 1 }, { unique: true });
    
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
}

connectToMongoDB();

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
      'Auto-promotion when admin leaves',
      'MongoDB Atlas storage'
    ]
  });
});

// Helper functions
const validateRoomId = (roomId) => /^[A-Z0-9]{6}$/.test(roomId);
const validateUserId = (userId) => typeof userId === 'string' && userId.length > 0;

// MongoDB Room Operations
async function getRoom(roomId) {
  const db = client.db();
  const room = await db.collection('rooms').findOne({ roomId });
  return room;
}

async function createRoom(roomData) {
  const db = client.db();
  await db.collection('rooms').insertOne(roomData);
  
  // Initialize room statistics
  await db.collection('room_stats').insertOne({
    roomId: roomData.roomId,
    totalUsers: 1,
    totalSongsPlayed: 0,
    totalPlayTime: 0,
    createdAt: new Date().toISOString(),
    lastSongPlayed: null,
    lastActivity: new Date().toISOString()
  });
}

async function updateRoom(roomId, updateData) {
  const db = client.db();
  await db.collection('rooms').updateOne(
    { roomId },
    { $set: { ...updateData, lastActivity: new Date().toISOString() } }
  );
  
  // Also update last activity in stats
  await db.collection('room_stats').updateOne(
    { roomId },
    { $set: { lastActivity: new Date().toISOString() } }
  );
}

async function deleteRoom(roomId) {
  const db = client.db();
  await db.collection('rooms').deleteOne({ roomId });
  await db.collection('room_stats').deleteOne({ roomId });
}

async function updateRoomStats(roomId, updateData) {
  const db = client.db();
  await db.collection('room_stats').updateOne(
    { roomId },
    { $set: updateData }
  );
}

async function getRoomStats(roomId) {
  const db = client.db();
  return await db.collection('room_stats').findOne({ roomId });
}

// User session management
async function createUserSession(userId, roomId, socketId) {
  const db = client.db();
  await db.collection('user_sessions').insertOne({
    userId,
    roomId,
    socketId,
    joinedAt: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  });
}

async function updateUserSession(userId, roomId, updateData) {
  const db = client.db();
  await db.collection('user_sessions').updateOne(
    { userId, roomId },
    { $set: { ...updateData, lastActivity: new Date().toISOString() } }
  );
}

async function deleteUserSession(userId, roomId) {
  const db = client.db();
  await db.collection('user_sessions').deleteOne({ userId, roomId });
}

// Room cleanup job - runs every 10 minutes
setInterval(async () => {
  try {
    const db = client.db();
    const inactiveThreshold = new Date(Date.now() - 30 * 60 * 1000); // 30 minutes
    
    // Find inactive rooms
    const inactiveRooms = await db.collection('rooms').find({
      lastActivity: { $lt: inactiveThreshold.toISOString() }
    }).toArray();
    
    // Delete inactive rooms and their stats
    for (const room of inactiveRooms) {
      console.log(`Cleaning up inactive room ${room.roomId}`);
      await db.collection('rooms').deleteOne({ roomId: room.roomId });
      await db.collection('room_stats').deleteOne({ roomId: room.roomId });
    }
    
    // Clean up user sessions for active rooms
    const activeRoomIds = (await db.collection('rooms').find().toArray()).map(r => r.roomId);
    await db.collection('user_sessions').deleteMany({
      roomId: { $nin: activeRoomIds }
    });
    
  } catch (err) {
    console.error('Room cleanup error:', err);
  }
}, 10 * 60 * 1000); // Run every 10 minutes

// ---- Enhanced APIs ----
app.get('/api/search', apiLimiter, async (req, res) => {
  const query = req.query.q;
  if (!query) return res.status(400).json({ error: 'Missing search query' });

  try {
    const response = await axios.get('https://flask-uvpu.onrender.com/result', {
      params: { query, lyrics: true },
      timeout: 5000
    });
    res.json(response.data);
  } catch (err) {
    console.error('Search error:', err.message);
    res.status(500).json({ error: 'Failed to fetch data from external API' });
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

// Enhanced room creation with MongoDB
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
      allowUserRequests: false
    }
  };

  try {
    await createRoom(roomData);
    await createUserSession(userId, roomId, null);
    
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
  } catch (err) {
    console.error('Room creation error:', err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Enhanced room joining with MongoDB
app.post('/api/join-room', apiLimiter, async (req, res) => {
  const { userId, roomId, password } = req.body;
  
  if (!validateUserId(userId)) {
    return res.status(400).json({ error: 'Invalid userId' });
  }
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  try {
    const room = await getRoom(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });
    
    if (room.password && room.password !== password) {
      return res.status(403).json({ error: 'Incorrect room password' });
    }

    // Check room capacity
    if (room.users.length >= room.settings.maxUsers) {
      return res.status(403).json({ error: 'Room is full' });
    }

    const userExists = room.users.some(u => u.id === userId);
    if (!userExists) {
      const newUser = { 
        id: userId, 
        isAdmin: false, 
        socketId: null, 
        joinedAt: new Date().toISOString() 
      };
      
      await updateRoom(roomId, {
        users: [...room.users, newUser],
        lastActivity: new Date().toISOString()
      });
      
      // Update room statistics
      const stats = await getRoomStats(roomId);
      if (stats) {
        await updateRoomStats(roomId, {
          totalUsers: Math.max(stats.totalUsers, room.users.length + 1)
        });
      }
      
      // Create user session
      await createUserSession(userId, roomId, null);
    }

    res.status(200).json({ 
      message: 'Joined room successfully', 
      roomId, 
      users: userExists ? room.users : [...room.users, { 
        id: userId, 
        isAdmin: false, 
        socketId: null, 
        joinedAt: new Date().toISOString() 
      }],
      currentSong: room.currentSong,
      playbackState: room.playbackState,
      settings: room.settings,
      roomName: room.roomName,
      queue: room.queue
    });
  } catch (err) {
    console.error('Join room error:', err);
    res.status(500).json({ error: 'Failed to join room' });
  }
});

// Get room statistics
app.get('/api/room/:roomId/stats', apiLimiter, async (req, res) => {
  const { roomId } = req.params;
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  try {
    const room = await getRoom(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const stats = await getRoomStats(roomId) || {};
    
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
  } catch (err) {
    console.error('Get room stats error:', err);
    res.status(500).json({ error: 'Failed to get room statistics' });
  }
});

// Get room info
app.get('/api/room/:roomId/info', apiLimiter, async (req, res) => {
  const { roomId } = req.params;
  
  if (!validateRoomId(roomId)) {
    return res.status(400).json({ error: 'Invalid room ID' });
  }

  try {
    const room = await getRoom(roomId);
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
  } catch (err) {
    console.error('Get room info error:', err);
    res.status(500).json({ error: 'Failed to get room info' });
  }
});

// Get available rooms
app.get('/api/rooms', apiLimiter, async (req, res) => {
  try {
    const db = client.db();
    const activeRooms = await db.collection('rooms')
      .find({ lastActivity: { $gte: new Date(Date.now() - 30 * 60 * 1000).toISOString() } })
      .toArray();

    const availableRooms = activeRooms.map(room => ({
      roomId: room.roomId,
      roomName: room.roomName,
      userCount: room.users.length,
      hasPassword: !!room.password,
      currentSong: room.currentSong ? {
        title: room.currentSong.title,
        artist: room.currentSong.artist
      } : null,
      createdAt: room.createdAt,
      lastActivity: room.lastActivity
    }));

    res.json({ rooms: availableRooms });
  } catch (err) {
    console.error('Get available rooms error:', err);
    res.status(500).json({ error: 'Failed to get available rooms' });
  }
});

// ---- Enhanced Socket.IO with MongoDB ----
io.use(async (socket, next) => {
  const { roomId, userId } = socket.handshake.auth;
  if (!validateRoomId(roomId) ){
    return next(new Error('Invalid room ID'));
  }
  
  if (!validateUserId(userId)) {
    return next(new Error('Invalid user ID'));
  }

  try {
    const room = await getRoom(roomId);
    if (!room) {
      return next(new Error('Room not found'));
    }

    const userExists = room.users.some(u => u.id === userId);
    if (!userExists) {
      return next(new Error('User not in room'));
    }

    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', async (socket) => {
  console.log('New socket connected:', socket.id);
  
  const { roomId, userId } = socket.handshake.auth;
  
  try {
    const room = await getRoom(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      socket.disconnect();
      return;
    }

    // Update user's socketId in the room
    const updatedUsers = room.users.map(user => 
      user.id === userId ? { ...user, socketId: socket.id } : user
    );
    
    await updateRoom(roomId, { users: updatedUsers });
    await updateUserSession(userId, roomId, { socketId: socket.id });
    
    socket.join(roomId);
    
    // Notify others
    const currentUser = updatedUsers.find(u => u.id === userId);
    socket.to(roomId).emit('user_joined', { userId, user: currentUser });
    io.to(roomId).emit('room_users', updatedUsers);

    // Send current state to new user
    if (room.currentSong) {
      socket.emit('play_song', room.currentSong);
    }
    
    // Send current playback state
    socket.emit('sync_playback', room.playbackState);

    console.log(`User ${userId} joined room ${roomId}`);

    // Enhanced admin streaming with queue management
    socket.on('admin_stream_song', async ({ song, addToQueue = false }) => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!user || !user.isAdmin) {
          socket.emit('error', 'Only admin can stream');
          return;
        }

        console.log(`🎵 Admin ${userId} ${addToQueue ? 'adding to queue' : 'streaming'} in room ${roomId}: ${song.title}`);

        const songForViewers = {
          ...song,
          id: song.id || song._id,
          _id: song._id || song.id,
          mediaUrl: song.mediaUrl || song.media_url || song.downloadUrl || song.url,
          title: song.title,
          artist: song.artist,
          thumbnail: song.thumbnail || song.artwork || song.cover
        };

        if (addToQueue) {
          const updatedQueue = [...room.queue, songForViewers];
          await updateRoom(roomId, { queue: updatedQueue });
          io.to(roomId).emit('queue_updated', { queue: updatedQueue });
        } else {
          const playbackState = {
            isPlaying: false,
            position: 0,
            songId: songForViewers.id,
            timestamp: Date.now()
          };
          
          await updateRoom(roomId, { 
            currentSong: songForViewers,
            playbackState
          });
          
          // Update statistics
          const stats = await getRoomStats(roomId);
          if (stats) {
            await updateRoomStats(roomId, {
              totalSongsPlayed: (stats.totalSongsPlayed || 0) + 1,
              lastSongPlayed: new Date().toISOString()
            });
          }
          
          // Send to all viewers
          socket.to(roomId).emit('play_song', songForViewers);
          io.to(roomId).emit('sync_playback', playbackState);
        }
      } catch (err) {
        console.error('Admin stream error:', err);
      }
    });

    // Enhanced playback synchronization
    socket.on('sync_playback', async (action) => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!user || !user.isAdmin) return;
        
        const playbackState = {
          ...action,
          timestamp: Date.now()
        };
        
        await updateRoom(roomId, { playbackState });
        socket.to(roomId).emit('sync_playback', playbackState);
      } catch (err) {
        console.error('Sync playback error:', err);
      }
    });

    socket.on('sync_seek', async (time) => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!user || !user.isAdmin) return;
        
        const playbackState = {
          ...room.playbackState,
          position: time,
          timestamp: Date.now()
        };
        
        await updateRoom(roomId, { playbackState });
        socket.to(roomId).emit('sync_seek', time);
      } catch (err) {
        console.error('Sync seek error:', err);
      }
    });

    // Queue management
    socket.on('add_to_queue', async ({ song }) => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!room.settings.allowUserRequests && (!user || !user.isAdmin)) {
          socket.emit('error', 'User requests not allowed in this room');
          return;
        }
        
        const updatedQueue = [...room.queue, song];
        await updateRoom(roomId, { queue: updatedQueue });
        io.to(roomId).emit('queue_updated', { queue: updatedQueue });
      } catch (err) {
        console.error('Add to queue error:', err);
      }
    });

    socket.on('remove_from_queue', async ({ songId }) => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!user || !user.isAdmin) return;
        
        const updatedQueue = room.queue.filter(song => 
          (song.id || song._id) !== songId
        );
        
        if (updatedQueue.length !== room.queue.length) {
          await updateRoom(roomId, { queue: updatedQueue });
          io.to(roomId).emit('queue_updated', { queue: updatedQueue });
        }
      } catch (err) {
        console.error('Remove from queue error:', err);
      }
    });

    socket.on('play_next', async () => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!user || !user.isAdmin) return;
        
        if (room.queue.length > 0) {
          const nextSong = room.queue[0];
          const updatedQueue = room.queue.slice(1);
          
          const playbackState = {
            isPlaying: false,
            position: 0,
            songId: nextSong.id || nextSong._id,
            timestamp: Date.now()
          };
          
          await updateRoom(roomId, {
            currentSong: nextSong,
            queue: updatedQueue,
            playbackState
          });
          
          // Update statistics
          const stats = await getRoomStats(roomId);
          if (stats) {
            await updateRoomStats(roomId, {
              totalSongsPlayed: (stats.totalSongsPlayed || 0) + 1,
              lastSongPlayed: new Date().toISOString()
            });
          }
          
          io.to(roomId).emit('play_song', nextSong);
          io.to(roomId).emit('sync_playback', playbackState);
          io.to(roomId).emit('queue_updated', { queue: updatedQueue });
        }
      } catch (err) {
        console.error('Play next error:', err);
      }
    });

    // Room settings management
    socket.on('update_room_settings', async (settings) => {
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const user = room.users.find(u => u.id === userId);
        if (!user || !user.isAdmin) return;
        
        await updateRoom(roomId, {
          settings: { ...room.settings, ...settings }
        });
        
        io.to(roomId).emit('room_settings_updated', { ...room.settings, ...settings });
      } catch (err) {
        console.error('Update room settings error:', err);
      }
    });

    // Enhanced disconnection handling
    socket.on('disconnect', async () => {
      console.log(`User ${userId} disconnected from room ${roomId}`);
      
      try {
        const room = await getRoom(roomId);
        if (!room) return;
        
        const userIndex = room.users.findIndex(u => u.id === userId);
        if (userIndex === -1) return;
        
        const updatedUsers = [...room.users];
        const disconnectedUser = updatedUsers[userIndex];
        updatedUsers.splice(userIndex, 1);
        
        await updateRoom(roomId, {
          users: updatedUsers,
          lastActivity: new Date().toISOString()
        });
        
        await deleteUserSession(userId, roomId);
        
        io.to(roomId).emit('user_left', userId);
        io.to(roomId).emit('room_users', updatedUsers);
        
        // If admin left and there are other users, promote the first user
        if (disconnectedUser.isAdmin && updatedUsers.length > 0) {
          const newAdmin = updatedUsers[0];
          updatedUsers[0] = { ...newAdmin, isAdmin: true };
          
          await updateRoom(roomId, { users: updatedUsers });
          
          io.to(roomId).emit('user_promoted', { userId: newAdmin.id });
          io.to(roomId).emit('room_users', updatedUsers);
        }
      } catch (err) {
        console.error('Disconnection handling error:', err);
      }
    });

  } catch (err) {
    console.error('Socket connection error:', err);
    socket.emit('error', 'Connection error');
    socket.disconnect();
  }
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
  console.log('- MongoDB Atlas storage');
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down server...');
  try {
    await client.close();
    server.close();
    process.exit(0);
  } catch (err) {
    console.error('Shutdown error:', err);
    process.exit(1);
  }
});