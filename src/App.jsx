import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
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
  { pts: 4, half: 0.06, color: "#22c55e" },
  { pts: 3, half: 0.12, color: "#84cc16" },
  { pts: 2, half: 0.20, color: "#f59e0b" },
  { pts: 0, half: 0.50, color: "#ef4444" },
];

const PHASE = { LOBBY:"lobby", CLUE:"clue", GUESS:"guess", REVEAL:"reveal" };
const POLL_MS = 1500;
const ROUNDS_PER_PLAYER = 3; // each player gets 3 turns as Psychic

function randCode() { return Math.random().toString(36).slice(2,6).toUpperCase(); }
function randTarget() { return parseFloat((0.2 + Math.random() * 0.6).toFixed(4)); }
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

// pos=0 → left end of semicircle (angle = 180°)
// pos=1 → right end of semicircle (angle = 0°)
// SVG: x increases right, y increases down. Centre pivot is at bottom-centre.
function posToRad(pos) { return Math.PI * (1 - pos); }   // 0→π, 1→0
function posToXY(pos, cx, cy, r) {
  const a = posToRad(pos);
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

// Annular wedge (donut slice) between pos0 and pos1 (0–1 spectrum positions).
// Draws outer arc from pos0→pos1 (increasing pos = clockwise on top semicircle),
// then inner arc back pos1→pos0.
// SVG arc sweep-flag=1 means clockwise. Since increasing pos means angle decreasing
// (π→0), the outer arc from pos0 to pos1 is actually counter-clockwise in angle
// space — we need sweep=0.
function annularWedge(pos0, pos1, cx, cy, rOuter, rInner) {
  const p0 = Math.min(pos0, pos1);
  const p1 = Math.max(pos0, pos1);
  const span = p1 - p0;
  if (span <= 0) return "";
  const large = span > 0.5 ? 1 : 0;

  const a0 = posToRad(p0);   // larger angle (left side)
  const a1 = posToRad(p1);   // smaller angle (right side)

  // Outer arc: start at p0 (left boundary), sweep right to p1.
  // Angles go a0→a1 with a0>a1, so this is a decreasing-angle (CCW) arc → sweep=0
  const ox0 = cx + rOuter * Math.cos(a0), oy0 = cy - rOuter * Math.sin(a0);
  const ox1 = cx + rOuter * Math.cos(a1), oy1 = cy - rOuter * Math.sin(a1);
  // Inner arc: start at p1 (right), sweep back left to p0.
  // Angles go a1→a0, increasing angle (CW) → sweep=1
  const ix1 = cx + rInner * Math.cos(a1), iy1 = cy - rInner * Math.sin(a1);
  const ix0 = cx + rInner * Math.cos(a0), iy0 = cy - rInner * Math.sin(a0);

  return [
    `M ${ox0} ${oy0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 0 ${ox1} ${oy1}`,  // outer, sweep=0 (CCW)
    `L ${ix1} ${iy1}`,
    `A ${rInner} ${rInner} 0 ${large} 1 ${ix0} ${iy0}`,  // inner, sweep=1 (CW)
    `Z`
  ].join(" ");
}

function buildSegments(target) {
  const clamp = v => Math.max(0.0001, Math.min(0.9999, v));
  const t = clamp(target);
  const boundaries = [
    0,
    clamp(t - 0.20),
    clamp(t - 0.12),
    clamp(t - 0.06),
    clamp(t + 0.06),
    clamp(t + 0.12),
    clamp(t + 0.20),
    1,
  ];
  const colors  = ["#d1d5db","#f59e0b","#84cc16","#22c55e","#84cc16","#f59e0b","#d1d5db"];
  const labels  = [null, "2pt", "3pt", "4pt", "3pt", "2pt", null];
  return boundaries.slice(0, -1).map((start, i) => ({
    start, end: boundaries[i + 1], color: colors[i], label: labels[i],
  })).filter(s => s.end - s.start > 0.0001);
}

function Dial({ target, guess, showTarget, onGuessChange, interactive, pair }) {
  const W = 440, H = 230, cx = 220, cy = 224, R = 210, Ri = 115;
  const svgRef = useRef(null);
  const dragging = useRef(false);

  function getPos(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const svgY = ((clientY - rect.top) / rect.height) * H;
    const angle = Math.atan2(cy - svgY, svgX - cx);
    const clamped = Math.max(0, Math.min(Math.PI, angle));
    return parseFloat((1 - clamped / Math.PI).toFixed(4));
  }

  function handleDown(e) {
    if (!interactive) return;
    dragging.current = true;
    onGuessChange(getPos(e));
  }

  useEffect(() => {
    function move(e) { if (dragging.current && interactive) onGuessChange(getPos(e)); }
    function up() { dragging.current = false; }
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

  // Always show the full semicircle.
  // Before reveal: uniform grey. After reveal (or psychic view): coloured zones.
  const segments = showTarget
    ? buildSegments(target)
    : [{ start: 0, end: 1, color: "#d1d5db", label: null }];

  const needleEnd = posToXY(guess, cx, cy, R - 6);
  const targetEnd = showTarget ? posToXY(target, cx, cy, R - 6) : null;

  // Label midpoint: radial centre of each band
  function labelXY(seg) {
    const mid = (seg.start + seg.end) / 2;
    return posToXY(mid, cx, cy, (R + Ri) / 2);
  }

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4, padding:"0 6px" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#3b82f6" }}>{pair[0]}</span>
        <span style={{ fontSize:13, fontWeight:700, color:"#f43f5e" }}>{pair[1]}</span>
      </div>

      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%"
        style={{ display:"block", cursor: interactive ? "crosshair" : "default",
          touchAction:"none", userSelect:"none" }}
        onMouseDown={handleDown} onTouchStart={handleDown}>

        {/* Annular wedge segments filling the full semicircle */}
        {segments.map((seg, i) => (
          <path key={i}
            d={annularWedge(seg.start, seg.end, cx, cy, R, Ri)}
            fill={seg.color}
            stroke="#fff"
            strokeWidth={1.2}
          />
        ))}

        {/* Point labels inside each coloured band */}
        {showTarget && segments.filter(s => s.label).map((seg, i) => {
          const lp = labelXY(seg);
          return (
            <text key={i} x={lp.x} y={lp.y}
              textAnchor="middle" dominantBaseline="middle"
              fontSize={11} fontWeight="700" fill="#fff"
              style={{ pointerEvents:"none", userSelect:"none" }}>
              {seg.label}
            </text>
          );
        })}

        {/* Target needle (dashed green) — only on reveal / psychic view */}
        {showTarget && targetEnd && (
          <g>
            <line x1={cx} y1={cy} x2={targetEnd.x} y2={targetEnd.y}
              stroke="#15803d" strokeWidth={3} strokeLinecap="round" strokeDasharray="5 3"/>
            <circle cx={targetEnd.x} cy={targetEnd.y} r={7}
              fill="#15803d" stroke="#fff" strokeWidth={2}/>
          </g>
        )}

        {/* Guess needle (solid indigo) — always shown */}
        <line x1={cx} y1={cy} x2={needleEnd.x} y2={needleEnd.y}
          stroke="#6366f1" strokeWidth={4.5} strokeLinecap="round"/>
        <circle cx={needleEnd.x} cy={needleEnd.y} r={10}
          fill="#6366f1" stroke="#fff" strokeWidth={2.5}/>

        {/* White inner circle hides pivot area cleanly */}
        <circle cx={cx} cy={cy} r={Ri - 1} fill="#fff"/>
        {/* Pivot dot */}
        <circle cx={cx} cy={cy} r={8} fill="#e2e8f0" stroke="#fff" strokeWidth={1.5}/>
      </svg>

      {/* Legend */}
      <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap", marginTop:6 }}>
        {[
          { color:"#22c55e", label:"4 pts" },
          { color:"#84cc16", label:"3 pts" },
          { color:"#f59e0b", label:"2 pts" },
          { color:"#d1d5db", label:"0 pts" },
        ].map(item => (
          <div key={item.label} style={{ display:"flex", alignItems:"center", gap:4, fontSize:11 }}>
            <div style={{ width:10, height:10, borderRadius:2, background:item.color, border:"1px solid #e2e8f0" }}/>
            <span style={{ color:"#64748b" }}>{item.label}</span>
          </div>
        ))}
        {showTarget && (
          <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:11 }}>
            <div style={{ width:10, height:10, borderRadius:"50%", background:"#15803d" }}/>
            <span style={{ color:"#64748b" }}>target</span>
          </div>
        )}
        <div style={{ display:"flex", alignItems:"center", gap:4, fontSize:11 }}>
          <div style={{ width:10, height:10, borderRadius:"50%", background:"#6366f1" }}/>
          <span style={{ color:"#64748b" }}>your guess</span>
        </div>
      </div>
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
      if (data.phase !== PHASE.LOBBY) { setError("Game already started!"); setLoading(false); return; }
      if (!data.players.find(p => p.id === myId)) {
        data.players.push({ id: myId, name, score: 0 });
        await saveRoom(code, data);
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

      // Score all guessers for this round
      data.players.forEach(p => {
        if (p.id === data.psychicId) return;
        const g = data.guesses?.[p.id];
        if (g !== undefined) p.score += scoreGuess(data.target, g);
      });

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
  return (
    <div style={{ maxWidth:460, margin:"0 auto", padding:"14px 16px 28px", fontFamily:"'Georgia',Georgia,serif" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <span style={{ fontSize:12, color:"#94a3b8" }}>Round {room.round} of {room.totalRounds || "?"}</span>
        <div style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:99,
          background: isPsychic?"#fef3c7":"#ede9fe", color: isPsychic?"#92400e":"#4f46e5" }}>
          {isPsychic ? "🧠 You're the Psychic" : `🧠 ${psychicPlayer?.name} is Psychic`}
        </div>
        <span style={{ fontSize:12, color:"#94a3b8", fontFamily:"monospace", letterSpacing:1 }}>{roomCode}</span>
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
