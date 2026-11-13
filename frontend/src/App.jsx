import { useState } from "react";
import "./App.css";

function App() {
  const [isSignup, setIsSignup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setMessage("");

    try {
      const response = await fetch(
        `/api/${isSignup ? "signup" : "login"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ username, password })
        }
      );

      const data = await response.json();
      
      if (!response.ok) {
        setMessage(data.message);
        return;
      }

      if(isSignup){
        setMessage("Account created! You can now log in.")
        setIsSignup(false);
        setPassword("");
      } else {
        setCurrentUser({
          username: data.username,
          role: data.role
        });
        setPassword("")
      }
    } catch {
      setMessage("Could not connect to the server.")
    }
  }

  function handleLogout() {
    setCurrentUser(null);
    setUsername("");
    setPassword("");
    setMessage("");
  }

  if (currentUser) {
    return (
      <div className="welcome-page">
        <h1>
          {currentUser.role === "admin"
            ? `Welcome Admin ${currentUser.username}`
            : `Welcome ${currentUser.username}`}
        </h1>

        <button onClick={handleLogout}>
          Logout
        </button>
      </div>
    )
  }

  return (
    <div className="auth-container">
      <form onSubmit={handleSubmit} className="auth-card">
        <h1>{isSignup ? "Sign Up" : "Login"}</h1>

        <input
          type="text"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={
            isSignup ? "new-password" : "current-password"
          }
          required
        />

        <button type="submit">
          {isSignup ? "Create Account" : "Login"}
        </button>

        <p role="status">{message}</p>

        <button
          type="button"
          className="switch-button"
          onClick={() => {
            setIsSignup(!isSignup);
            setMessage("");
          }}
          >
            {isSignup
              ? "Already have an account? Login"
              : "Need an account? Sign Up"}
        </button>
      </form>
    </div>
  );
}

export default App
