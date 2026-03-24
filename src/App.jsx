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
const WIN_SCORE = 12;

function randCode() { return Math.random().toString(36).slice(2,6).toUpperCase(); }
function randTarget() { return 0.2 + Math.random() * 0.6; }
function randPair() { return CLUE_PAIRS[Math.floor(Math.random() * CLUE_PAIRS.length)]; }
function scoreGuess(target, guess) {
  const d = Math.abs(target - guess);
  if (d <= ZONES[0].half) return 4;
  if (d <= ZONES[1].half) return 3;
  if (d <= ZONES[2].half) return 2;
  return 0;
}

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
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

async function saveRoom(code, data) {
  try {
    await setDoc(doc(db, "rooms", code), data);
  } catch(e){ console.error("saveRoom error", e); }
}

async function loadRoom(code) {
  try {
    const snap = await getDoc(doc(db, "rooms", code));
    return snap.exists() ? snap.data() : null;
  } catch(e){ console.error("loadRoom error", e); return null; }
}

function posToAngle(pos) { return Math.PI - pos * Math.PI; }
function posToXY(pos, cx, cy, r) {
  const a = posToAngle(pos);
  return { x: cx + r * Math.cos(a), y: cy - r * Math.sin(a) };
}

function Dial({ target, guess, showTarget, onGuessChange, interactive, pair }) {
  const W = 400, H = 215, cx = 200, cy = 215, R = 190;
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
    return 1 - clamped / Math.PI;
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

  function arcPath(center, halfW) {
    const lo = Math.max(0.001, center - halfW);
    const hi = Math.min(0.999, center + halfW);
    const aHi = posToAngle(lo), aLo = posToAngle(hi);
    const x1 = cx + R * Math.cos(aHi), y1 = cy - R * Math.sin(aHi);
    const x2 = cx + R * Math.cos(aLo), y2 = cy - R * Math.sin(aLo);
    const large = (hi - lo) > 0.5 ? 1 : 0;
    return `M ${cx} ${cy} L ${x1} ${y1} A ${R} ${R} 0 ${large} 0 ${x2} ${y2} Z`;
  }

  const gxy = posToXY(guess, cx, cy, R - 12);
  const txy = showTarget ? posToXY(target, cx, cy, R - 12) : null;

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6, padding:"0 4px" }}>
        <span style={{ fontSize:13, fontWeight:700, color:"#3b82f6", letterSpacing:.3 }}>{pair[0]}</span>
        <span style={{ fontSize:13, fontWeight:700, color:"#f43f5e", letterSpacing:.3 }}>{pair[1]}</span>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%"
        style={{ display:"block", cursor: interactive ? "crosshair" : "default", touchAction:"none", userSelect:"none" }}
        onMouseDown={handleDown} onTouchStart={handleDown}>

        {/* Background track */}
        <path d={`M 14 ${cy} A ${R-14} ${R-14} 0 0 1 ${W-14} ${cy}`}
          fill="none" stroke="#f1f5f9" strokeWidth={22} strokeLinecap="round"/>

        {/* Zone fills centered on target (only when target visible) */}
        {showTarget && [...ZONES].reverse().map((z,i) => (
          <path key={i} d={arcPath(target, z.half)} fill={z.color} opacity={0.25}/>
        ))}

        {/* Track border */}
        <path d={`M 14 ${cy} A ${R-14} ${R-14} 0 0 1 ${W-14} ${cy}`}
          fill="none" stroke="#e2e8f0" strokeWidth={1}/>

        {/* Target needle */}
        {showTarget && txy && (
          <g>
            <line x1={cx} y1={cy} x2={txy.x} y2={txy.y}
              stroke="#22c55e" strokeWidth={4} strokeLinecap="round"/>
            <circle cx={txy.x} cy={txy.y} r={10} fill="#22c55e" stroke="#fff" strokeWidth={2.5}/>
          </g>
        )}

        {/* Guess needle */}
        <g>
          <line x1={cx} y1={cy} x2={gxy.x} y2={gxy.y}
            stroke="#6366f1" strokeWidth={5} strokeLinecap="round"/>
          <circle cx={gxy.x} cy={gxy.y} r={12} fill="#6366f1" stroke="#fff" strokeWidth={2.5}/>
        </g>

        {/* Pivot */}
        <circle cx={cx} cy={cy} r={9} fill="#fff" stroke="#e2e8f0" strokeWidth={2}/>
      </svg>

      {showTarget && (
        <div style={{ display:"flex", gap:8, justifyContent:"center", flexWrap:"wrap", marginTop:6 }}>
          {ZONES.filter(z=>z.pts>0).map(z=>(
            <div key={z.pts} style={{ display:"flex", alignItems:"center", gap:3, fontSize:11 }}>
              <div style={{ width:9, height:9, borderRadius:2, background:z.color, opacity:.8 }}/>
              <span style={{ color:"#94a3b8" }}>{z.pts}pt</span>
            </div>
          ))}
          <div style={{ display:"flex", alignItems:"center", gap:3, fontSize:11 }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:"#22c55e" }}/>
            <span style={{ color:"#94a3b8" }}>target</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:3, fontSize:11 }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:"#6366f1" }}/>
            <span style={{ color:"#94a3b8" }}>guess</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Scoreboard({ players, highlight }) {
  const sorted = [...players].sort((a,b) => b.score - a.score);
  return (
    <div style={{ background:"#f8fafc", borderRadius:12, border:"1px solid #e2e8f0", overflow:"hidden" }}>
      <div style={{ padding:"8px 14px", background:"#f1f5f9", borderBottom:"1px solid #e2e8f0" }}>
        <span style={{ fontSize:11, fontWeight:700, color:"#64748b", letterSpacing:1 }}>SCOREBOARD · first to {WIN_SCORE} wins</span>
      </div>
      {sorted.map((p,i) => {
        const pct = Math.min(100, (p.score / WIN_SCORE) * 100);
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
  const [myId] = useState(() => "u_" + Math.random().toString(36).slice(2,8));
  const [myName, setMyName] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState(null);
  const [guess, setGuess] = useState(0.5);
  const [clueInput, setClueInput] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef(null);

  const isHost = room?.hostId === myId;
  const isPsychic = room?.psychicId === myId;
  const myGuessVal = room?.guesses?.[myId];
  const isRevealed = room?.phase === PHASE.REVEAL;
  const psychicPlayer = room?.players?.find(p => p.id === room?.psychicId);

  const poll = useCallback(async () => {
    if (!roomCode) return;
    const data = await loadRoom(roomCode);
    if (data) setRoom(data);
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
    const code = randCode();
    const newRoom = {
      code, hostId: myId, psychicId: null,
      phase: PHASE.LOBBY, pair: randPair(), target: randTarget(),
      clue: "", guesses: {}, round: 1,
      players: [{ id: myId, name, score: 0 }],
    };
    await saveRoom(code, newRoom);
    setMyName(name); setRoomCode(code); setRoom(newRoom);
    setScreen("room");
  }

  async function joinRoom() {
    const name = nameInput.trim();
    const code = joinInput.trim().toUpperCase();
    if (!name) { setError("Enter your name first"); return; }
    if (code.length !== 4) { setError("Enter a valid 4-letter room code"); return; }
    const data = await loadRoom(code);
    if (!data) { setError("Room not found — check the code"); return; }
    if (data.phase !== PHASE.LOBBY) { setError("Game already started!"); return; }
    if (!data.players.find(p => p.id === myId)) {
      data.players.push({ id: myId, name, score: 0 });
      await saveRoom(code, data);
    }
    setMyName(name); setRoomCode(code); setRoom(data);
    setScreen("room");
  }

  async function startGame() {
    if (!room || room.players.length < 2) { setError("Need at least 2 players"); return; }
    const data = await loadRoom(roomCode);
    data.phase = PHASE.CLUE;
    data.psychicId = data.players[0].id;
    data.pair = randPair(); data.target = randTarget();
    data.clue = ""; data.guesses = {};
    await saveRoom(roomCode, data);
    setRoom(data); setError("");
  }

  async function submitClue() {
    if (!clueInput.trim()) return;
    const data = await loadRoom(roomCode);
    data.clue = clueInput.trim();
    data.phase = PHASE.GUESS;
    await saveRoom(roomCode, data);
    setRoom(data); setClueInput("");
  }

  async function submitGuess() {
    const data = await loadRoom(roomCode);
    if (!data.guesses) data.guesses = {};
    data.guesses[myId] = guess;
    const nonPsychic = data.players.filter(p => p.id !== data.psychicId);
    if (nonPsychic.every(p => data.guesses[p.id] !== undefined)) data.phase = PHASE.REVEAL;
    await saveRoom(roomCode, data);
    setRoom(data);
  }

  async function nextRound() {
    const data = await loadRoom(roomCode);
    data.players.forEach(p => {
      if (p.id === data.psychicId) return;
      const g = data.guesses?.[p.id];
      if (g !== undefined) p.score += scoreGuess(data.target, g);
    });
    const winner = data.players.find(p => p.score >= WIN_SCORE);
    if (winner) {
      data.phase = "winner"; data.winnerId = winner.id;
      await saveRoom(roomCode, data); setRoom(data); return;
    }
    const idx = data.players.findIndex(p => p.id === data.psychicId);
    data.psychicId = data.players[(idx + 1) % data.players.length].id;
    data.phase = PHASE.CLUE; data.pair = randPair(); data.target = randTarget();
    data.clue = ""; data.guesses = {}; data.round = (data.round || 1) + 1;
    await saveRoom(roomCode, data); setRoom(data); setGuess(0.5);
  }

  useEffect(() => { setGuess(0.5); }, [room?.round]);

  function copyCode() {
    navigator.clipboard?.writeText(roomCode).catch(()=>{});
    setCopied(true); setTimeout(()=>setCopied(false), 2000);
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
    fontFamily:"inherit", letterSpacing:.2
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
        {error && <p style={{ margin:0, color:"#ef4444", fontSize:13 }}>{error}</p>}
        <button onClick={createRoom} style={btn()}>Create New Game</button>
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"2px 0" }}>
          <div style={{ flex:1, height:1, background:"#e2e8f0" }}/>
          <span style={{ color:"#cbd5e1", fontSize:12 }}>or join with a code</span>
          <div style={{ flex:1, height:1, background:"#e2e8f0" }}/>
        </div>
        <input value={joinInput} onChange={e=>{setJoinInput(e.target.value.toUpperCase());setError("");}}
          placeholder="A B 3 X" maxLength={4}
          style={{ ...inp, textAlign:"center", fontFamily:"monospace", letterSpacing:6, fontSize:20, textTransform:"uppercase" }}
          onKeyDown={e=>e.key==="Enter"&&joinRoom()}/>
        <button onClick={joinRoom} style={btn("#0f172a")}>Join Game</button>
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
    return (
      <div style={{ maxWidth:400, margin:"0 auto", padding:"40px 18px",
        fontFamily:"'Georgia',Georgia,serif", textAlign:"center" }}>
        <div style={{ fontSize:52, marginBottom:10 }}>🎉</div>
        <h2 style={{ margin:"0 0 4px", fontSize:26, color:"#0f172a" }}>{w?.name} wins!</h2>
        <p style={{ color:"#64748b", marginBottom:24, fontSize:14 }}>First to {WIN_SCORE} points</p>
        <Scoreboard players={room.players} highlight={myId}/>
        {isHost && (
          <button onClick={async()=>{
            const data = await loadRoom(roomCode);
            data.phase = PHASE.LOBBY;
            data.players.forEach(p=>p.score=0);
            data.guesses={}; data.clue=""; data.round=1; data.psychicId=null;
            await saveRoom(roomCode,data); setRoom(data);
          }} style={{ ...btn(), marginTop:20 }}>Play Again</button>
        )}
        {!isHost && <p style={{ marginTop:20, color:"#64748b", fontSize:13 }}>Waiting for host to restart...</p>}
      </div>
    );
  }

  // ── Game ──────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth:460, margin:"0 auto", padding:"14px 16px 28px", fontFamily:"'Georgia',Georgia,serif" }}>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
        <span style={{ fontSize:12, color:"#94a3b8" }}>Round {room.round}</span>
        <div style={{ fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:99,
          background: isPsychic?"#fef3c7":"#ede9fe", color: isPsychic?"#92400e":"#4f46e5" }}>
          {isPsychic ? "🧠 You're the Psychic" : `🧠 ${psychicPlayer?.name} is Psychic`}
        </div>
        <span style={{ fontSize:12, color:"#94a3b8", fontFamily:"monospace", letterSpacing:1 }}>{roomCode}</span>
      </div>

      {/* Scoreboard */}
      <div style={{ marginBottom:14 }}>
        <Scoreboard players={room.players} highlight={myId}/>
      </div>

      {/* Dial card */}
      <div style={{ background:"#fff", border:"1.5px solid #e2e8f0", borderRadius:16, padding:"14px 12px", marginBottom:14 }}>
        {/* Psychic target hint */}
        {isPsychic && room.phase === PHASE.CLUE && (
          <div style={{ marginBottom:12, padding:"10px 12px", background:"#fef3c7",
            borderRadius:10, border:"1px solid #fde68a" }}>
            <div style={{ fontSize:11, fontWeight:700, color:"#92400e", marginBottom:6 }}>
              🎯 TARGET — only you see this
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ flex:1, height:8, background:"#fde68a", borderRadius:99, overflow:"hidden" }}>
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

      {/* CLUE phase — psychic */}
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

      {/* CLUE phase — waiting */}
      {room.phase === PHASE.CLUE && !isPsychic && (
        <div style={{ textAlign:"center", padding:"22px 0", color:"#64748b", fontSize:14 }}>
          <div style={{ fontSize:28, marginBottom:8 }}>⏳</div>
          {psychicPlayer?.name} is thinking of a clue...
        </div>
      )}

      {/* GUESS phase */}
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

      {/* REVEAL phase */}
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
