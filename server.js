// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

const server = http.createServer(app);


const io = new Server(server, {
  cors: {
    origin: "https://pinch-client-app.vercel.app", 
    methods: ["GET", "POST"],
  },
  transports: ['polling', 'websocket'],
});

const PORT = 8000; 

io.on("connection", (socket) => {
  console.log(`⚡: New user connected: ${socket.id}`);

  socket.on("join-room", (roomId) => {
    console.log(`-> User ${socket.id} attempting to join room ${roomId}`);
    socket.join(roomId);
    console.log(`User ${socket.id} successfully joined room ${roomId}`);
    
    const otherUsers = [];
    const clientsInRoom = io.sockets.adapter.rooms.get(roomId);
    if (clientsInRoom) {
      clientsInRoom.forEach(clientId => {
        if (clientId !== socket.id) {
          otherUsers.push(clientId);
        }
      });
    }

    console.log(`<- Emitting 'existing-users' to ${socket.id} with users:`, otherUsers);
    socket.emit("existing-users", otherUsers);

    console.log(`<- Emitting 'user-joined' to room ${roomId} for user ${socket.id}`);
    socket.to(roomId).emit("user-joined", socket.id);
  });


  socket.on("offer", (payload) => {
    console.log(`-> Relaying 'offer' from ${socket.id} to ${payload.target}`);
    io.to(payload.target).emit("offer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("answer", (payload) => {
    console.log(`-> Relaying 'answer' from ${socket.id} to ${payload.target}`);
    io.to(payload.target).emit("answer", {
      sdp: payload.sdp,
      from: socket.id,
    });
  });

  socket.on("ice-candidate", (payload) => {
    console.log(`-> Relaying 'ice-candidate' from ${socket.id} to ${payload.target}`);
    io.to(payload.target).emit("ice-candidate", {
      candidate: payload.candidate,
      from: socket.id,
    });
  });


  socket.on("disconnect", () => {
    console.log(`🔥: User disconnected: ${socket.id}`);
    io.emit("user-disconnected", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});