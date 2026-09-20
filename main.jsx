import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import Papa from "papaparse";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis,
  Tooltip, CartesianGrid, PieChart, Pie, Cell
} from "recharts";
import "./styles.css";

const DATASETS = {
  music: "/data/spotify_history.csv",
  household: "/data/household.csv",
  transactions: "/data/transactions.csv"
};

const colors = ["#9b8cff", "#55d6be", "#ffb86b", "#ff6b9d", "#63b3ed", "#f6e58d"];

function cleanKey(k) {
  return String(k ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}
function normalizeRows(rows) {
  return rows.map(row => {
    const out = {};
    Object.entries(row || {}).forEach(([k,v]) => out[cleanKey(k)] = typeof v === "string" ? v.trim() : v);
    return out;
  }).filter(r => Object.values(r).some(v => v !== "" && v != null));
}
function num(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function parseDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (!isNaN(d)) return d;
  const m = String(v).match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (m) {
    const y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    const d2 = new Date(y, Number(m[2])-1, Number(m[1]));
    if (!isNaN(d2)) return d2;
  }
  return null;
}
function fmtMoney(n) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n || 0));
}
function loadCsv(path) {
  return new Promise(resolve => {
    Papa.parse(path, {
      download: true, header: true, skipEmptyLines: true,
      complete: r => resolve(normalizeRows(r.data || [])),
      error: () => resolve([])
    });
  });
}
function first(row, keys, fallback="") {
  for (const k of keys) if (row[k] !== undefined && row[k] !== null && row[k] !== "") return row[k];
  return fallback;
}
function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x,y)=>x-y), m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1]+a[m])/2;
}

function App() {
  const [data, setData] = useState({music:[], household:[], transactions:[]});
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState("home");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("all");
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    Promise.all(Object.entries(DATASETS).map(async ([key,path]) => [key, await loadCsv(path)]))
      .then(entries => setData(Object.fromEntries(entries)))
      .finally(() => setLoading(false));
  }, []);

  const music = data.music;
  const household = data.household;
  const transactions = data.transactions;

  const musicMapped = useMemo(() => music.map((r,i) => ({
    id:"m"+i, kind:"Music", date:parseDate(first(r,["ts","timestamp","date","datetime"])),
    title:first(r,["track_name","track","song_name"],"Unknown track"),
    subtitle:first(r,["artist_name","artist"],"Unknown artist"),
    detail:first(r,["album_name","album"],"Music"),
    raw:r
  })), [music]);

  const householdMapped = useMemo(() => household.map((r,i) => ({
    id:"h"+i, kind:"Purchase", date:parseDate(first(r,["date","timestamp","datetime","transaction_date"])),
    title:first(r,["subcategory","category","item","description"],"Household activity"),
    subtitle:first(r,["category","type","payment_type"],"Household"),
    detail:first(r,["note","notes","description"],"Everyday moment"),
    amount:num(first(r,["amount","amt","value","price"])),
    raw:r
  })), [household]);

  const txMapped = useMemo(() => transactions.map((r,i) => ({
    id:"t"+i, kind:"Transaction", date:parseDate(first(r,["date","transaction_date","timestamp","datetime"])),
    title:first(r,["merchant","merchant_name","category","transaction_type"],"Transaction"),
    subtitle:first(r,["category","transaction_type","payment_method"],"Financial activity"),
    detail:[first(r,["city","location"],""), first(r,["state"],"")].filter(Boolean).join(", "),
    amount:num(first(r,["amount","amt","transaction_amount","value"])),
    raw:r
  })), [transactions]);

  const allReceipts = useMemo(() => [...musicMapped,...householdMapped,...txMapped]
    .filter(x => !query || `${x.title} ${x.subtitle} ${x.detail}`.toLowerCase().includes(query.toLowerCase()))
    .filter(x => type==="all" || x.kind===type)
    .sort((a,b)=>(b.date?.getTime()||0)-(a.date?.getTime()||0)), [musicMapped,householdMapped,txMapped,query,type]);

  const spend = householdMapped.reduce((s,x)=>s+x.amount,0) + transactions.reduce((s,r)=>s+num(first(r,["amount","amt","transaction_amount","value"])),0);
  const skipped = music.filter(r => String(first(r,["skipped","skip"],"")).toLowerCase()==="true").length;
  const uniqueArtists = new Set(musicMapped.map(x=>x.subtitle).filter(Boolean)).size;

  const monthly = useMemo(() => {
    const map = {};
    [...musicMapped,...householdMapped,...txMapped].forEach(x=>{
      if (!x.date) return;
      const key = x.date.toLocaleString("en-US",{month:"short",year:"2-digit"});
      if (!map[key]) map[key]={month:key,moments:0,spend:0};
      map[key].moments++;
      map[key].spend += x.amount || 0;
    });
    return Object.values(map).slice(-12);
  }, [musicMapped,householdMapped,txMapped]);

  const categories = useMemo(() => {
    const map = {};
    [...householdMapped,...txMapped].forEach(x=> {
      const k=x.subtitle||"Other";
      map[k]=(map[k]||0)+(x.amount||0);
    });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,7).map(([name,value])=>({name,value}));
  },[householdMapped,txMapped]);

  const hourly = useMemo(() => {
    const map=Array.from({length:24},(_,h)=>({hour:`${String(h).padStart(2,"0")}:00`,moments:0}));
    musicMapped.forEach(x=>{if(x.date) map[x.date.getHours()].moments++});
    return map;
  },[musicMapped]);

  const insights = useMemo(() => {
    const out=[];
    const peak=hourly.reduce((a,b)=>b.moments>a.moments?b:a,hourly[0]);
    if(peak.moments) out.push({icon:"◷",title:"Your listening rhythm",text:`The strongest listening hour in the dataset is around ${peak.hour}, with ${peak.moments.toLocaleString()} recorded listening moments.`});
    if(uniqueArtists) out.push({icon:"♪",title:"A wide musical world",text:`The music history contains ${uniqueArtists.toLocaleString()} distinct artists, showing a broad range of listening choices.`});
    if(categories[0]) out.push({icon:"₹",title:"Where activity concentrates",text:`${categories[0].name} is the largest recorded transaction category by amount in the supplied financial data.`});
    if(skipped) out.push({icon:"↪",title:"Not every moment became a memory",text:`${skipped.toLocaleString()} listening records are marked as skipped — a small behavioral clue inside the receipts.`});
    return out;
  },[hourly,uniqueArtists,categories,skipped]);

  function Nav() {
    return <nav className="nav">
      <button className="brand" onClick={()=>setSection("home")}><span className="brand-dot"></span>THOUGHT OF JOURNEY</button>
      <div className="navlinks">
        {["home","journey","connections","patterns","receipts"].map(s=>
          <button key={s} className={section===s?"active":""} onClick={()=>setSection(s)}>
            {s[0].toUpperCase()+s.slice(1)}
          </button>)}
      </div>
      <button className="discover" onClick={()=>setSection("journey")}>Discover story ↗</button>
    </nav>
  }

  function Stat({label,value,sub}) {
    return <div className="stat"><div className="stat-value">{value}</div><div className="stat-label">{label}</div><div className="stat-sub">{sub}</div></div>
  }

  function Receipt({x}) {
    return <button className="receipt" onClick={()=>setSelected(x)}>
      <div className="receipt-top"><span className={`tag ${x.kind.toLowerCase()}`}>{x.kind}</span><span>{x.date ? x.date.toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"}):"—"}</span></div>
      <h3>{x.title}</h3><p>{x.subtitle}</p>
      <div className="receipt-bottom"><span>{x.detail || "A moment in the journey"}</span>{x.amount ? <strong>₹{fmtMoney(x.amount)}</strong>:<span>Open →</span>}</div>
    </button>
  }

  function Home() {
    return <main>
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow">ONE DATASET · HUNDREDS OF MOMENTS · ONE STORY</div>
          <h1>Your life,<br/><em>in receipts.</em></h1>
          <p className="hero-text">A collection of songs, purchases and transactions can look random. Look closer — patterns begin to connect, and disconnected moments start telling a story.</p>
          <div className="hero-actions"><button className="primary" onClick={()=>setSection("journey")}>Uncover the journey <span>→</span></button><button className="ghost" onClick={()=>setSection("patterns")}>See patterns</button></div>
        </div>
        <div className="orbit">
          <div className="orbit-ring ring1"></div><div className="orbit-ring ring2"></div><div className="orbit-ring ring3"></div>
          <div className="orbit-core"><span>✦</span><b>{(music.length+household.length+transactions.length).toLocaleString()}</b><small>moments</small></div>
          <span className="orbit-chip c1">♪ Music</span><span className="orbit-chip c2">₹ Purchases</span><span className="orbit-chip c3">⌁ Transactions</span>
        </div>
      </section>
      <section className="stats-grid">
        <Stat label="Music moments" value={music.length.toLocaleString()} sub="listening receipts"/>
        <Stat label="Household receipts" value={household.length.toLocaleString()} sub="daily activity"/>
        <Stat label="Transactions" value={transactions.length.toLocaleString()} sub="financial moments"/>
        <Stat label="Artists discovered" value={uniqueArtists.toLocaleString()} sub="distinct artists"/>
      </section>
      <section className="story-strip">
        <div><span className="eyebrow">THE IDEA</span><h2>Don't just show<br/><em>what happened.</em></h2></div>
        <p>Follow the clues. Explore the data. Find the relationships hiding between different kinds of moments — and decide what story they tell.</p>
      </section>
    </main>
  }

  function Journey() {
    return <main className="page">
      <div className="page-head"><div><div className="eyebrow">THE JOURNEY</div><h1>Moments become a <em>story.</em></h1></div><div className="mini-stat">{allReceipts.length.toLocaleString()} visible receipts</div></div>
      <div className="journey-layout">
        <div className="timeline">
          {allReceipts.slice(0,40).map((x,i)=><div className="timeline-row" key={x.id}>
            <div className="time">{x.date ? x.date.toLocaleDateString("en-IN",{day:"2-digit",month:"short"}):"—"}</div>
            <div className="line"><span></span></div><Receipt x={x}/>
          </div>)}
          {!allReceipts.length && <div className="empty">No receipts match your filters.</div>}
        </div>
        <aside className="insight-panel"><div className="eyebrow">STORY CLUES</div><h2>What the receipts reveal</h2>
          {insights.map((a,i)=><div className="clue" key={i}><span>{a.icon}</span><div><b>{a.title}</b><p>{a.text}</p></div></div>)}
        </aside>
      </div>
    </main>
  }

  function Connections() {
    const examples = [
      ["🎵","Music","Listening behavior","↘","🛒","Household","Everyday spending"],
      ["🎵","Music","Time of day","↘","💳","Transactions","Financial activity"],
      ["🛒","Household","Category","↘","💳","Transactions","Merchant / location"]
    ];
    return <main className="page">
      <div className="page-head"><div><div className="eyebrow">CONNECTIONS</div><h1>Follow the <em>threads.</em></h1></div></div>
      <p className="lead">The datasets describe different kinds of moments. We connect them through shared dimensions such as time, categories and behavioral patterns.</p>
      <div className="connection-grid">{examples.map((e,i)=><div className="connection" key={i}>
        <div className="node"><strong>{e[0]}</strong><b>{e[1]}</b><span>{e[2]}</span></div><div className="connector">{e[3]}</div>
        <div className="node"><strong>{e[4]}</strong><b>{e[5]}</b><span>{e[6]}</span></div>
        <button onClick={()=>setSection("patterns")}>Explore relationship →</button>
      </div>)}</div>
      <div className="connection-note"><span>✦</span><div><b>A useful way to read the data</b><p>When two datasets overlap in time, the overlap becomes a clue. When categories repeat, they become a pattern. When several clues align, they become a chapter.</p></div></div>
    </main>
  }

  function Patterns() {
    return <main className="page">
      <div className="page-head"><div><div className="eyebrow">PATTERNS</div><h1>The hidden <em>rhythm.</em></h1></div></div>
      <div className="chart-grid">
        <div className="chart-card wide"><div className="chart-title"><b>Moments over time</b><span>receipts + spending</span></div>
          <ResponsiveContainer width="100%" height={300}><AreaChart data={monthly}><CartesianGrid strokeDasharray="3 3" opacity={.12}/><XAxis dataKey="month"/><YAxis/><Tooltip/><Area type="monotone" dataKey="moments" stroke="#9b8cff" fill="#9b8cff" fillOpacity={.16}/></AreaChart></ResponsiveContainer>
        </div>
        <div className="chart-card"><div className="chart-title"><b>Spending categories</b><span>recorded amount</span></div>
          <ResponsiveContainer width="100%" height={300}><BarChart data={categories} layout="vertical"><CartesianGrid strokeDasharray="3 3" opacity={.12}/><XAxis type="number"/><YAxis type="category" dataKey="name" width={90}/><Tooltip/><Bar dataKey="value" radius={[0,5,5,0]}>{categories.map((_,i)=><Cell key={i} fill={colors[i%colors.length]}/>)}</Bar></BarChart></ResponsiveContainer>
        </div>
        <div className="chart-card"><div className="chart-title"><b>Listening by hour</b><span>music receipts</span></div>
          <ResponsiveContainer width="100%" height={300}><BarChart data={hourly}><CartesianGrid strokeDasharray="3 3" opacity={.12}/><XAxis dataKey="hour" interval={2}/><YAxis/><Tooltip/><Bar dataKey="moments" fill="#55d6be" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer>
        </div>
      </div>
      <div className="insight-cards">{insights.map((a,i)=><div className="big-insight" key={i}><span>{a.icon}</span><b>{a.title}</b><p>{a.text}</p></div>)}</div>
    </main>
  }

  function Receipts() {
    return <main className="page">
      <div className="page-head"><div><div className="eyebrow">RECEIPT LIBRARY</div><h1>Explore every <em>moment.</em></h1></div></div>
      <div className="filters"><div className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search songs, artists, merchants, categories..." /></div>
      <div className="pills">{["all","Music","Purchase","Transaction"].map(x=><button className={type.toLowerCase()===x.toLowerCase()?"selected":""} onClick={()=>setType(x.toLowerCase()==="all"?"all":x)} key={x}>{x}</button>)}</div></div>
      <div className="receipt-grid">{allReceipts.slice(0,80).map(x=><Receipt key={x.id} x={x}/>)}</div>
      <div className="result-count">Showing {Math.min(80,allReceipts.length).toLocaleString()} of {allReceipts.length.toLocaleString()} matching receipts</div>
    </main>
  }

  return <div className="app"><Nav/>
    {loading ? <div className="loader"><div className="spinner"></div><h2>Reading the receipts...</h2><p>Connecting your moments into a journey.</p></div> :
      section==="home"?<Home/>:section==="journey"?<Journey/>:section==="connections"?<Connections/>:section==="patterns"?<Patterns/>:<Receipts/>}
    {selected && <div className="modal-backdrop" onClick={()=>setSelected(null)}><div className="modal" onClick={e=>e.stopPropagation()}>
      <button className="close" onClick={()=>setSelected(null)}>×</button><span className={`tag ${selected.kind.toLowerCase()}`}>{selected.kind}</span><h2>{selected.title}</h2><p className="modal-sub">{selected.subtitle}</p>
      {selected.amount ? <div className="modal-amount">₹{fmtMoney(selected.amount)}</div>:null}
      <div className="raw"><b>Receipt details</b>{Object.entries(selected.raw).slice(0,12).map(([k,v])=><div key={k}><span>{k.replaceAll("_"," ")}</span><strong>{String(v)}</strong></div>)}</div>
    </div></div>}
    <footer><span>THOUGHT OF JOURNEY</span><span>Raw data → Insights → Connections → Story</span></footer>
  </div>
}
createRoot(document.getElementById("root")).render(<App />);
