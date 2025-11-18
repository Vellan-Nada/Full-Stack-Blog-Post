import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripePriceId = process.env.STRIPE_PRICE_ID;
const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;

const PLAN_LIMITS = {
  free: 4,
  premium: 20,
};
const DEFAULT_PLAN = "free";

app.use(cors());

/**
 * Stripe webhook has to consume the raw body so we register it
 * before Express starts parsing json for every other route.
 */
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe || !stripeWebhookSecret) {
      return res.status(400).json({ error: "Stripe webhook not configured." });
    }

    const signature = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        stripeWebhookSecret
      );
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const supabaseUserId = session.metadata?.supabaseUserId;

          if (supabaseUserId) {
            await supabase
              .from("profiles")
              .update({
                plan: "premium",
                stripe_customer_id: session.customer,
                stripe_subscription_id: session.subscription,
              })
              .eq("id", supabaseUserId);
          }
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object;
          await supabase
            .from("profiles")
            .update({
              plan: DEFAULT_PLAN,
              stripe_subscription_id: null,
            })
            .eq("stripe_customer_id", subscription.customer);
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (error) {
      console.error("Error handling Stripe webhook:", error.message);
      res.status(500).json({ error: "Failed to process webhook." });
    }
  }
);

app.use(express.json());

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return res.status(401).json({ error: "Missing auth token." });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Invalid auth token." });
    }

    req.user = data.user;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    res.status(500).json({ error: "Authentication failed." });
  }
};

const ensureProfile = async (user) => {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profile) {
    return profile;
  }

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  const { data: newProfile, error: insertError } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      plan: DEFAULT_PLAN,
    })
    .select()
    .single();

  if (insertError) {
    throw insertError;
  }

  return newProfile;
};

const getPlanLimit = (plan) => PLAN_LIMITS[plan] || PLAN_LIMITS[DEFAULT_PLAN];

const getBlogCount = async (userId) => {
  const { count, error } = await supabase
    .from("blogs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (error) {
    throw error;
  }

  return count || 0;
};

// profile & plan info
app.get("/profile", requireAuth, async (req, res) => {
  try {
    const profile = await ensureProfile(req.user);
    const blogCount = await getBlogCount(req.user.id);

    res.json({
      plan: profile.plan,
      blogCount,
      maxBlogs: getPlanLimit(profile.plan),
    });
  } catch (error) {
    console.error("Error fetching profile:", error.message);
    res.status(500).json({ error: "Failed to fetch profile." });
  }
});

// get data
app.get("/blogs", requireAuth, async (req, res) => {
  try {
    await ensureProfile(req.user);

    const { data, error } = await supabase
      .from("blogs")
      .select("*")
      .eq("user_id", req.user.id)
      .order("id", { ascending: true });

    if (error) {
      throw error;
    }

    res.json(data || []);
  } catch (error) {
    console.error("Error fetching blogs:", error.message);
    res.status(500).json({ error: "Failed to fetch blogs." });
  }
});

// add data
app.post("/blogs", requireAuth, async (req, res) => {
  try {
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required." });
    }

    const profile = await ensureProfile(req.user);
    const userBlogCount = await getBlogCount(req.user.id);
    const planLimit = getPlanLimit(profile.plan);

    if (userBlogCount >= planLimit) {
      return res.status(403).json({
        error: `Plan limit reached. Upgrade to add more than ${planLimit} blogs.`,
      });
    }

    const { data, error } = await supabase
      .from("blogs")
      .insert({
        title,
        content,
        user_id: req.user.id,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    res.json(data);
  } catch (error) {
    console.error("Error adding blog:", error.message);
    res.status(500).json({ error: "Failed to add blog." });
  }
});

// update data
app.put("/blogs/:id", requireAuth, async (req, res) => {
  try {
    const blogId = req.params.id;
    const { title, content } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required." });
    }

    const { data, error } = await supabase
      .from("blogs")
      .update({ title, content })
      .eq("id", blogId)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Blog not found." });
    }

    res.json(data);
  } catch (error) {
    console.error("Error updating blog:", error.message);
    res.status(500).json({ error: "Failed to update blog." });
  }
});

// delete data
app.delete("/blogs/:id", requireAuth, async (req, res) => {
  try {
    const blogId = req.params.id;

    const { data, error } = await supabase
      .from("blogs")
      .delete()
      .eq("id", blogId)
      .eq("user_id", req.user.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    if (!data) {
      return res.status(404).json({ error: "Blog not found." });
    }

    res.json({ message: "Blog deleted successfully." });
  } catch (error) {
    console.error("Error deleting blog:", error.message);
    res.status(500).json({ error: "Failed to delete blog." });
  }
});

// start Stripe Checkout
app.post("/billing/checkout", requireAuth, async (req, res) => {
  try {
    if (!stripe || !stripePriceId) {
      return res.status(500).json({ error: "Stripe not configured." });
    }

    const profile = await ensureProfile(req.user);
    if (profile.plan === "premium") {
      return res.status(400).json({ error: "You already have the premium plan." });
    }

    let customerId = profile.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email || undefined,
        metadata: {
          supabaseUserId: req.user.id,
        },
      });

      customerId = customer.id;
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("id", req.user.id);
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customerId,
      line_items: [
        {
          price: stripePriceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/billing-success`,
      cancel_url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/billing-cancel`,
      metadata: {
        supabaseUserId: req.user.id,
      },
    });

    res.json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    console.error("Error creating checkout session:", error.message);
    res.status(500).json({ error: "Failed to create checkout session." });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
