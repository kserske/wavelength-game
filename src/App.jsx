import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { useState, useEffect, useRef, useCallback } from "react";

const CLUE_PAIRS = [
  ["Cold","Hot"],["Ugly","Beautiful"],["Weak","Strong"],["Simple","Complex"],
  ["Cheap","Expensive"],["Boring","Exciting"],["Tiny","Massive"],["Dark","Bright"],
  ["Slow","Fast"],["Bad","Good"],["Ancient","Modern"],["Silent","Deafening"],
  ["Soft","Hard"],["Safe","Dangerous"],["Natural","Artificial"],["Common","Rare"],
  ["Serious","Funny"],["Realistic","Fantastical"],["Healthy","Unhealthy"],
  ["Abstract","Concrete"],["Dull","Vibrant"],["Fragile","Sturdy"],
  ["Pessimistic","Optimistic"],["Fictional","Real"],["Relaxing","Stressful"],
];

const ZONES = [
  { pts: 4, half: 0.03, color: "#22c55e" },
  { pts: 3, half: 0.09, color: "#84cc16" },
  { pts: 2, half: 0.17, color: "#f59e0b" },
  { pts: 0, half: 0.50, color: "#ef4444" },
];

const PHASE = { LOBBY:"lobby", CLUE:"clue", GUESS:"guess", REVEAL:"reveal" };
const POLL_MS = 1500;
const ROUNDS_PER_PLAYER = 3; // each player gets 3 turns as Psychic

function randCode() { return Math.random().toString(36).slice(2,6).toUpperCase(); }
function randTarget() { return parseFloat((Math.random()).toFixed(4)); }
function randPair() { return CLUE_PAIRS[Math.floor(Math.random() * CLUE_PAIRS.length)]; }
function scoreGuess(target, guess) {
  const d = Math.abs(target - guess);
  if (d <= ZONES[0].half) return 4;
  if (d <= ZONES[1].half) return 3;
  if (d <= ZONES[2].half) return 2;
  return 0;
}

// Get or create a stable player ID stored in localStorage
function getMyId() {
  let id = localStorage.getItem("wl_player_id");
  if (!id) {
    id = "u_" + Math.random().toString(36).slice(2, 8);
    localStorage.setItem("wl_player_id", id);
  }
  return id;
}

const firebaseConfig = {
  apiKey: "AIzaSyDFSlbnBbHJ6M30RdO2gipyXTn2Tfdc2oM",
  authDomain: "wavelength-game-92b00.firebaseapp.com",
  projectId: "wavelength-game-92b00",
  storageBucket: "wavelength-game-92b00.firebasestorage.app",
  messagingSenderId: "779240323317",
  appId: "1:779240323317:web:1b229c4383a6e55a97adbc",
  measurementId: "G-1M028V46KC"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Firestore cannot store undefined values — strip them out before saving
function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj));
}

async function saveRoom(code, data) {
  await setDoc(doc(db, "rooms", code), sanitize(data));
}

async function loadRoom(code) {
  const snap = await getDoc(doc(db, "rooms", code));
  return snap.exists() ? snap.data() : null;
}

// 12 distinct player colours for reveal needles
const PLAYER_COLORS = [
  "#6366f1","#f43f5e","#f59e0b","#10b981","#3b82f6","#8b5cf6",
  "#ec4899","#14b8a6","#f97316","#06b6d4","#84cc16","#e11d48"
];

function Dial({ target, guess, showTarget, onGuessChange, interactive, pair, allGuesses, players, myId: dialMyId }) {
  const canvasRef = useRef(null);
  const dragging  = useRef(false);

  const CW = 400, CH = 220;
  const cx = 200, cy = 218;
  const Ro = 192, Ri = 108;

  // Canvas angle for spectrum position: pos=0 → π (left), pos=1 → 0 (right)
  function posA(pos) { return Math.PI * (1 - pos); }
  function posXY(pos, r) {
    const a = posA(pos);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  }

  // Draw a donut wedge from pos0→pos1 using the clip trick:
  // 1. Save context, set clip to a pie-slice shape (or top-half rect for full arc)
  // 2. Draw two full circles (outer - inner) filled with evenodd rule
  // 3. Restore — zero arc direction ambiguity
  function drawBand(ctx, pos0, pos1, color) {
    if (pos1 <= pos0) return;
    ctx.save();
    ctx.beginPath();
    if (pos1 - pos0 >= 0.999) {
      // Full semicircle: clip rect covers exactly the top half of the canvas
      ctx.rect(0, 0, CW, cy);
    } else {
      // Wedge clip from pivot through pos0 arc to pos1
      const [lx, ly] = posXY(pos0, Ro + 5);
      ctx.moveTo(cx, cy);
      ctx.lineTo(lx, ly);
      // posA(pos0) > posA(pos1) — clockwise sweep traces the TOP arc correctly
      ctx.arc(cx, cy, Ro + 5, posA(pos0), posA(pos1), false);
      ctx.lineTo(cx, cy);
    }
    ctx.clip();

    // Donut ring: outer CW + inner CCW → evenodd fills ring only
    ctx.beginPath();
    ctx.arc(cx, cy, Ro, 0, Math.PI * 2, false);
    ctx.arc(cx, cy, Ri, 0, Math.PI * 2, true);
    ctx.fillStyle = color;
    ctx.fill("evenodd");  // ← evenodd is essential: makes inner circle a hole
    ctx.restore();
  }

  function drawNeedle(ctx, pos, color, width, dashed) {
    const [tx, ty] = posXY(pos, Ro - 6);
    ctx.save();
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(tx, ty);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(tx, ty, width + 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(tx, ty, width + 1, 0, Math.PI * 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, CW, CH);

    if (showTarget) {
      const t = Math.max(0, Math.min(1, target));
      // Compute zone boundaries (clamped to [0,1])
      const lo4 = Math.max(0, t - 0.03), hi4 = Math.min(1, t + 0.03);
      const lo3 = Math.max(0, t - 0.09), hi3 = Math.min(1, t + 0.09);
      const lo2 = Math.max(0, t - 0.17), hi2 = Math.min(1, t + 0.17);

      // Draw widest first, narrowest last — each layer paints over the previous
      drawBand(ctx, 0,   1,   "#d1d5db"); // 0pt grey  (full ring)
      drawBand(ctx, lo2, hi2, "#f59e0b"); // 2pt orange
      drawBand(ctx, lo3, hi3, "#84cc16"); // 3pt yellow-green
      drawBand(ctx, lo4, hi4, "#22c55e"); // 4pt green  (innermost)

      // White dividers at boundaries that are inside [0.01, 0.99]
      [lo2, lo3, lo4, hi4, hi3, hi2]
        .filter(v => v > 0.01 && v < 0.99)
        .forEach(pos => {
          const [x0, y0] = posXY(pos, Ri - 2);
          const [x1, y1] = posXY(pos, Ro + 2);
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        });

      // Pt labels at midpoint of each visible band
      const Rm = (Ro + Ri) / 2;
      ctx.font = "bold 11px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      [
        [lo2, lo3, "2pt"], [lo3, lo4, "3pt"],
        [lo4, hi4, "4pt"],
        [hi4, hi3, "3pt"], [hi3, hi2, "2pt"],
      ].forEach(([p0, p1, label]) => {
        if (p1 - p0 > 0.015) {
          const [lx, ly] = posXY((p0 + p1) / 2, Rm);
          ctx.fillText(label, lx, ly);
        }
      });

      // Needles
      if (allGuesses && players) {
        players
          .filter(p => allGuesses[p.id] !== undefined)
          .forEach((p, i) =>
            drawNeedle(ctx, allGuesses[p.id], PLAYER_COLORS[i % PLAYER_COLORS.length], 3, false)
          );
      } else {
        drawNeedle(ctx, target, "#15803d", 3, true);
      }

    } else {
      // Guesser: plain grey ring + indigo needle
      drawBand(ctx, 0, 1, "#d1d5db");
      drawNeedle(ctx, guess, "#6366f1", 4, false);
    }

    // White inner disc hides pivot area
    ctx.beginPath();
    ctx.arc(cx, cy, Ri - 1, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();

    // Thin border arcs (top half only)
    ctx.beginPath();
    ctx.arc(cx, cy, Ro, Math.PI, 0, false);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, Ri, Math.PI, 0, false);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pivot dot
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fillStyle = "#e2e8f0";
    ctx.fill();

  }, [target, guess, showTarget, allGuesses, players]);

  function getPos(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const ex = e.touches ? e.touches[0].clientX : e.clientX;
    const ey = e.touches ? e.touches[0].clientY : e.clientY;
    const x = ((ex - rect.left) / rect.width) * CW;
    const y = ((ey - rect.top) / rect.height) * CH;
    const angle = Math.atan2(cy - y, x - cx);
    return parseFloat((1 - Math.max(0, Math.min(Math.PI, angle)) / Math.PI).toFixed(4));
  }

  function handleDown(e) {
    if (!interactive) return;
    dragging.current = true;
    onGuessChange(getPos(e));
  }

  useEffect(() => {
    function move(e) { if (dragging.current && interactive) onGuessChange(getPos(e)); }
    function up()   { dragging.current = false; }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [interactive, onGuessChange]);

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6, padding:"0 4px" }}>
        <span style={{ fontSize:14, fontWeight:700, color:"#3b82f6" }}>{pair[0]}</span>
        <span style={{ fontSize:14, fontWeight:700, color:"#f43f5e" }}>{pair[1]}</span>
      </div>
      <canvas ref={canvasRef} width={CW} height={CH}
        style={{ display:"block", width:"100%", cursor: interactive ? "crosshair" : "default", touchAction:"none" }}
        onMouseDown={handleDown} onTouchStart={handleDown}
      />
      <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginTop:8 }}>
        {showTarget && [
          { color:"#22c55e", label:"4pt" },
          { color:"#84cc16", label:"3pt" },
          { color:"#f59e0b", label:"2pt" },
          { color:"#d1d5db", label:"0pt" },
        ].map(item => (
          <div key={item.label} style={{ display:"flex", alignItems:"center", gap:3, fontSize:11 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:item.color, border:"1px solid #e2e8f0" }}/>
            <span style={{ color:"#64748b" }}>{item.label}</span>
          </div>
        ))}
        {allGuesses && players && players.filter(p => allGuesses[p.id] !== undefined).map((p, i) => (
          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:3, fontSize:11 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}/>
            <span style={{ color: p.id === dialMyId ? "#1e293b" : "#64748b", fontWeight: p.id === dialMyId ? 700 : 400 }}>
              {p.name}{p.id === dialMyId ? " (you)" : ""}
            </span>
          </div>
        ))}
        {!allGuesses && !showTarget && (
          <div style={{ display:"flex", alignItems:"center", gap:3, fontSize:11 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:"#6366f1" }}/>
            <span style={{ color:"#64748b" }}>your guess</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Timer({ deadline, onExpire, warning = 10 }) {
  const [secs, setSecs] = useState(null);

  useEffect(() => {
    if (!deadline) return;
    function tick() {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecs(remaining);
      if (remaining === 0 && onExpire) onExpire();
    }
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [deadline]);

  if (secs === null || !deadline) return null;

  const mins = Math.floor(secs / 60);
  const s = secs % 60;
  const label = `${mins}:${String(s).padStart(2, "0")}`;
  const isWarning = secs <= warning;
  const isUrgent  = secs <= 5;

  return (
    <div style={{
      display:"inline-flex", alignItems:"center", gap:5,
      padding:"4px 12px", borderRadius:99,
      background: isUrgent ? "#fef2f2" : isWarning ? "#fef9c3" : "#f0fdf4",
      border: `1.5px solid ${isUrgent ? "#fca5a5" : isWarning ? "#fde047" : "#bbf7d0"}`,
      fontSize:13, fontWeight:700,
      color: isUrgent ? "#dc2626" : isWarning ? "#a16207" : "#15803d",
      animation: isUrgent ? "pulse 0.7s ease-in-out infinite" : "none",
    }}>
      <span style={{ fontSize:11 }}>⏱</span>
      {label}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }`}</style>
    </div>
  );
}

function Scoreboard({ players, highlight }) {
  const sorted = [...players].sort((a,b) => b.score - a.score);
  return (
    <div style={{ background:"#f8fafc", borderRadius:12, border:"1px solid #e2e8f0", overflow:"hidden" }}>
      <div style={{ padding:"8px 14px", background:"#f1f5f9", borderBottom:"1px solid #e2e8f0" }}>
        <span style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:1 }}>SCOREBOARD</span>
      </div>
      {sorted.map((p,i) => {
        const maxScore = players.reduce((m, pl) => Math.max(m, pl.score), 1);
        const pct = Math.min(100, (p.score / maxScore) * 100);
        return (
          <div key={p.id} style={{
            padding:"8px 14px", borderBottom: i<sorted.length-1?"1px solid #f1f5f9":"none",
            background: p.id===highlight ? "#ede9fe44" : "transparent"
          }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
              <span style={{ fontSize:12, color:"#94a3b8", width:20, textAlign:"center", fontWeight:700 }}>
                {i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`}
              </span>
              <span style={{ flex:1, fontSize:13, fontWeight: p.id===highlight?700:500, color:"#1e293b" }}>
                {p.name}{p.id===highlight?" (you)":""}
              </span>
              <span style={{ fontSize:14, fontWeight:700, color:"#6366f1" }}>{p.score}</span>
            </div>
            <div style={{ marginLeft:28, height:4, background:"#e2e8f0", borderRadius:99, overflow:"hidden" }}>
              <div style={{ height:"100%", width:`${pct}%`, background:"#6366f1", borderRadius:99, transition:"width .4s ease" }}/>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function App() {
  const [screen, setScreen] = useState("home");
  const [myId] = useState(() => getMyId());
  const [myName, setMyName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [guess, setGuess] = useState(0.5);
  const [clueInput, setClueInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);
  // These MUST be here at the top — hooks cannot be called after conditional returns
  const clueTimedOut = useRef(false);
  const guessTimedOut = useRef(false);

  const isHost = room?.hostId === myId;
  const isPsychic = room?.psychicId === myId;
  const myGuessVal = room?.guesses?.[myId];
  const isRevealed = room?.phase === PHASE.REVEAL;
  const psychicPlayer = room?.players?.find(p => p.id === room?.psychicId);

  const poll = useCallback(async () => {
    if (!roomCode) return;
    try {
      const data = await loadRoom(roomCode);
      if (data) setRoom(data);
    } catch(e) {
      console.error("Poll error:", e);
    }
  }, [roomCode]);

  useEffect(() => {
    if (screen === "room") {
      poll();
      pollRef.current = setInterval(poll, POLL_MS);
      return () => clearInterval(pollRef.current);
    }
  }, [screen, poll]);

  // Reset timeout guards whenever the phase or round changes
  useEffect(() => {
    clueTimedOut.current = false;
    guessTimedOut.current = false;
  }, [room?.phase, room?.round]);

  async function createRoom() {
    const name = nameInput.trim();
    if (!name) { setError("Enter your name first"); return; }
    setLoading(true);
    setError("");
    try {
      const code = randCode();
      const newRoom = {
        code,
        hostId: myId,
        psychicId: null,
        phase: PHASE.LOBBY,
        pair: randPair(),
        target: randTarget(),
        clue: "",
        guesses: {},
        round: 1,
        players: [{ id: myId, name, score: 0 }],
        winnerId: null,
      };
      await saveRoom(code, newRoom);
      setMyName(name);
      setRoomCode(code);
      setRoom(newRoom);
      setScreen("room");
    } catch(e) {
      console.error("createRoom error:", e);
      setError("Failed to create room. Check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    const name = nameInput.trim();
    const code = joinInput.trim().toUpperCase();
    if (!name) { setError("Enter your name first"); return; }
    if (code.length !== 4) { setError("Enter a valid 4-letter room code"); return; }
    setLoading(true);
    setError("");
    try {
      const data = await loadRoom(code);
      if (!data) { setError("Room not found — check the code"); setLoading(false); return; }

      const existing = data.players.find(p => p.id === myId);
      if (existing) {
        // Rejoin: update name, use full setDoc since we have the latest data
        existing.name = name;
        await saveRoom(code, data);
      } else if (data.phase !== PHASE.LOBBY) {
        // Not in the room and game already started — check if same name exists (reconnect by name)
        const sameNamePlayer = data.players.find(p => p.name.toLowerCase() === name.toLowerCase());
        if (sameNamePlayer) {
          sameNamePlayer.id = myId;
          localStorage.setItem("wl_player_id", myId);
          await saveRoom(code, data);
        } else {
          setError("Game already started — you can only rejoin with your original name.");
          setLoading(false); return;
        }
      } else {
        // New player joining lobby — use arrayUnion to atomically add without overwriting others
        await updateDoc(doc(db, "rooms", code), {
          players: arrayUnion({ id: myId, name, score: 0 })
        });
        // Re-fetch so we have the merged player list
        const fresh = await loadRoom(code);
        if (fresh) { setMyName(name); setRoomCode(code); setRoom(fresh); setScreen("room"); setLoading(false); return; }
      }

      setMyName(name);
      setRoomCode(code);
      setRoom(data);
      setScreen("room");
    } catch(e) {
      console.error("joinRoom error:", e);
      setError("Failed to join room. Check your internet connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function startGame() {
    if (!room || room.players.length < 2) { setError("Need at least 2 players"); return; }
    setError("");
    try {
      const data = await loadRoom(roomCode);
      data.phase = PHASE.CLUE;
      data.psychicId = data.players[0].id;
      data.pair = randPair();
      data.target = randTarget();
      data.clue = "";
      data.guesses = {};
      data.round = 1;
      data.totalRounds = data.players.length * ROUNDS_PER_PLAYER;
      data.phaseDeadline = Date.now() + 90000; // 90s for psychic
      await saveRoom(roomCode, data);
      setRoom(data);
    } catch(e) {
      setError("Something went wrong. Try again.");
    }
  }

  async function submitClue() {
    if (!clueInput.trim()) return;
    try {
      const data = await loadRoom(roomCode);
      data.clue = clueInput.trim();
      data.phase = PHASE.GUESS;
      data.phaseDeadline = Date.now() + 45000; // 45s for guessers
      await saveRoom(roomCode, data);
      setRoom(data);
      setClueInput("");
    } catch(e) {
      setError("Failed to send clue. Try again.");
    }
  }

  async function submitGuess() {
    try {
      const data = await loadRoom(roomCode);
      if (!data.guesses) data.guesses = {};
      data.guesses[myId] = guess;
      const nonPsychic = data.players.filter(p => p.id !== data.psychicId);
      if (nonPsychic.every(p => data.guesses[p.id] !== undefined)) data.phase = PHASE.REVEAL;
      await saveRoom(roomCode, data);
      setRoom(data);
    } catch(e) {
      setError("Failed to submit guess. Try again.");
    }
  }

  async function nextRound() {
    try {
      const data = await loadRoom(roomCode);

      // Score guessers and track highest score achieved
      let highestGuesserScore = 0;
      data.players.forEach(p => {
        if (p.id === data.psychicId) return;
        const g = data.guesses?.[p.id];
        if (g !== undefined) {
          const s = scoreGuess(data.target, g);
          p.score += s;
          if (s > highestGuesserScore) highestGuesserScore = s;
        }
      });
      // Psychic earns (highest guesser score - 1), awarded once, minimum 0
      const psychicBonus = Math.max(0, highestGuesserScore - 1);
      const psychic = data.players.find(p => p.id === data.psychicId);
      if (psychic) psychic.score += psychicBonus;

      const totalRounds = data.players.length * ROUNDS_PER_PLAYER;
      const currentRound = data.round || 1;

      // Game over when all rounds are done
      if (currentRound >= totalRounds) {
        // Find winner — highest score (ties: earliest in player list wins)
        const winner = [...data.players].sort((a, b) => b.score - a.score)[0];
        data.phase = "winner";
        data.winnerId = winner.id;
        data.totalRounds = totalRounds;
        await saveRoom(roomCode, data);
        setRoom(data);
        return;
      }

      // Rotate psychic
      const idx = data.players.findIndex(p => p.id === data.psychicId);
      data.psychicId = data.players[(idx + 1) % data.players.length].id;
      data.phase = PHASE.CLUE;
      data.pair = randPair();
      data.target = randTarget();
      data.clue = "";
      data.guesses = {};
      data.round = currentRound + 1;
      data.totalRounds = totalRounds;
      data.phaseDeadline = Date.now() + 90000; // 90s for next psychic
      await saveRoom(roomCode, data);
      setRoom(data);
      setGuess(0.5);
    } catch(e) {
      setError("Failed to advance round. Try again.");
    }
  }

  useEffect(() => { setGuess(0.5); }, [room?.round]);

  function copyCode() {
    navigator.clipboard?.writeText(roomCode).catch(()=>{});
    setCopied(true);
    setTimeout(()=>setCopied(false), 2000);
  }

  const inp = {
    width:"100%", padding:"12px 14px", borderRadius:10,
    border:"1.5px solid #e2e8f0", fontSize:15, outline:"none",
    boxSizing:"border-box", background:"#fff", color:"#0f172a",
    fontFamily:"inherit"
  };
  const btn = (bg="#6366f1", disabled=false) => ({
    width:"100%", padding:"13px 0", borderRadius:10, border:"none",
    background: disabled?"#e2e8f0":bg, color: disabled?"#94a3b8":"#fff",
    fontSize:15, fontWeight:700, cursor: disabled?"not-allowed":"pointer",
    fontFamily:"inherit", letterSpacing:.2, opacity: loading ? 0.7 : 1
  });

  // ── Home ─────────────────────────────────────────────────────────────────────
  if (screen === "home") return (
    <div style={{ minHeight:520, display:"flex", flexDirection:"column", alignItems:"center",
      justifyContent:"center", padding:"40px 20px", fontFamily:"'Georgia', Georgia, serif" }}>
      <div style={{ textAlign:"center", marginBottom:32 }}>
        <div style={{ fontSize:48, marginBottom:8, lineHeight:1 }}>〰</div>
        <h1 style={{ fontSize:32, fontWeight:700, margin:"0 0 6px", letterSpacing:-1.5, color:"#0f172a" }}>Wavelength</h1>
        <p style={{ margin:0, color:"#64748b", fontSize:14 }}>Give one clue. Find the wavelength.</p>
      </div>
      <div style={{ width:"100%", maxWidth:340, display:"flex", flexDirection:"column", gap:10 }}>
        <div>
          <label style={{ fontSize:12, fontWeight:700, color:"#64748b", letterSpacing:.8, display:"block", marginBottom:6 }}>YOUR NAME</label>
          <input value={nameInput} onChange={e=>{setNameInput(e.target.value);setError("");}}
            placeholder="What do people call you?" style={inp}
            onKeyDown={e=>e.key==="Enter"&&createRoom()}/>
        </div>
        {error && (
          <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8,
            padding:"10px 12px", fontSize:13, color:"#dc2626" }}>
            ⚠️ {error}
          </div>
        )}
        <button onClick={createRoom} disabled={loading} style={btn()}>
          {loading ? "Creating..." : "Create New Game"}
        </button>
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"2px 0" }}>
          <div style={{ flex:1, height:1, background:"#e2e8f0" }}/>
          <span style={{ color:"#cbd5e1", fontSize:12 }}>or join with a code</span>
          <div style={{ flex:1, height:1, background:"#e2e8f0" }}/>
        </div>
        <input value={joinInput} onChange={e=>{setJoinInput(e.target.value.toUpperCase());setError("");}}
          placeholder="A B 3 X" maxLength={4}
          style={{ ...inp, textAlign:"center", fontFamily:"monospace", letterSpacing:6, fontSize:20, textTransform:"uppercase" }}
          onKeyDown={e=>e.key==="Enter"&&joinRoom()}/>
        <button onClick={joinRoom} disabled={loading} style={btn("#0f172a")}>
          {loading ? "Joining..." : "Join Game"}
        </button>
        <div style={{ textAlign:"center", marginTop:16 }}>
          <a href="https://www.youtube.com/c/Kserske" target="_blank" rel="noopener noreferrer"
            style={{ fontSize:12, color:"#94a3b8", textDecoration:"none" }}>
            Created by Kserske ↗
          </a>
        </div>
      </div>
    </div>
  );

  if (!room) return (
    <div style={{ padding:48, textAlign:"center", color:"#64748b", fontFamily:"Georgia,serif" }}>
      Loading room...
    </div>
  );

  // ── Lobby ─────────────────────────────────────────────────────────────────────
  if (room.phase === PHASE.LOBBY) return (
    <div style={{ maxWidth:380, margin:"0 auto", padding:"28px 18px", fontFamily:"'Georgia',Georgia,serif" }}>
      <div style={{ textAlign:"center", marginBottom:22 }}>
        <div style={{ fontSize:32 }}>〰</div>
        <h2 style={{ margin:"4px 0 4px", fontSize:20, color:"#0f172a" }}>Game Lobby</h2>
        <p style={{ margin:0, color:"#64748b", fontSize:13 }}>Share the code below to invite friends</p>
      </div>
      <div onClick={copyCode} style={{
        textAlign:"center", padding:"20px 0", background:"#f8fafc",
        borderRadius:14, marginBottom:18, cursor:"pointer",
        border:"2px dashed #c7d2fe", transition:"background .2s"
      }}>
        <div style={{ fontSize:40, fontWeight:800, letterSpacing:10, color:"#6366f1", fontFamily:"monospace" }}>{roomCode}</div>
        <div style={{ fontSize:11, color:"#94a3b8", marginTop:4 }}>{copied?"✓ Copied!":"tap to copy code"}</div>
      </div>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:11, fontWeight:700, color:"#94a3b8", letterSpacing:1, marginBottom:8 }}>
          PLAYERS — {room.players.length} joined
        </div>
        {room.players.map((p,i) => (
          <div key={p.id} style={{
            display:"flex", alignItems:"center", gap:10, padding:"9px 12px",
            background:"#f8fafc", borderRadius:8, marginBottom:4
          }}>
            <div style={{ width:30, height:30, borderRadius:"50%", background:"#ede9fe",
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, fontWeight:700, color:"#6366f1", flexShrink:0 }}>
              {p.name[0].toUpperCase()}
            </div>
            <span style={{ flex:1, fontSize:14, color:"#1e293b" }}>{p.name}</span>
            {p.id === room.hostId && <span style={{ fontSize:10, fontWeight:700, color:"#6366f1", background:"#ede9fe", padding:"2px 7px", borderRadius:99 }}>HOST</span>}
            {p.id === myId && <span style={{ fontSize:11, color:"#94a3b8" }}>you</span>}
          </div>
        ))}
      </div>
      {error && <p style={{ color:"#ef4444", fontSize:13, margin:"0 0 10px" }}>{error}</p>}
      {isHost ? (
        <button onClick={startGame} style={btn("#6366f1", room.players.length < 2)}>
          {room.players.length < 2 ? "Waiting for players..." : "Start Game →"}
        </button>
      ) : (
        <div style={{ textAlign:"center", fontSize:13, color:"#64748b", padding:12,
          background:"#f8fafc", borderRadius:10 }}>
          Waiting for {room.players.find(p=>p.id===room.hostId)?.name} to start...
        </div>
      )}
    </div>
  );

  // ── Winner ────────────────────────────────────────────────────────────────────
  if (room.phase === "winner") {
    const w = room.players.find(p => p.id === room.winnerId);
    const topScore = Math.max(...room.players.map(p => p.score));
    const tied = room.players.filter(p => p.score === topScore);
    return (
      <div style={{ maxWidth:400, margin:"0 auto", padding:"40px 18px",
        fontFamily:"'Georgia',Georgia,serif", textAlign:"center" }}>
        <div style={{ fontSize:52, marginBottom:10 }}>🎉</div>
        {tied.length > 1 ? (
          <>
            <h2 style={{ margin:"0 0 4px", fontSize:26, color:"#0f172a" }}>It's a tie!</h2>
            <p style={{ color:"#64748b", marginBottom:24, fontSize:14 }}>
              {tied.map(p => p.name).join(" & ")} both scored {topScore} pts
            </p>
          </>
        ) : (
          <>
            <h2 style={{ margin:"0 0 4px", fontSize:26, color:"#0f172a" }}>{w?.name} wins!</h2>
            <p style={{ color:"#64748b", marginBottom:24, fontSize:14 }}>
              Highest score after {room.totalRounds} rounds
            </p>
          </>
        )}
        <Scoreboard players={room.players} highlight={myId}/>
        {isHost && (
          <button onClick={async()=>{
            try {
              const data = await loadRoom(roomCode);
              data.phase = PHASE.LOBBY;
              data.players.forEach(p=>p.score=0);
              data.guesses={}; data.clue=""; data.round=1;
              data.psychicId=null; data.winnerId=null; data.totalRounds=null;
              await saveRoom(roomCode,data); setRoom(data);
            } catch(e) { setError("Failed to restart. Try again."); }
          }} style={{ ...btn(), marginTop:20 }}>Play Again</button>
        )}
        {!isHost && <p style={{ marginTop:20, color:"#64748b", fontSize:13 }}>Waiting for host to restart...</p>}
      </div>
    );
  }

  // ── Game ──────────────────────────────────────────────────────────────────────
  function handleClueTimeout() {
    if (clueTimedOut.current || !isPsychic || room.phase !== PHASE.CLUE) return;
    clueTimedOut.current = true;
    const fallback = clueInput.trim() || "…";
    loadRoom(roomCode).then(data => {
      data.clue = fallback;
      data.phase = PHASE.GUESS;
      data.phaseDeadline = Date.now() + 45000;
      return saveRoom(roomCode, data);
    }).then(() => poll()).catch(() => {});
  }

  function handleGuessTimeout() {
    if (guessTimedOut.current || isPsychic || room.phase !== PHASE.GUESS || myGuessVal !== undefined) return;
    guessTimedOut.current = true;
    submitGuess();
  }

  return (
    <div style={{ maxWidth:460, margin:"0 auto", padding:"14px 16px 28px", fontFamily:"'Georgia',Georgia,serif" }}>
      {/* Header row */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <span style={{ fontSize:12, color:"#94a3b8" }}>Round {room.round} of {room.totalRounds || "?"}</span>
        <span style={{ fontSize:12, color:"#94a3b8", fontFamily:"monospace", letterSpacing:1 }}>{roomCode}</span>
      </div>

      {/* Psychic badge + timer — visible to everyone */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, gap:8 }}>
        <div style={{ fontSize:12, fontWeight:700, padding:"5px 12px", borderRadius:99,
          background: isPsychic?"#fef3c7":"#ede9fe", color: isPsychic?"#92400e":"#4f46e5", flex:1, textAlign:"center" }}>
          {isPsychic ? "🧠 You're the Psychic" : `🧠 ${psychicPlayer?.name} is Psychic`}
        </div>
        {room.phaseDeadline && (room.phase === PHASE.CLUE || room.phase === PHASE.GUESS) && (
          <Timer
            deadline={room.phaseDeadline}
            warning={15}
            onExpire={room.phase === PHASE.CLUE ? handleClueTimeout : handleGuessTimeout}
          />
        )}
      </div>

      <div style={{ marginBottom:14 }}>
        <Scoreboard players={room.players} highlight={myId}/>
      </div>

      <div style={{ background:"#fff", border:"1.5px solid #e2e8f0", borderRadius:16, padding:"14px 12px", marginBottom:14 }}>
        {isPsychic && room.phase === PHASE.CLUE && (
          <div style={{ marginBottom:12, padding:"10px 12px", background:"#fef3c7",
            borderRadius:10, border:"1px solid #fde68a" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#92400e", marginBottom:6 }}>
              🎯 TARGET — only you see this
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, height:8, background:"#e2e8f0", borderRadius:99, overflow:"hidden" }}>
                <div style={{ height:"100%", width:`${room.target*100}%`, background:"#22c55e", borderRadius:99 }}/>
              </div>
              <strong style={{ fontSize:14, color:"#065f46", minWidth:36 }}>{Math.round(room.target*100)}%</strong>
            </div>
            <div style={{ fontSize:11, color:"#78350f", marginTop:6 }}>
              {room.target < 0.3 ? `Strongly toward "${room.pair[0]}"` :
               room.target < 0.42 ? `Leaning toward "${room.pair[0]}"` :
               room.target < 0.58 ? `Near the center` :
               room.target < 0.7  ? `Leaning toward "${room.pair[1]}"` :
               `Strongly toward "${room.pair[1]}"`}
            </div>
          </div>
        )}
        <Dial
          target={room.target}
          guess={isPsychic && room.phase === PHASE.CLUE ? room.target :
                 myGuessVal !== undefined ? myGuessVal : guess}
          showTarget={isRevealed || (isPsychic && room.phase === PHASE.CLUE)}
          onGuessChange={setGuess}
          interactive={!isPsychic && room.phase === PHASE.GUESS && myGuessVal === undefined}
          pair={room.pair}
          allGuesses={isRevealed ? room.guesses : null}
          players={isRevealed ? room.players.filter(p => p.id !== room.psychicId) : null}
          myId={myId}
        />
      </div>

      {error && (
        <div style={{ background:"#fef2f2", border:"1px solid #fecaca", borderRadius:8,
          padding:"10px 12px", fontSize:13, color:"#dc2626", marginBottom:12 }}>
          ⚠️ {error}
        </div>
      )}

      {room.phase === PHASE.CLUE && isPsychic && (
        <div style={{ background:"#fafafa", border:"1.5px solid #e2e8f0", borderRadius:14, padding:16 }}>
          <p style={{ margin:"0 0 10px", fontSize:13, color:"#475569", lineHeight:1.5 }}>
            Give one word or phrase as your clue. Don't say anything on the spectrum!
          </p>
          <input value={clueInput} onChange={e=>setClueInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&submitClue()}
            placeholder="Your clue..."
            style={{ ...inp, marginBottom:10 }}/>
          <button onClick={submitClue} style={btn("#6366f1", !clueInput.trim())}>
            Send Clue to Team →
          </button>
        </div>
      )}

      {room.phase === PHASE.CLUE && !isPsychic && (
        <div style={{ textAlign:"center", padding:"22px 0", color:"#64748b", fontSize:14 }}>
          <div style={{ fontSize:28, marginBottom:8 }}>⏳</div>
          {psychicPlayer?.name} is thinking of a clue...
        </div>
      )}

      {room.phase === PHASE.GUESS && (
        <div style={{ background:"#f8fafc", border:"1.5px solid #e2e8f0", borderRadius:14, padding:16 }}>
          <div style={{ display:"flex", alignItems:"baseline", gap:8, marginBottom:12, flexWrap:"wrap" }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#94a3b8", letterSpacing:.8 }}>CLUE</span>
            <span style={{ fontSize:21, fontWeight:700, color:"#0f172a" }}>"{room.clue}"</span>
          </div>
          {isPsychic ? (
            <div style={{ textAlign:"center", color:"#64748b", fontSize:13, padding:"8px 0" }}>
              <div style={{ fontSize:22, marginBottom:6 }}>👁</div>
              Watching the team guess...
              <div style={{ marginTop:8, fontSize:12, background:"#f1f5f9", borderRadius:8, padding:"6px 12px", display:"inline-block" }}>
                {room.players.filter(p=>p.id!==room.psychicId&&room.guesses?.[p.id]!==undefined).length}
                {" / "}
                {room.players.filter(p=>p.id!==room.psychicId).length} guessed
              </div>
            </div>
          ) : myGuessVal !== undefined ? (
            <div style={{ textAlign:"center", fontSize:13, padding:"8px 0" }}>
              <div style={{ color:"#22c55e", fontWeight:700, marginBottom:6 }}>✓ Guess locked in!</div>
              <div style={{ color:"#94a3b8", fontSize:12 }}>
                {room.players.filter(p=>p.id!==room.psychicId&&room.guesses?.[p.id]!==undefined).length}
                {" / "}
                {room.players.filter(p=>p.id!==room.psychicId).length} players done
              </div>
            </div>
          ) : (
            <>
              <p style={{ margin:"0 0 10px", fontSize:13, color:"#475569" }}>
                Drag the needle to where you think the target is.
              </p>
              <div style={{ textAlign:"center", marginBottom:10 }}>
                <span style={{ fontSize:13, color:"#64748b" }}>Your position: </span>
                <strong style={{ fontSize:17, color:"#6366f1" }}>{Math.round(guess*100)}%</strong>
              </div>
              <button onClick={submitGuess} style={btn()}>Lock In →</button>
            </>
          )}
        </div>
      )}

      {isRevealed && (
        <div style={{ border:"1.5px solid #e2e8f0", borderRadius:14, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", background:"#f8fafc", borderBottom:"1px solid #e2e8f0" }}>
            <span style={{ fontSize:11, fontWeight:700, color:"#94a3b8" }}>CLUE: </span>
            <span style={{ fontSize:15, fontWeight:700, color:"#0f172a" }}>"{room.clue}"</span>
            <span style={{ fontSize:12, color:"#94a3b8", marginLeft:8 }}>
              · target at {Math.round(room.target*100)}%
            </span>
          </div>
          <div style={{ padding:"8px 0" }}>
            {room.players.filter(p=>p.id!==room.psychicId).map((p,i,arr) => {
              const g = room.guesses?.[p.id];
              const s = g!==undefined ? scoreGuess(room.target,g) : 0;
              return (
                <div key={p.id} style={{
                  display:"flex", alignItems:"center", gap:10, padding:"8px 16px",
                  borderBottom: i<arr.length-1?"1px solid #f8fafc":"none",
                  background: p.id===myId?"#f5f3ff":"transparent"
                }}>
                  <span style={{ fontSize:15 }}>{s===4?"🎯":s===3?"🟢":s===2?"🟡":"🔴"}</span>
                  <span style={{ flex:1, fontSize:13, color:"#1e293b" }}>
                    {p.name}{p.id===myId?" (you)":""}
                  </span>
                  <span style={{ fontSize:12, color:"#94a3b8" }}>{g!==undefined?`${Math.round(g*100)}%`:"—"}</span>
                  <span style={{ fontWeight:700, color:"#6366f1", fontSize:15, minWidth:28, textAlign:"right" }}>+{s}</span>
                </div>
              );
            })}
          </div>
          <div style={{ padding:"12px 16px", borderTop:"1px solid #f1f5f9" }}>
            {isHost ? (
              <button onClick={nextRound} style={btn()}>Next Round →</button>
            ) : (
              <div style={{ textAlign:"center", fontSize:13, color:"#94a3b8" }}>
                Waiting for host to continue...
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
