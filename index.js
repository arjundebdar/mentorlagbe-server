import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import multer from "multer";


const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors({
  origin: process.env.DB_CLIENT_URL,
  credentials: true,
}));
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// Mongodb connection
const client = new MongoClient(`mongodb://${process.env.MONGODB_USER_ID}:${process.env.MONGODB_PASSWORD}@ac-fnhayin-shard-00-00.1gmbeud.mongodb.net:27017,ac-fnhayin-shard-00-01.1gmbeud.mongodb.net:27017,ac-fnhayin-shard-00-02.1gmbeud.mongodb.net:27017/?ssl=true&replicaSet=atlas-ki9uz8-shard-0&authSource=admin`);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client.db(process.env.DB_NAME);
  } catch (err) {
    console.dir(err);
  }
}

const db = await connectToMongoDB();
const usersCollection = db.collection("user");
const tuitionsCollection = db.collection("tuitions");
const applicationsCollection = db.collection("applications");
const paymentsCollection = db.collection("payments");



// Home route
app.get("/", (req, res) => {
  res.send("Mentor Lagbe Server Is Running!");
});

// user section api


app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();

  res.status(200).send(users);

});

// Tution API Starts

// Post a new tuition
app.post("/tuitions", upload.single("image"), async (req, res) => {
  try {
    // 1. Get form data
    const {
      title,
      subject,
      classLevel,
      mode,
      location,
      monthlyFee,
      daysPerWeek,
      description,
      tutorName,
      tutorEmail
    } = req.body;

    // 2. Check image
    if (!req.file) {
      return res.status(400).send({
        success: false,
        message: "Tuition image is required"
      });
    }

    // 3. Upload image to ImgBB
    const imageData = new URLSearchParams();

    imageData.append("image", req.file.buffer.toString("base64"));

    const imageResponse = await fetch(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      {
        method: "POST",
        body: imageData
      }
    );

    const imageResult = await imageResponse.json();

    if (!imageResponse.ok || !imageResult.success) {
      throw new Error("Image upload failed");
    }

    const bannerImage = imageResult.data.url;

    // 4. Create tuition object
    const newTuition = {
      title,
      subject,
      classLevel,
      mode,
      location,
      monthlyFee: Number(monthlyFee),
      daysPerWeek: Number(daysPerWeek),
      description,
      tutorName,
      tutorEmail,
      bannerImage,
      approvalStatus: "pending",
      createdAt: new Date()
    };

    // 5. Save to MongoDB
    const result = await db
      .collection("tuitions")
      .insertOne(newTuition);

    // 6. Send response
    res.status(201).send({
      success: true,
      message: "Tuition posted successfully",
      insertedId: result.insertedId,
      bannerImage
    });

  } catch (error) {
    console.error("Post tuition error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to post tuition"
    });
  }
});

app.get("/tuitions/my-tuitions", async (req, res) => {
  const tuitions = await tuitionsCollection.find().toArray();

  res.status(200).send(tuitions);

});

// Get Tutions by id
app.patch("/tuitions/:id", async (req, res) => {
  console.log("PATCH ROUTE HIT");
  console.log("Tuition ID:", req.params.id);
  console.log("Request Body:", req.body);
  try {
    const { id } = req.params;

    const {
      title,
      subject,
      classLevel,
      mode,
      location,
      monthlyFee,
      daysPerWeek,
      description,
    } = req.body;

    const updatedData = {
      title,
      subject,
      classLevel,
      mode,
      location,
      monthlyFee: Number(monthlyFee),
      daysPerWeek: Number(daysPerWeek),
      description,
      updatedAt: new Date(),
    };

    const result = await tuitionsCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Tuition not found",
      });
    }

    const updatedTuition = await tuitionsCollection.findOne({
      _id: new ObjectId(id),
    });

    res.send({
      success: true,
      message: "Tuition updated successfully",
      tuition: updatedTuition,
    });

  } catch (error) {
    console.error("Tuition update error:", error);

    res.status(500).send({
      message: "Failed to update tuition",
    });
  }
});

// delete Tuitons by id;
app.delete('/tuitions/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await tuitionsCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount === 0) {
      return res.status(404).send({
        message: "Tuition not found",
      });
    }

    res.send({
      success: true,
      message: "Tuition deleted successfully",
    });

  } catch (error) {
    res.status(500).send({
      message: "Failed to delete tuition",
      error: error.message,
    });
  }
})

// Tuition ends



// Start server
app.listen(port, () => {
  console.log(`MentorLagbe server running on port ${port}`);
});
export default app;