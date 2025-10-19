// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Datastore = require('nedb');

const app = express();

app.get("/", (req, res) => {
  res.send("Pinch server is running");
});

const server = http.createServer(app);

const io = new Server(server, {
  path: "/socket.io/",
  cors: {
    origin: "https://pinch-client-app.onrender.com",
    methods: ["GET", "POST"],
  },
  transports: ['polling', 'websocket'],
});

const PORT = 8000;

// Database for chat
const chatDB = new Datastore({ filename: 'chat.db', autoload: true });

// Data structure to hold room information
const rooms = {};

// Emotions and animals for name generation
const emotions = ["Happy", "Sad", "Angry", "Excited", "Calm", "Anxious", "Silly", "Surprised"];
const animals = ["Panda", "Cat", "Dog", "Bird", "Fish", "Lizard", "Lion", "Tiger"];

// Function to generate a unique name for a user in a room
function generateUniqueName(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      users: {},
      usedEmotions: new Set(),
      usedAnimals: new Set(),
    };
  }

  let name = "";
  let emotion, animal;

  // Loop until a unique name is found
  while (true) {
    emotion = emotions[Math.floor(Math.random() * emotions.length)];
    animal = animals[Math.floor(Math.random() * animals.length)];

    if (!rooms[roomId].usedEmotions.has(emotion) && !rooms[roomId].usedAnimals.has(animal)) {
      rooms[roomId].usedEmotions.add(emotion);
      rooms[roomId].usedAnimals.add(animal);
      name = `${emotion}${animal}`;
      break;
    }
  }

  return { name, emotion, animal };
}

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  let currentRoom = null;
  let userName = null;
  let userEmotion = null;
  let userAnimal = null;

  socket.on("join-room", (roomId) => {
    if (currentRoom) {
      socket.leave(currentRoom);
      socket.to(currentRoom).emit("user-disconnected", socket.id);
      // Clean up user from the previous room
      if (rooms[currentRoom] && rooms[currentRoom].users[socket.id]) {
        const { emotion, animal } = rooms[currentRoom].users[socket.id];
        rooms[currentRoom].usedEmotions.delete(emotion);
        rooms[currentRoom].usedAnimals.delete(animal);
        delete rooms[currentRoom].users[socket.id];
      }
    }
    
    currentRoom = roomId;
    
    // Generate a unique name for the user
    const { name, emotion, animal } = generateUniqueName(roomId);
    userName = name;
    userEmotion = emotion;
    userAnimal = animal;

    // Store user information
    rooms[roomId].users[socket.id] = { name, emotion, animal };

    // Get list of existing users with their names
    const otherUsers = Object.entries(rooms[roomId].users)
      .filter(([id]) => id !== socket.id)
      .map(([id, { name }]) => ({ id, name }));

    socket.join(roomId);

    // Send the assigned name to the current user
    socket.emit("name-assigned", name);
    
    // Send existing users' info to the new user
    socket.emit("existing-users", otherUsers);

    // Send chat history to the new user
    chatDB.find({ roomId }).sort({ timestamp: 1 }).exec((err, messages) => {
      if (!err) {
        socket.emit('chat-history', messages);
      }
    });
    
    // Announce the new user to others in the room
    socket.to(roomId).emit("user-joined", { id: socket.id, name });
    
    console.log(`User ${socket.id} (${name}) joined room ${roomId}`);
  });

  socket.on('send-message', (message) => {
    const messageData = {
      roomId: currentRoom,
      name: userName,
      message: message,
      timestamp: new Date(),
    };
    chatDB.insert(messageData, (err, newMessage) => {
      if (!err) {
        io.to(currentRoom).emit('new-message', newMessage);
      }
    });
  });

  // Relay WebRTC signaling messages
  socket.on("offer", (payload) => {
    io.to(payload.target).emit("offer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("answer", (payload) => {
    io.to(payload.target).emit("answer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("ice-candidate", (payload) => {
    io.to(payload.target).emit("ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom].users[socket.id]) {
      // Free up the name for reuse
      rooms[currentRoom].usedEmotions.delete(userEmotion);
      rooms[currentRoom].usedAnimals.delete(userAnimal);
      delete rooms[currentRoom].users[socket.id];
      
      // Notify others in the room
      socket.to(currentRoom).emit("user-disconnected", socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
