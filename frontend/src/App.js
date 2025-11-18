import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Header from "./Header";
import Footer from "./Footer";
import Blog from "./Blog";
import "./style.css";
import { supabase } from "./supabaseClient";

const API_BASE_URL = process.env.REACT_APP_API_URL || "http://localhost:5000";

function App() {
  const [blog, setBlog] = useState({ title: "", content: "" });
  const [blogs, setBlogs] = useState([]);
  const [createPost, setCreatePost] = useState(false);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [authForm, setAuthForm] = useState({ email: "", password: "" });
  const [authMode, setAuthMode] = useState("login");
  const [authError, setAuthError] = useState("");
  const [upgradeLoading, setUpgradeLoading] = useState(false);

  const loadBlogs = useCallback(async () => {
    if (!session) return;

    try {
      const result = await axios.get(`${API_BASE_URL}/blogs`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setBlogs(result.data);
    } catch (error) {
      console.error(error);
      setStatusMessage(error.response?.data?.error || "Failed to load blogs.");
    }
  }, [session]);

  const loadProfile = useCallback(async () => {
    if (!session) return;

    try {
      const result = await axios.get(`${API_BASE_URL}/profile`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setProfile(result.data);
    } catch (error) {
      console.error(error);
      setStatusMessage(error.response?.data?.error || "Failed to load profile.");
    }
  }, [session]);

  useEffect(() => {
    const initSession = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      } finally {
        setCheckingSession(false);
      }
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      if (!currentSession) {
        setBlogs([]);
        setProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;

    const fetchData = async () => {
      setDataLoading(true);
      await Promise.all([loadBlogs(), loadProfile()]);
      setDataLoading(false);
    };

    fetchData();
  }, [session, loadBlogs, loadProfile]);

  const newPost = (event) => {
    const { name, value } = event.target;
    setBlog((prev) => ({ ...prev, [name]: value }));
  };

  const submitPost = async () => {
    if (!session) return;
    if (blog.title === "" || blog.content === "") {
      setStatusMessage("Title and content are required.");
      return;
    }

    if (profile && profile.blogCount >= profile.maxBlogs) {
      setStatusMessage(
        `You have reached your plan limit of ${profile.maxBlogs} blogs.`
      );
      return;
    }

    try {
      const result = await axios.post(`${API_BASE_URL}/blogs`, blog, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setBlogs((prev) => [...prev, result.data]);
      setProfile((prev) =>
        prev ? { ...prev, blogCount: prev.blogCount + 1 } : prev
      );
      setCreatePost(false);
      setBlog({ title: "", content: "" });
      setStatusMessage("");
    } catch (error) {
      console.error(error);
      setStatusMessage(error.response?.data?.error || "Failed to add blog.");
    }
  };

  const editBlog = async (id, editedBlog) => {
    if (!session) return;
    try {
      const result = await axios.put(
        `${API_BASE_URL}/blogs/${id}`,
        editedBlog,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );
      setBlogs((prev) =>
        prev.map((item) => (item.id === id ? result.data : item))
      );
      setStatusMessage("");
    } catch (error) {
      console.error(error);
      setStatusMessage(error.response?.data?.error || "Failed to update blog.");
    }
  };

  const deleteBlog = async (id) => {
    if (!session) return;
    try {
      await axios.delete(`${API_BASE_URL}/blogs/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      setBlogs((prev) => prev.filter((item) => item.id !== id));
      setProfile((prev) =>
        prev ? { ...prev, blogCount: Math.max(prev.blogCount - 1, 0) } : prev
      );
      setStatusMessage("");
    } catch (error) {
      console.error(error);
      setStatusMessage(error.response?.data?.error || "Failed to delete blog.");
    }
  };

  const handleAuthChange = (event) => {
    const { name, value } = event.target;
    setAuthForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError("");

    if (!authForm.email || !authForm.password) {
      setAuthError("Email and password are required.");
      return;
    }

    try {
      if (authMode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({
          email: authForm.email,
          password: authForm.password,
        });
        if (error) throw error;
      }
      setAuthForm({ email: "", password: "" });
    } catch (error) {
      setAuthError(error.message);
    }
  };

  const handleOAuthLogin = async () => {
    setAuthError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setAuthError(error.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setBlogs([]);
    setProfile(null);
    setCreatePost(false);
    setStatusMessage("");
  };

  const startUpgrade = async () => {
    if (!session) return;

    try {
      setUpgradeLoading(true);
      const result = await axios.post(
        `${API_BASE_URL}/billing/checkout`,
        {},
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        }
      );
      window.location.href = result.data.checkoutUrl;
    } catch (error) {
      console.error(error);
      setStatusMessage(
        error.response?.data?.error || "Unable to start checkout."
      );
    } finally {
      setUpgradeLoading(false);
    }
  };

  const reachedLimit =
    profile && profile.blogCount >= profile.maxBlogs ? true : false;

  if (checkingSession) {
    return (
      <div>
        <Header />
        <p>Loading...</p>
        <Footer />
      </div>
    );
  }

  return (
    <div>
      <Header />

      {session ? (
        <>
          <div className="user-bar">
            <p>{session.user?.email}</p>
            <button onClick={handleSignOut}>Sign Out</button>
          </div>

          {profile && (
            <div className="plan-card">
              <p>
                Plan: <strong>{profile.plan}</strong>
              </p>
              <p>
                Blogs used: {profile.blogCount} / {profile.maxBlogs}
              </p>
              {profile.plan === "free" && (
                <button onClick={startUpgrade} disabled={upgradeLoading}>
                  {upgradeLoading ? "Redirecting..." : "Upgrade for $5/month"}
                </button>
              )}
            </div>
          )}

          {statusMessage && <div className="status">{statusMessage}</div>}

          {!createPost && (
            <button
              onClick={() => setCreatePost(true)}
              disabled={reachedLimit || dataLoading}
            >
              + Create New Blog
            </button>
          )}

          {createPost && (
            <div>
              <input
                name="title"
                type="text"
                value={blog.title}
                onChange={newPost}
                placeholder="Title..."
              ></input>
              <textarea
                name="content"
                rows="5"
                value={blog.content}
                onChange={newPost}
                placeholder="Content..."
              ></textarea>
              <button onClick={submitPost}>Save</button>
              <button
                onClick={() => {
                  setCreatePost(false);
                  setBlog({ title: "", content: "" });
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {reachedLimit && (
            <p className="notice">
              You have reached your plan limit. Upgrade to add more blogs.
            </p>
          )}

          <hr />
          <h2>Blog List</h2>
          {dataLoading && <p>Loading your blogs...</p>}
          {!dataLoading &&
            blogs.map((blogItem) => (
              <Blog
                key={blogItem.id}
                id={blogItem.id}
                title={blogItem.title}
                content={blogItem.content}
                onDelete={deleteBlog}
                onEdit={editBlog}
              />
            ))}
        </>
      ) : (
        <div className="auth-card">
          <h2>{authMode === "login" ? "Login" : "Create Account"}</h2>
          <form onSubmit={handleAuthSubmit}>
            <input
              name="email"
              type="email"
              value={authForm.email}
              onChange={handleAuthChange}
              placeholder="Email address"
              required
            />
            <input
              name="password"
              type="password"
              value={authForm.password}
              onChange={handleAuthChange}
              placeholder="Password"
              required
            />
            <button type="submit">
              {authMode === "login" ? "Sign In" : "Sign Up"}
            </button>
          </form>
          <button onClick={handleOAuthLogin}>Continue with Google</button>
          <button
            className="link-button"
            type="button"
            onClick={() =>
              setAuthMode((prev) => (prev === "login" ? "signup" : "login"))
            }
          >
            {authMode === "login"
              ? "Need an account? Sign up"
              : "Already have an account? Sign in"}
          </button>
          {authError && <p className="status error">{authError}</p>}
        </div>
      )}

      <Footer />
    </div>
  );
}

export default App;
