import { useState } from "react";
import "./App.css";

function App() {
  const [isSignup, setIsSignup] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventTime, setEventTime] = useState("");

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
        await loadEvents();
        setPassword("")
      }
    } catch {
      setMessage("Could not connect to the server.")
    }
  }

  async function loadEvents() {
    const response = await fetch("/api/events");

    if (response.ok) {
      setEvents(await response.json());
    }
  }

  async function createEvent(e) {
    e.preventDefault();

    const response = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: eventTitle,
        description: eventDescription,
        date: eventDate,
        time: eventTime || null
      })
    });

    if (!response.ok) {
      setMessage("Could not create event.");
      return;
    }

    setEventTitle("");
    setEventDescription("");
    setEventDate("");
    setEventTime("");
    setMessage("");
    await loadEvents();
  }

  async function handleLogout() {
    const response = await fetch("/api/logout", {
      method: "POST"
    });

    if (!response.ok){
      setMessage("Could not log out.");
      return;
    }
    
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

        <h2>Create Event</h2>

        <form onSubmit={createEvent}>
          <input
              placeholder="Event title"
              value={eventTitle}
              onChange={e => setEventTitle(e.target.value)}
              required
          />

          <textarea
              placeholder="Description"
              value={eventDescription}
              onChange={e => setEventDescription(e.target.value)}
          />

          <input
              type="date"
              value={eventDate}
              onChange={e => setEventDate(e.target.value)}
              required
          />

          <input
              type="time"
              value={eventTime}
              onChange={e => setEventTime(e.target.value)}
          />

          <button type="submit">Create Event</button>
        </form>

        <p role="status">{message}</p>

        <h2>My Events</h2>

        {events.map(event => (
          <div key={event.id}>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
            <p>
              {event.date}
              {event.time ? ` at ${event.time}` : ""}
            </p>
          </div>
        ))}

        <button onClick={handleLogout}>Logout</button>
      </div>
    );
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
