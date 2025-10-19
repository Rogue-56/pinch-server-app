// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

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

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);
  
  // Track which room this socket is in
  let currentRoom = null;

  socket.on("join-room", (roomId) => {
    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      socket.to(currentRoom).emit("user-disconnected", socket.id);
    }
    
    currentRoom = roomId;
    
    // Get list of existing users BEFORE joining
    const otherUsers = [];
    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (clientsInRoom) {
      clientsInRoom.forEach(clientId => {
        if (clientId !== socket.id) {
          otherUsers.push(clientId);
        }
      });
    }
    
    // Now join the room
    socket.join(roomId);

    // Tell the new user about existing users
    socket.emit("existing-users", otherUsers);
    
    // Tell existing users about the new user
    socket.to(roomId).emit("user-joined", socket.id);
    
    console.log(`User ${socket.id} joined room ${roomId} (${otherUsers.length} existing users)`);
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
    // Only notify users in the same room
    if (currentRoom) {
      socket.to(currentRoom).emit("user-disconnected", socket.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});