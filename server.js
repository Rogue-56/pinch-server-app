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

const chatDB = new Datastore({ filename: 'chat.db', autoload: true });

const activeRooms = {};

const emotions = ["Happy", "Sad", "Angry", "Excited", "Calm", "Anxious", "Silly", "Surprised"];
const animals = ["Panda", "Cat", "Dog", "Bird", "Fish", "Lizard", "Lion", "Tiger"];

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

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  let currentRoomId = null;
  let participantName = null;
  let participantEmotion = null;
  let participantAnimal = null;

  socket.on("join-room", (roomId) => {
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
    
    const { name, emotion, animal } = generateUniqueName(roomId);
    participantName = name;
    participantEmotion = emotion;
    participantAnimal = animal;

    activeRooms[roomId].users[socket.id] = { name, emotion, animal };

    const existingParticipants = Object.entries(activeRooms[roomId].users)
      .filter(([id]) => id !== socket.id)
      .map(([id, { name }]) => ({ id, name }));

    socket.join(roomId);

    socket.emit("name-assigned", name);
    
    socket.emit("existing-users", existingParticipants);

    chatDB.find({ roomId }).sort({ timestamp: 1 }).exec((err, messages) => {
      if (!err) {
        socket.emit('chat-history', messages);
      }
    });
    
    socket.to(roomId).emit("user-joined", { id: socket.id, name });

    if (activeRooms[roomId].screenSharer) {
      const screenSharerUser = activeRooms[roomId].users[activeRooms[roomId].screenSharer];
      if (screenSharerUser) {
        socket.emit("user-started-screen-share", { id: activeRooms[roomId].screenSharer, name: screenSharerUser.name });
      }
    }
    
    console.log(`User ${socket.id} (${name}) joined room ${roomId}`);
  });

  socket.on('send-message', (message) => {
    const messageData = {
      roomId: currentRoomId,
      name: participantName,
      message: message,
      timestamp: new Date(),
    };
    chatDB.insert(messageData, (err, newMessage) => {
      if (!err) {
        io.to(currentRoomId).emit('new-message', newMessage);
      }
    });
  });

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

  socket.on('start-screen-share', () => {
    if (activeRooms[currentRoomId]) {
      activeRooms[currentRoomId].screenSharer = socket.id;
      socket.to(currentRoomId).emit('user-started-screen-share', { id: socket.id, name: participantName });
    }
  });

  socket.on('stop-screen-share', () => {
    if (activeRooms[currentRoomId]) {
      activeRooms[currentRoomId].screenSharer = null;
      socket.to(currentRoomId).emit('user-stopped-screen-share', { id: socket.id });
    }
  });

  socket.on("screen-offer", (payload) => {
    io.to(payload.target).emit("screen-offer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("screen-answer", (payload) => {
    io.to(payload.target).emit("screen-answer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("screen-ice-candidate", (payload) => {
    io.to(payload.target).emit("screen-ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    if (currentRoomId && activeRooms[currentRoomId]) {
      if (activeRooms[currentRoomId].screenSharer === socket.id) {
        activeRooms[currentRoomId].screenSharer = null;
        socket.to(currentRoomId).emit('user-stopped-screen-share', { id: socket.id });
      }

      if (activeRooms[currentRoomId].users[socket.id]) {
        const { emotion, animal } = activeRooms[currentRoomId].users[socket.id];
        activeRooms[currentRoomId].usedEmotions.delete(emotion);
        activeRooms[currentRoomId].usedAnimals.delete(animal);
        delete activeRooms[currentRoomId].users[socket.id];
      }
      
      socket.to(currentRoomId).emit("user-disconnected", socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});