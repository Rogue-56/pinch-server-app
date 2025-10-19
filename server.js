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
    origin: "https://pinch-client-app.vercel.app",
    methods: ["GET", "POST"],
  },
  transports: ['polling', 'websocket'],
});

const PORT = 8000;

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("join-room", (roomId) => {
    socket.join(roomId);
    
    // Get list of other users in the room
    const otherUsers = [];
    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (clientsInRoom) {
      clientsInRoom.forEach(clientId => {
        if (clientId !== socket.id) {
          otherUsers.push(clientId);
        }
      });
    }

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
    io.emit("user-disconnected", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});