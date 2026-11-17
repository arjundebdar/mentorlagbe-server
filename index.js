import express from "express";
import "dotenv/config";
import cors from "cors";

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Home route
app.get("/", (req, res) => {
  res.send("Mentor Lagbe Server Is Running!");
});

// Start server
app.listen(port, () => {
  console.log(`MentorLagbe server running on port ${port}`);
});
