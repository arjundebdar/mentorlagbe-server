import express from "express";
import "dotenv/config";
import cors from "cors";
import { MongoClient, ObjectId } from 'mongodb';
import multer from "multer";
import Stripe from "stripe";

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

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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



// Admin sections Server Start

app.get("/admin-overview", async (req, res) => {
  try {
    // 1. Count total users
    const totalUsers = await usersCollection.countDocuments();

    // 2. Count students
    const totalStudents = await usersCollection.countDocuments({
      role: "student",
    });

    // 3. Count tutors
    const totalTutors = await usersCollection.countDocuments({
      role: "tutor",
    });

    // 4. Count total tuitions
    const totalTuitions = await tuitionsCollection.countDocuments();

    // 5. Count pending tuitions
    const pendingTuitions = await tuitionsCollection.countDocuments({
      approvalStatus: "pending",
    });

    // 6. Calculate successful payment revenue
    const revenueResult = await paymentsCollection.aggregate([
      {
        $match: {
          status: {
            $in: ["paid", "completed", "succeeded"],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: {
            $sum: {
              $convert: {
                input: "$amount",
                to: "double",
                onError: 0,
                onNull: 0,
              },
            },
          },
        },
      },
    ]).toArray();

    const totalRevenue = revenueResult[0]?.totalRevenue || 0;

    // 7. Get latest 5 registered users
    const recentUsers = await usersCollection
      .find(
        {},
        {
          projection: {
            name: 1,
            email: 1,
            role: 1,
            createdAt: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    // 8. Get latest 5 pending tuitions
    const pendingTuitionList = await tuitionsCollection
      .find({
        status: "pending",
      })
      .sort({ createdAt: -1 })
      .limit(5)
      .toArray();

    // 9. Send response
    res.status(200).send({
      success: true,

      stats: {
        totalUsers,
        totalStudents,
        totalTutors,
        totalTuitions,
        pendingTuitions,
        totalRevenue,
      },

      recentUsers,

      pendingTuitionList,
    });

  } catch (error) {
    console.error("Admin overview error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch admin overview",
    });
  }
}
);


// get all tutions 

app.get("/admin/tuitions", async (req, res) => {
  try {
    const tuitions = await tuitionsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    res.status(200).send({
      success: true,
      total: tuitions.length,
      tuitions,
    });

  } catch (error) {
    console.error("Get admin tuitions error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch tuitions",
    });
  }
}
);

// Aprove,reject and view



app.patch("/tuitions/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus, isActive } = req.body;

    // 1. Validate ID
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid tuition ID",
      });
    }

    // 2. Find tuition
    const tuition = await tuitionsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!tuition) {
      return res.status(404).send({
        success: false,
        message: "Tuition not found",
      });
    }

    // 3. Prepare update
    const updateFields = {
      updatedAt: new Date(),
    };

    // 4. Approve / Reject
    if (approvalStatus !== undefined) {
      if (
        !["approved", "rejected"].includes(approvalStatus)
      ) {
        return res.status(400).send({
          success: false,
          message: "Invalid approval status",
        });
      }

      updateFields.approvalStatus = approvalStatus;

      // Rejected tuition cannot remain active
      if (approvalStatus === "rejected") {
        updateFields.isActive = false;
      }
    }

    // 5. Active / Inactive
    else if (isActive !== undefined) {
      if (typeof isActive !== "boolean") {
        return res.status(400).send({
          success: false,
          message: "isActive must be boolean",
        });
      }

      if (
        tuition.approvalStatus !== "approved"
      ) {
        return res.status(400).send({
          success: false,
          message: "Only approved tuitions can be activated",
        });
      }

      updateFields.isActive = isActive;
    }

    // 6. Reject empty update
    else {
      return res.status(400).send({
        success: false,
        message: "Nothing to update",
      });
    }

    // 7. Update MongoDB
    const result = await tuitionsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: updateFields,
      }
    );

    if (!result.matchedCount) {
      return res.status(404).send({
        success: false,
        message: "Tuition not found",
      });
    }

    res.status(200).send({
      success: true,
      message: "Tuition updated successfully",
      modifiedCount: result.modifiedCount,
    });

  } catch (error) {
    console.error("Update tuition status error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to update tuition",
    });
  }
}
);


// ADMIN TRANSACTIONS API

app.get("/admin/transactions", async (req, res) => {
  try {
    // Only admin can access transactions
    if (req.user.role !== "admin") {
      return res.status(403).send({
        success: false,
        message: "Access denied. Admin only.",
      });
    }

    const transactions = await paymentsCollection
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    // Calculate transaction statistics
    const totalTransactions = transactions.length;

    const successfulTransactions = transactions.filter(
      (payment) =>
        payment.status === "paid" ||
        payment.paymentStatus === "paid"
    );

    const failedTransactions = transactions.filter(
      (payment) =>
        payment.status === "failed" ||
        payment.paymentStatus === "failed"
    );

    const pendingTransactions = transactions.filter(
      (payment) =>
        payment.status === "pending" ||
        payment.paymentStatus === "pending"
    );

    const totalRevenue = successfulTransactions.reduce(
      (total, payment) => total + Number(payment.amount || 0),
      0
    );

    res.status(200).send({
      success: true,
      stats: {
        totalTransactions,
        successfulTransactions: successfulTransactions.length,
        failedTransactions: failedTransactions.length,
        pendingTransactions: pendingTransactions.length,
        totalRevenue,
      },
      transactions,
    });
  } catch (error) {
    console.error("Admin transactions error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
});



// Admin sections Server Ends

// user section api Start


app.get("/users", async (req, res) => {
  const users = await usersCollection.find().toArray();

  res.status(200).send(users);

});


// Update User Role
app.patch("/users/role/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { role } = req.body;

    if (!["student", "tutor", "admin"].includes(role)) {
      return res.status(400).send({
        message: "Invalid user role",
      });
    }

    const result = await usersCollection.updateOne(
      { email: email },
      {
        $set: {
          role: role,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "User not found",
      });
    }

    res.send({
      success: true,
      message: "User role updated successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to update user role",
    });
  }
});
// Suspend / Activate User
app.patch("/users/:email", async (req, res) => {
  try {
    const email = decodeURIComponent(req.params.email);
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).send({
        message: "Invalid user status",
      });
    }

    const result = await usersCollection.updateOne(
      { email: email },
      {
        $set: {
          isActive: isActive,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "User not found",
      });
    }

    res.send({
      success: true,
      message: isActive
        ? "User activated successfully"
        : "User suspended successfully",
    });

  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to update user status",
    });
  }
});

// user api Ends

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
// Get Approved and Active Tuitions
app.get("/tuitions", async (req, res) => {
  try {
    const {
      search = "",
      classLevel = "",
      mode = "",
    } = req.query;

    const query = {
      approvalStatus: "approved",
      isActive: true,
    };

    if (search) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
      ];
    }

    if (classLevel) {
      query.classLevel = classLevel;
    }

    if (mode) {
      query.mode = mode;
    }

    const result = await tuitionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({
      message: "Failed to fetch tuitions",
    });
  }
});

// TUTOR DASHBOARD STATISTICS
// GET /dashboard/tutor-stats?email=tutor@example.com

app.get("/tutor-stats", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Tutor email is required",
      });
    }

    // 1. Total Tuitions
    const totalTuitions = await tuitionsCollection.countDocuments({
      tutorEmail: email,
    });

    // 2. Approved and Active Tuitions
    const approvedTuitions = await tuitionsCollection.countDocuments({
      tutorEmail: email,
      approvalStatus: "approved",
      isActive: true,
    });

    // 3. Total Applicants
    const totalApplicants = await applicationsCollection.countDocuments({
      tutorEmail: email,
    });

    // 4. Pending Tuitions
    const pendingTuitions = await tuitionsCollection.countDocuments({
      tutorEmail: email,
      approvalStatus: "pending",
    });

    res.status(200).send({
      success: true,
      stats: {
        totalTuitions,
        approvedTuitions,
        totalApplicants,
        pendingTuitions,
      },
    });

  } catch (error) {
    console.error("Tutor dashboard stats error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch tutor dashboard statistics",
    });
  }
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

// Get Tuition Details by ID
app.get("/tuitions/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({
        success: false,
        message: "Invalid tuition ID",
      });
    }

    const tuition = await tuitionsCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!tuition) {
      return res.status(404).send({
        success: false,
        message: "Tuition not found",
      });
    }

    res.status(200).send({
      success: true,
      tuition,
    });

  } catch (error) {
    console.error("Get tuition details error:", error);

    res.status(500).send({
      success: false,
      message: "Failed to fetch tuition details",
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

// toggle active status 
app.patch("/tuitions/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== "boolean") {
      return res.status(400).send({
        message: "Invalid status value",
      });
    }

    const result = await tuitionsCollection.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: {
          isActive: isActive,
        },
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).send({
        message: "Tuition not found",
      });
    }

    res.send({
      success: true,
      message: "Status updated successfully",
      isActive,
    });

  } catch (error) {
    console.error(error);

    res.status(500).send({
      message: "Failed to update tuition status",
    });
  }
});

// Tuition ends
const SUBSCRIPTION_PLANS = {
  student: {
    plan: "Pro",
    priceUsd: 10,
    unitAmount: 1000, // $10 in cents
  },
  tutor: {
    plan: "Pro",
    priceUsd: 15,
    unitAmount: 1500, // $15 in cents
  },
};
app.post("/payments/create-checkout-session", async (req, res) => {
  try {
    const { role, userEmail } = req.body;
    const normalizedRole = String(role || "").toLowerCase();

    const selectedPlan = SUBSCRIPTION_PLANS[normalizedRole];
    if (!selectedPlan) {
      return res.status(400).send({
        success: false,
        message: "Invalid role. Choose 'student' or 'tutor'.",
      });
    }

    if (!userEmail) {
      return res.status(400).send({
        success: false,
        message: "userEmail is required",
      });
    }

    const origin =
      req.headers.origin ||
      process.env.DB_CLIENT_URL ||
      "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: userEmail,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `MentorLagbe ${selectedPlan.plan} (${normalizedRole === "student" ? "Student" : "Tutor"})`,
              description: `${selectedPlan.plan} subscription plan for ${normalizedRole}`,
            },
            unit_amount: selectedPlan.unitAmount,
          },
          quantity: 1,
        },
      ],
      metadata: {
        role: normalizedRole,
        plan: selectedPlan.plan,
        userEmail,
      },
      success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/checkout?canceled=true`,
    });

    await paymentsCollection.insertOne({
      userEmail,
      role: normalizedRole,
      plan: selectedPlan.plan,
      amount: selectedPlan.priceUsd,
      currency: "USD",
      stripeSessionId: session.id,
      status: "pending",
      paymentStatus: "pending",
      createdAt: new Date(),
    });

    return res.status(200).send({
      success: true,
      url: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("Create checkout session error:", error);
    return res.status(500).send({
      success: false,
      message: error.message || "Failed to create checkout session",
    });
  }
});

// ==========================================
// 2. STRIPE WEBHOOK (VERIFY PAYMENT)
// POST /payments/webhook
// ==========================================
app.post(
  "/payments/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];

    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userEmail = session.metadata?.userEmail || session.customer_email;
      const role = session.metadata?.role;
      const plan = session.metadata?.plan || "Pro";

      await paymentsCollection.updateOne(
        { stripeSessionId: session.id },
        {
          $set: {
            status: "paid",
            paymentStatus: "paid",
            paidAt: new Date(),
            stripePaymentIntentId: session.payment_intent || null,
          },
        }
      );

      if (userEmail) {
        await usersCollection.updateOne(
          { email: userEmail },
          {
            $set: {
              subscriptionPlan: plan,
              ...(role ? { role } : {}),
              isPro: true,
              updatedAt: new Date(),
            },
          }
        );
      }
    }

    return res.status(200).json({ received: true });
  }
);

// ==========================================
// 3. USER PAYMENT HISTORY
// GET /payments?email=user@example.com
// ==========================================
app.get("/payments", async (req, res) => {
  try {
    const email = req.query.email || req.user?.email;

    if (!email) {
      return res.status(400).send({
        success: false,
        message: "Email is required to fetch payment history",
      });
    }

    const payments = await paymentsCollection
      .find({ userEmail: String(email) })
      .sort({ createdAt: -1 })
      .toArray();

    return res.status(200).send({
      success: true,
      total: payments.length,
      payments,
    });
  } catch (error) {
    console.error("Get payments error:", error);
    return res.status(500).send({
      success: false,
      message: "Failed to fetch payment history",
    });
  }
});
// strip end



// Student server start
// Student Dashboard Stats
app.get("/dashboard/student/stats", async (req, res) => {
  try {
    const email = req.query.email;

    if (!email) {
      return res.status(400).send({
        message: "Student email is required",
      });
    }

    const student = await usersCollection.findOne({ email });

    const filter = { studentEmail: email };

    const [
      totalApplications,
      acceptedApplications,
      pendingApplications,
      recentApplications,
    ] = await Promise.all([
      applicationsCollection.countDocuments(filter),

      applicationsCollection.countDocuments({
        ...filter,
        status: "accepted",
      }),

      applicationsCollection.countDocuments({
        ...filter,
        status: "pending",
      }),

      applicationsCollection
        .find(filter)
        .sort({ appliedAt: -1 })
        .limit(5)
        .toArray(),
    ]);

    res.send({
      totalApplications,
      acceptedApplications,
      pendingApplications,
      plan: student?.plan || "free",
      recentApplications,
    });
  } catch (error) {
    res.status(500).send({
      message: "Failed to load student dashboard",
    });
  }
});

// Student server start


// Start server
app.listen(port, () => {
  console.log(`MentorLagbe server running on port ${port}`);
});
export default app;