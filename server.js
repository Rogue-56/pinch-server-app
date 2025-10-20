const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const Datastore = require('nedb');

const app = express();

// A simple route to check if the server is running.
app.get("/", (req, res) => {
  res.send("Pinch server is running");
});

const server = http.createServer(app);

// Configure the Socket.IO server.
const io = new Server(server, {
  path: "/socket.io/",
  cors: {
    origin: "https://pinch-client-app.onrender.com",
    methods: ["GET", "POST"],
  },
  transports: ['polling', 'websocket'],
});

const PORT = 8000;

// Create a NeDB database to store chat messages.
const chatDB = new Datastore({ filename: 'chat.db', autoload: true });

// In-memory storage for active rooms and users.
const activeRooms = {};

// Arrays for generating unique user names.
const emotions = ["Happy", "Sad", "Angry", "Excited", "Calm", "Anxious", "Silly", "Surprised"];
const animals = ["Panda", "Cat", "Dog", "Bird", "Fish", "Lizard", "Lion", "Tiger"];

/**
 * Generates a unique name for a user in a given room.
 * @param {string} roomId The ID of the room.
 * @returns {{name: string, emotion: string, animal: string}} The generated name and its components.
 */
function generateUniqueName(roomId) {
  if (!activeRooms[roomId]) {
    activeRooms[roomId] = {
      users: {},
      usedEmotions: new Set(),
      usedAnimals: new Set(),
      screenSharer: null,
    };
  }

  let name = "";
  let emotion, animal;

  // Keep generating names until a unique one is found.
  while (true) {
    emotion = emotions[Math.floor(Math.random() * emotions.length)];
    animal = animals[Math.floor(Math.random() * animals.length)];

    if (!activeRooms[roomId].usedEmotions.has(emotion) && !activeRooms[roomId].usedAnimals.has(animal)) {
      activeRooms[roomId].usedEmotions.add(emotion);
      activeRooms[roomId].usedAnimals.add(animal);
      name = `${emotion}${animal}`;
      break;
    }
  }

  return { name, emotion, animal };
}

// Handle socket connections.
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  let currentRoomId = null;
  let participantName = null;
  let participantEmotion = null;
  let participantAnimal = null;

  // When a user joins a room.
  socket.on("join-room", (roomId) => {
    // If the user is already in a room, leave it first.
    if (currentRoomId) {
      socket.leave(currentRoomId);
      socket.to(currentRoomId).emit("user-disconnected", socket.id);
      if (activeRooms[currentRoomId] && activeRooms[currentRoomId].users[socket.id]) {
        const { emotion, animal } = activeRooms[currentRoomId].users[socket.id];
        activeRooms[currentRoomId].usedEmotions.delete(emotion);
        activeRooms[currentRoomId].usedAnimals.delete(animal);
        delete activeRooms[currentRoomId].users[socket.id];
      }
    }
    
    currentRoomId = roomId;
    
    // Generate a unique name for the user.
    const { name, emotion, animal } = generateUniqueName(roomId);
    participantName = name;
    participantEmotion = emotion;
    participantAnimal = animal;

    activeRooms[roomId].users[socket.id] = { name, emotion, animal };

    // Get the list of existing participants in the room.
    const existingParticipants = Object.entries(activeRooms[roomId].users)
      .filter(([id]) => id !== socket.id)
      .map(([id, { name }]) => ({ id, name }));

    socket.join(roomId);

    // Send the assigned name and existing users to the new user.
    socket.emit("name-assigned", name);
    socket.emit("existing-users", existingParticipants);

    // Send the chat history to the new user.
    chatDB.find({ roomId }).sort({ timestamp: 1 }).exec((err, messages) => {
      if (!err) {
        socket.emit('chat-history', messages);
      }
    });
    
    // Notify other users in the room that a new user has joined.
    socket.to(roomId).emit("user-joined", { id: socket.id, name });

    // If someone is already sharing their screen, notify the new user.
    if (activeRooms[roomId].screenSharer) {
      const screenSharerUser = activeRooms[roomId].users[activeRooms[roomId].screenSharer];
      if (screenSharerUser) {
        socket.emit("user-started-screen-share", { id: activeRooms[roomId].screenSharer, name: screenSharerUser.name });
      }
    }
    
    console.log(`User ${socket.id} (${name}) joined room ${roomId}`);
  });

  // When a chat message is sent.
  socket.on('send-message', (message) => {
    const messageData = {
      roomId: currentRoomId,
      name: participantName,
      message: message,
      timestamp: new Date(),
    };
    // Store the message in the database.
    chatDB.insert(messageData, (err, newMessage) => {
      if (!err) {
        // Broadcast the new message to everyone in the room.
        io.to(currentRoomId).emit('new-message', newMessage);
      }
    });
  });

  // WebRTC signaling: forward the offer to the target user.
  socket.on("offer", (payload) => {
    io.to(payload.target).emit("offer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  // WebRTC signaling: forward the answer to the target user.
  socket.on("answer", (payload) => {
    io.to(payload.target).emit("answer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  // WebRTC signaling: forward the ICE candidate to the target user.
  socket.on("ice-candidate", (payload) => {
    io.to(payload.target).emit("ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });

  // When a user starts screen sharing.
  socket.on('start-screen-share', () => {
    if (activeRooms[currentRoomId]) {
      activeRooms[currentRoomId].screenSharer = socket.id;
      socket.to(currentRoomId).emit('user-started-screen-share', { id: socket.id, name: participantName });
    }
  });

  // When a user stops screen sharing.
  socket.on('stop-screen-share', () => {
    if (activeRooms[currentRoomId]) {
      activeRooms[currentRoomId].screenSharer = null;
      socket.to(currentRoomId).emit('user-stopped-screen-share', { id: socket.id });
    }
  });

  // WebRTC signaling for screen sharing: forward the offer.
  socket.on("screen-offer", (payload) => {
    io.to(payload.target).emit("screen-offer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  // WebRTC signaling for screen sharing: forward the answer.
  socket.on("screen-answer", (payload) => {
    io.to(payload.target).emit("screen-answer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  // WebRTC signaling for screen sharing: forward the ICE candidate.
  socket.on("screen-ice-candidate", (payload) => {
    io.to(payload.target).emit("screen-ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });

  // When a user disconnects.
  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoomId && activeRooms[currentRoomId]) {
      // If the user was sharing their screen, stop it.
      if (activeRooms[currentRoomId].screenSharer === socket.id) {
        activeRooms[currentRoomId].screenSharer = null;
        socket.to(currentRoomId).emit('user-stopped-screen-share', { id: socket.id });
      }

      // Remove the user from the room and free up their name.
      if (activeRooms[currentRoomId].users[socket.id]) {
        const { emotion, animal } = activeRooms[currentRoomId].users[socket.id];
        activeRooms[currentRoomId].usedEmotions.delete(emotion);
        activeRooms[currentRoomId].usedAnimals.delete(animal);
        delete activeRooms[currentRoomId].users[socket.id];
      }
      
      // Notify other users that this user has disconnected.
      socket.to(currentRoomId).emit("user-disconnected", socket.id);
    }
  });
});

// Start the server.
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
