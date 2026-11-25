import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDown, ArrowRight, BarChart3, Check, ChevronDown, CircleHelp,
  Clock3, Coins, FileText, FlaskConical, Gauge, History, KeyRound, LayoutDashboard,
  LockKeyhole, LogOut, Menu, Plus, Rocket, ShieldCheck, Sparkles, Upload, Users,
  X, Zap,
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { api } from "./api";

const initialPrompt = `You are a helpful customer support assistant. Please answer the user's question clearly and accurately.

Always be polite and professional. You should be courteous, friendly, and respectful in all of your responses.
If you don't know the answer, please say so and do not make up information.
Keep your answer concise and easy to understand. Please avoid unnecessary details.
Always be polite and professional in your response.`;
const initialCase = { input: "How do I reset my password?", expected: "Explain the password reset steps and mention contacting support if needed." };
const navItems = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "compress", label: "Prompt lab", icon: Sparkles },
  { id: "history", label: "Run history", icon: History },
  { id: "cost", label: "Cost estimator", icon: Coins },
];
const money = (value) => `$${Number(value || 0).toFixed(4)}`;
const pct = (value) => `${Number(value || 0).toFixed(1)}%`;

function App() {
  const [token, setToken] = useState(localStorage.getItem("pc_token"));
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("overview");
  const [mobileNav, setMobileNav] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [protectedSpans, setProtectedSpans] = useState([]);
  const [testCases, setTestCases] = useState([initialCase]);
  const [model, setModel] = useState("gpt-4o-mini");
  const [threshold, setThreshold] = useState(95);
  const [inputPrice, setInputPrice] = useState(0);
  const [outputPrice, setOutputPrice] = useState(0);
  const [experiment, setExperiment] = useState(null);
  const [selectedVariant, setSelectedVariant] = useState(1);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [apiConnected, setApiConnected] = useState(false);
  const settingsLoaded = useRef(false);

  useEffect(() => {
    api("/api/health").then(() => setApiConnected(true)).catch(() => setApiConnected(false));
  }, []);

  const loadData = useCallback(async (authToken = token) => {
    if (!authToken) return;
    try {
      const [me, summary, runs, defaults] = await Promise.all([
        api("/api/auth/me", { token: authToken }),
        api("/api/dashboard", { token: authToken }),
        api("/api/experiments", { token: authToken }),
        settingsLoaded.current ? Promise.resolve(null) : api("/api/settings", { token: authToken }),
      ]);
      setUser(me);
      setDashboard(summary);
      setHistory(runs);
      if (defaults) {
        setModel(defaults.default_model);
        setThreshold(defaults.default_threshold);
        setInputPrice(defaults.input_price);
        setOutputPrice(defaults.output_price);
        settingsLoaded.current = true;
      }
    } catch (e) {
      localStorage.removeItem("pc_token");
      settingsLoaded.current = false;
      setToken(null);
      setUser(null);
      setError(e.message);
    }
  }, [token]);

  useEffect(() => { loadData(); }, [loadData]);

  async function authenticate(credentials) {
    setError("");
    setBusy(true);
    try {
      if (authMode === "register") await api("/api/auth/register", { method: "POST", body: JSON.stringify(credentials) });
      const auth = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username: credentials.username, password: credentials.password }),
      });
      localStorage.setItem("pc_token", auth.access_token);
      setToken(auth.access_token);
      await loadData(auth.access_token);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function signOut() {
    localStorage.removeItem("pc_token");
    setToken(null); setUser(null); setDashboard(null); setExperiment(null); setResult(null);
  }

  function markSelection() {
    const area = document.getElementById("prompt-editor");
    const selection = prompt.slice(area.selectionStart, area.selectionEnd).trim();
    if (!selection) { setNotice("Select a sentence in the prompt first."); return; }
    if (protectedSpans.includes(selection)) return;
    setProtectedSpans((current) => [...current, selection]);
    setNotice("Protected instruction added. It will be preserved exactly.");
  }

  async function createExperiment(event) {
    event?.preventDefault();
    setError(""); setNotice(""); setBusy(true); setExperiment(null); setResult(null);
    try {
      const data = await api("/api/experiments", {
        token, method: "POST",
        body: JSON.stringify({
          prompt, protected_spans: protectedSpans, test_cases: testCases,
          model, threshold, input_price: Number(inputPrice), output_price: Number(outputPrice),
        }),
      });
      setExperiment(data); setSelectedVariant(1); setNotice(`Generated ${data.variants.length} protected variants.`);
      await loadData();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function runTest() {
    if (!experiment) return;
    setError(""); setNotice(""); setBusy(true); setResult(null);
    try {
      const data = await api(`/api/experiments/${experiment.id}/test`, {
        token, method: "POST", body: JSON.stringify({ variant_index: selectedVariant }),
      });
      setResult(data); setNotice(`Verification finished: ${data.decision}.`);
      await loadData();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function openRun(run) {
    setError(""); setBusy(true); setPage("compress");
    try {
      const detail = await api(`/api/experiments/${run.id}`, { token });
      setExperiment(detail);
      if (detail.result) {
        setResult(detail.result);
        const index = detail.variants.findIndex((variant) => variant.name === detail.result.variant_name);
        if (index >= 0) setSelectedVariant(index);
      }
      setPrompt(detail.original_prompt);
      setProtectedSpans(detail.protected_spans || []);
      setTestCases(detail.test_cases || []);
      setModel(detail.model);
      setThreshold(detail.threshold);
      setInputPrice(detail.input_price);
      setOutputPrice(detail.output_price);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  const latest = useMemo(() => history.slice(0, 5), [history]);
  const chartData = dashboard?.daily_activity || [];

  if (!token || !user) return <AuthScreen mode={authMode} setMode={setAuthMode} onSubmit={authenticate} busy={busy} error={error} />;

  return (
    <div className="app-shell">
      {mobileNav && <button aria-label="Close navigation" className="mobile-backdrop" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark"><Zap size={17} fill="currentColor" /></div><span>prompt<span className="brand-light">guard</span></span><button className="icon-btn mobile-close" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
        <div className="workspace-switch"><div className="workspace-avatar">P</div><div><b>Team Phoenix</b><small>Personal workspace</small></div><ChevronDown size={15} className="muted-icon"/></div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => { setPage(id); setMobileNav(false); }} className={`nav-link ${page === id ? "active" : ""}`}><Icon size={17}/><span>{label}</span>{id === "compress" && <span className="nav-new">NEW</span>}</button>)}</nav>
        {user.role === "admin" && <><div className="nav-caption nav-caption-admin">ADMINISTRATION</div><button onClick={() => { setPage("admin"); setMobileNav(false); }} className={`nav-link ${page === "admin" ? "active" : ""}`}><Users size={17}/><span>User access</span></button></>}
        <div className="sidebar-bottom">
          <div className="plan-card"><div className="plan-icon"><ShieldCheck size={16}/></div><div><b>Protected by design</b><p>Protected spans are validated before saving.</p></div></div>
          <div className="profile-row"><div className="user-avatar">{(user.username || "U").slice(0,1).toUpperCase()}</div><div className="profile-info"><b>{user.username}</b><small>{user.role}</small></div><button className="icon-btn" title="Sign out" onClick={signOut}><LogOut size={16}/></button></div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar"><button className="icon-btn menu-toggle" onClick={() => setMobileNav(true)}><Menu size={19}/></button><div className="breadcrumb">Workspace <span>/</span> <b>{page === "admin" ? "User access" : navItems.find((item) => item.id === page)?.label || "Prompt lab"}</b></div><div className="topbar-right"><span className={`api-status ${apiConnected ? "" : "api-disconnected"}`}><i/>{apiConnected ? "API connected" : "API unavailable"}</span><a className="icon-btn help-btn" href="http://localhost:8000/docs" title="API docs" target="_blank" rel="noreferrer"><CircleHelp size={17}/></a><div className="user-avatar top-avatar">{user.username.slice(0,1).toUpperCase()}</div></div></header>
        <div className="content">
          {error && <div className="alert alert-error"><X size={16}/>{error}<button onClick={() => setError("")}><X size={14}/></button></div>}
          {notice && <div className="alert alert-success"><Check size={16}/>{notice}<button onClick={() => setNotice("")}><X size={14}/></button></div>}
          {page === "overview" && <Dashboard dashboard={dashboard} history={latest} chartData={chartData} openRun={openRun} onNew={() => setPage("compress")} />}
          {page === "compress" && <Lab
            prompt={prompt} setPrompt={setPrompt} protectedSpans={protectedSpans} setProtectedSpans={setProtectedSpans}
            testCases={testCases} setTestCases={setTestCases} model={model} setModel={setModel}
            threshold={threshold} setThreshold={setThreshold} inputPrice={inputPrice} setInputPrice={setInputPrice}
            outputPrice={outputPrice} setOutputPrice={setOutputPrice} onMark={markSelection}
            onCreate={createExperiment} onTest={runTest} busy={busy} experiment={experiment}
            selectedVariant={selectedVariant} setSelectedVariant={setSelectedVariant} result={result} />
          }
          {page === "history" && <HistoryPage history={history} openRun={openRun} />}
          {page === "cost" && <CostPage />}
          {page === "admin" && user.role === "admin" && <AdminPage token={token} onSettingsSaved={(defaults) => {setModel(defaults.default_model);setThreshold(defaults.default_threshold);setInputPrice(defaults.input_price);setOutputPrice(defaults.output_price);}} />}
        </div>
      </main>
    </div>
  );
}

function AuthScreen({ mode, setMode, onSubmit, busy, error }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  return <div className="auth-page"><div className="auth-card">
    <div className="brand auth-brand"><div className="brand-mark"><Zap size={17} fill="currentColor"/></div><span>prompt<span className="brand-light">guard</span></span></div>
    <div className="auth-pill"><LockKeyhole size={13}/> SECURE WORKSPACE</div><h1>{mode === "login" ? "Welcome back" : "Create your account"}</h1>
    <p className="auth-subtitle">{mode === "login" ? "Sign in to continue to your prompt workspace." : "Create an analyst account to get started."}</p>
    {error && <div className="alert alert-error auth-error">{error}</div>}
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ username, password }); }}>
      <label>Username</label><input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} minLength="3" required placeholder="yourname"/>
      <label>Password</label><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} minLength="8" required placeholder="At least 8 characters"/>
      <button className="primary-btn auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"} <ArrowRight size={16}/></button>
    </form>
    <div className="auth-switch">{mode === "login" ? "New to PromptGuard?" : "Already have an account?"} <button onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Create an account" : "Sign in"}</button></div>
    <div className="auth-foot"><ShieldCheck size={14}/> Protected instructions stay protected.</div>
  </div><div className="auth-decoration decoration-one"/><div className="auth-decoration decoration-two"/></div>;
}

function Dashboard({ dashboard, history, chartData, openRun, onNew }) {
  const metrics = [
    { label: "Prompts processed", value: dashboard?.total_experiments ?? "—", change: "All time", icon: FileText, color: "violet" },
    { label: "Tokens saved", value: Number(dashboard?.tokens_saved || 0).toLocaleString(), change: "Across verified runs", icon: Zap, color: "blue" },
    { label: "Avg. compression", value: pct(dashboard?.average_compression), change: "Prompt size reduction", icon: ArrowDown, color: "green" },
    { label: "Cost saved", value: money(dashboard?.total_cost_saved), change: "Estimated total", icon: Coins, color: "amber" },
  ];
  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR WORKSPACE</div><h1>Overview</h1><p>Monitor prompt efficiency and equivalence at a glance.</p></div><button className="primary-btn" onClick={onNew}><Plus size={17}/> New experiment</button></div>
    <div className="metric-grid">{metrics.map(({label,value,change,icon:Icon,color}) => <div className="metric-card" key={label}><div className={`metric-icon ${color}`}><Icon size={17}/></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-change">{change}</div></div>)}</div>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-heading"><div><h2>Compression activity</h2><p>Runs and tokens saved over the last 7 days</p></div><div className="chart-legend"><span><i className="legend-violet"/> Runs</span><span><i className="legend-blue"/> Tokens saved</span></div></div>
      {chartData.length ? <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="runsGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#9875ff" stopOpacity={0.22}/><stop offset="95%" stopColor="#9875ff" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#20232d" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:11}}/><YAxis yAxisId="runs" tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:10}} width={24}/><YAxis yAxisId="tokens" orientation="right" tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:10}} width={32}/><Tooltip contentStyle={{background:"#151821",border:"1px solid #292d3a",borderRadius:8,color:"#fff"}}/><Area yAxisId="runs" type="monotone" dataKey="runs" name="Runs" stroke="#9b7aff" fill="url(#runsGradient)" strokeWidth={2}/><Line yAxisId="tokens" type="monotone" dataKey="tokens_saved" name="Tokens saved" stroke="#63a8ff" strokeWidth={2} dot={false}/></AreaChart></ResponsiveContainer></div> : <div className="empty-chart"><div className="empty-chart-icon"><BarChart3 size={21}/></div><b>Your activity will appear here</b><span>Run your first experiment to start tracking efficiency.</span><button className="text-btn" onClick={onNew}>Start compressing <ArrowRight size={14}/></button></div>}
    </section>
    <section className="panel score-panel"><div className="panel-heading"><div><h2>Equivalence health</h2><p>Average verified output score</p></div><div className="small-icon"><Gauge size={17}/></div></div><div className="score-gauge"><div className="score-inner"><b>{pct(dashboard?.average_equivalence)}</b><span>average score</span></div><div className="gauge-track"><div style={{ "--score": `${dashboard?.average_equivalence || 0}%` }} className="gauge-progress"/></div></div><div className="score-foot"><span><i className="status-dot green-dot"/> Acceptance threshold</span><b>95%</b></div><div className="score-foot"><span><i className="status-dot violet-dot"/> Verified experiments</span><b>{dashboard?.verified_experiments || 0}</b></div></section></div>
    <div className="analytics-grid">
      <section className="panel analytics-panel"><div className="panel-heading"><div><h2>Token usage</h2><p>Verified prompt tokens before vs. after</p></div></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#20232d" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:9}}/><YAxis tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:9}} width={32}/><Tooltip contentStyle={{background:"#151821",border:"1px solid #292d3a",borderRadius:8,color:"#fff"}}/><Line type="monotone" dataKey="tokens_before" name="Original tokens" stroke="#fbac68" strokeWidth={2} dot={false}/><Line type="monotone" dataKey="tokens_after" name="Compressed tokens" stroke="#63a8ff" strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div></section>
      <section className="panel analytics-panel"><div className="panel-heading"><div><h2>Equivalence history</h2><p>Average score per day against your threshold</p></div></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartData}><CartesianGrid stroke="#20232d" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:9}}/><YAxis domain={[0,100]} tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:9}} width={32}/><Tooltip contentStyle={{background:"#151821",border:"1px solid #292d3a",borderRadius:8,color:"#fff"}} formatter={(value)=>value == null ? "—" : `${Number(value).toFixed(1)}%`}/><Line type="monotone" dataKey="equivalence" name="Equivalence" stroke="#57d59b" strokeWidth={2} dot={false} connectNulls/></LineChart></ResponsiveContainer></div></section>
      <section className="panel analytics-panel"><div className="panel-heading"><div><h2>Estimated savings</h2><p>Cost saved per day from tested runs</p></div></div><div className="mini-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><defs><linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#57d59b" stopOpacity={0.22}/><stop offset="95%" stopColor="#57d59b" stopOpacity={0}/></linearGradient></defs><CartesianGrid stroke="#20232d" vertical={false}/><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:9}}/><YAxis tickLine={false} axisLine={false} tick={{fill:"#747b8e",fontSize:9}} width={35}/><Tooltip contentStyle={{background:"#151821",border:"1px solid #292d3a",borderRadius:8,color:"#fff"}} formatter={(value)=>money(value)}/><Area type="monotone" dataKey="cost_saved" name="Cost saved" stroke="#57d59b" fill="url(#costGradient)" strokeWidth={2}/></AreaChart></ResponsiveContainer></div></section>
    </div>
    <section className="panel recent-panel"><div className="panel-heading"><div><h2>Recent experiments</h2><p>Your latest prompt compression runs</p></div><button className="text-btn" onClick={() => openRun(history[0])} disabled={!history.length}>View details <ArrowRight size={14}/></button></div>
      {history.length ? <div className="table-scroll"><table><thead><tr><th>PROMPT</th><th>MODEL</th><th>TOKENS SAVED</th><th>EQUIVALENCE</th><th>STATUS</th><th></th></tr></thead><tbody>{history.map((row) => <tr key={row.id}><td><div className="prompt-cell"><span className="prompt-icon"><FileText size={14}/></span><b>{row.title || row.original_prompt?.slice(0,45) || "Prompt experiment"}</b></div></td><td className="muted-cell">{row.model}</td><td className="number-cell">-{row.tokens_saved || 0}</td><td className="number-cell">{row.equivalence_score == null ? "—" : pct(row.equivalence_score)}</td><td><StatusBadge decision={row.decision}/></td><td><button className="row-arrow" onClick={() => openRun(row)}><ArrowRight size={15}/></button></td></tr>)}</tbody></table></div> : <div className="empty-table">No runs yet — your experiments will be saved here.</div>}
    </section><div className="disclaimer"><ShieldCheck size={14}/> Equivalence scores represent empirical verification against your test cases, not a mathematical guarantee.</div>
  </div>;
}

function Lab(props) {
  const { prompt, setPrompt, protectedSpans, setProtectedSpans, testCases, setTestCases, model, setModel, threshold, setThreshold, inputPrice, setInputPrice, outputPrice, setOutputPrice, onMark, onCreate, onTest, busy, experiment, selectedVariant, setSelectedVariant, result } = props;
  const [activeTab, setActiveTab] = useState("editor");
  const [fileName, setFileName] = useState("");
  const activeVariant = experiment?.variants?.[selectedVariant];
  const chars = prompt.length;
  return <div className="page-enter">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> EXPERIMENT WORKSPACE</div><h1>Prompt lab</h1><p>Compress, protect, and verify your prompts before they ship.</p></div><div className="lab-heading-actions"><span className="draft-badge"><i/> {experiment ? "Saved experiment" : "Unsaved changes"}</span><button className="primary-btn" onClick={onCreate} disabled={busy || !prompt.trim()}><Sparkles size={16}/>{busy ? "Working…" : "Generate variants"}</button></div></div>
    <div className="stepper"><div className="step active"><span>01</span> Define prompt</div><div className="step-line"/><div className={`step ${experiment ? "active" : ""}`}><span>02</span> Compress</div><div className="step-line"/><div className={`step ${result ? "active" : ""}`}><span>03</span> Verify equivalence</div></div>
    <div className="lab-toolbar"><div className="tabs"><button className={activeTab === "editor" ? "tab active-tab" : "tab"} onClick={() => setActiveTab("editor")}><FileText size={15}/> Editor</button><button className={activeTab === "tests" ? "tab active-tab" : "tab"} onClick={() => setActiveTab("tests")}><FlaskConical size={15}/> Test cases <span className="tab-count">{testCases.length}</span></button></div><div className="toolbar-note"><LockKeyhole size={13}/> Protected spans are immutable</div></div>
    {activeTab === "editor" ? <div className="lab-grid"><section className="panel editor-panel"><div className="editor-header"><div><h2>Original prompt</h2><p>Paste a prompt or upload a text file to begin.</p></div><label className="secondary-btn upload-btn"><Upload size={15}/> Upload .txt<input type="file" accept=".txt,text/plain" hidden onChange={(e) => {const file=e.target.files?.[0];if(file){file.text().then(setPrompt);setFileName(file.name);}}}/></label></div>
      {fileName && <div className="file-loaded"><FileText size={13}/>{fileName}<button onClick={() => setFileName("")}><X size={13}/></button></div>}
      <textarea id="prompt-editor" className="prompt-textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} spellCheck="false" placeholder="Write your prompt here…"/>
      <div className="editor-bottom"><span>{chars.toLocaleString()} characters <i/> ~{Math.ceil(chars / 4)} tokens</span><div><button className="text-btn" onClick={onMark}><LockKeyhole size={13}/> Protect selection</button><button className="text-btn" onClick={() => {setPrompt("");setProtectedSpans([]);setFileName("");}}>Clear</button><button className="text-btn" onClick={() => {setPrompt(initialPrompt);setProtectedSpans([]);setFileName("");}}>Reset sample</button></div></div>
      {!!protectedSpans.length && <div className="protected-list"><div className="protected-list-title"><ShieldCheck size={14}/> PROTECTED INSTRUCTIONS <span>{protectedSpans.length}</span></div>{protectedSpans.map((span,i)=><div className="protected-chip" key={`${span}-${i}`}><LockKeyhole size={12}/><span>{span}</span><button onClick={() => setProtectedSpans(protectedSpans.filter((_,index)=>index!==i))}><X size={12}/></button></div>)}<div className="highlight-preview"><span>HIGHLIGHTED IN ORIGINAL</span><p>{highlightProtected(prompt,protectedSpans)}</p></div></div>}
    </section><div className="settings-stack"><section className="panel settings-panel"><div className="settings-title"><div className="settings-icon"><KeyRound size={15}/></div><div><h3>Model settings</h3><p>Used identically for both prompts.</p></div></div><label className="field-label">AI MODEL</label><select value={model} onChange={(e)=>setModel(e.target.value)}><option>gpt-4o-mini</option><option>gpt-4o</option><option>gpt-4.1-mini</option><option>gpt-4.1</option></select><div className="form-row"><div><label className="field-label">INPUT $ / 1M TOKENS</label><input type="number" min="0" step="0.01" value={inputPrice} onChange={(e)=>setInputPrice(e.target.value)}/></div><div><label className="field-label">OUTPUT $ / 1M TOKENS</label><input type="number" min="0" step="0.01" value={outputPrice} onChange={(e)=>setOutputPrice(e.target.value)}/></div></div><div className="threshold-setting"><label className="field-label">ACCEPTANCE THRESHOLD <b>{threshold}%</b></label><input type="range" min="50" max="100" step="1" value={threshold} onChange={(e)=>setThreshold(Number(e.target.value))}/><div className="range-hints"><span>50% permissive</span><span>100% strict</span></div></div></section><div className="engine-note"><div><ShieldCheck size={16}/></div><p><b>Protected-span validation</b><br/>Any variant that changes a protected instruction is rejected automatically.</p></div></div></div> : <TestCaseEditor cases={testCases} setCases={setTestCases}/>}
    {experiment && <section className="variants-section"><div className="section-title"><div><div className="eyebrow"><span className="eyebrow-dot"/> COMPRESSION OUTPUT</div><h2>Choose a variant to verify</h2></div><span className="engine-pill"><Sparkles size={13}/> {experiment.compression_mode === "llm" ? "LLM compressed" : "Rule-based fallback"}</span></div><div className="variant-grid">{experiment.variants.map((variant,index)=><button onClick={()=>setSelectedVariant(index)} key={variant.name} className={`variant-card ${selectedVariant===index?"variant-selected":""}`}><div className="variant-top"><span className={`variant-number variant-${index}`}>0{index+1}</span><span className="variant-name">{variant.name}</span>{selectedVariant===index&&<span className="selected-check"><Check size={13}/></span>}</div><p className="variant-description">{variant.description}</p><div className="variant-preview">{variant.prompt}</div><div className="variant-stats"><span>{variant.token_count} tokens</span><span className="variant-saved">{variant.tokens_saved} saved ({pct(variant.compression_pct)})</span></div><div className="protected-status"><ShieldCheck size={13}/> Protected instructions intact</div></button>)}</div>
      <div className="verify-bar"><div><div className="verify-icon"><FlaskConical size={17}/></div><div><b>Run equivalence test</b><small>Compares original and selected prompt on {experiment.test_cases.length} test case{experiment.test_cases.length===1?"":"s"} using {experiment.model}.</small></div></div><button className="primary-btn" disabled={busy||!experiment.test_cases.length} onClick={onTest}>{busy?"Testing…":"Test selected variant"} <ArrowRight size={15}/></button></div>
    </section>}
    {result && <ResultPanel result={result} experiment={experiment} variant={activeVariant} />}
  </div>;
}

function TestCaseEditor({cases,setCases}) {
  return <section className="panel test-editor"><div className="editor-header"><div><h2>Equivalence test cases</h2><p>Use the exact same inputs to compare model outputs.</p></div><button className="secondary-btn" onClick={()=>setCases([...cases,{input:"",expected:""}])}><Plus size={14}/> Add case</button></div>{cases.map((item,index)=><div className="test-case-card" key={index}><div className="test-case-head"><b>Test case {String(index+1).padStart(2,"0")}</b>{cases.length>1&&<button className="icon-btn" onClick={()=>setCases(cases.filter((_,i)=>i!==index))}><X size={15}/></button>}</div><label className="field-label">USER INPUT</label><textarea value={item.input} onChange={(e)=>setCases(cases.map((current,i)=>i===index?{...current,input:e.target.value}:current))} placeholder="What should the model respond to?"/><label className="field-label">EXPECTED BEHAVIOR <span className="optional">(optional scoring hints)</span></label><input value={item.expected} onChange={(e)=>setCases(cases.map((current,i)=>i===index?{...current,expected:e.target.value}:current))} placeholder="Required facts, tone, or output format…"/></div>)}</section>;
}

function ResultPanel({result,experiment,variant}) {
  const score = Number(result.equivalence_score || 0);
  const comparedPrompt = variant?.prompt || experiment.variants.find((item) => item.name === result.variant_name)?.prompt || "";
  function downloadCsv() {
    const rows=[
      ["Metric","Original","Compressed"],
      ["Prompt",experiment.original_prompt,comparedPrompt],
      ["Token count",result.original_token_count,result.compressed_token_count],
      ["Character count",experiment.original_prompt.length,comparedPrompt.length],
      ["Estimated test-run cost",result.original_cost,result.compressed_cost],
      [],
      ["Test case","Input","Original output","Compressed output","Similarity","Rule score"],
      ...result.comparisons.map((item,index)=>[index+1,item.input,item.original_output,item.compressed_output,item.embedding_similarity,item.rule_score]),
    ];
    const csv=rows.map(row=>row.map((cell)=>`"${String(cell??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
    const anchor=document.createElement("a");anchor.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));anchor.download="promptguard-comparison.csv";anchor.click();URL.revokeObjectURL(anchor.href);
  }
  return <section className="result-section"><div className={`result-banner ${result.decision==="ACCEPT"?"accept":"reject"}`}><div className="result-status-icon">{result.decision==="ACCEPT"?<Check size={18}/>:<X size={18}/>}</div><div><b>{result.decision}</b><p>{result.decision==="ACCEPT"?"The compressed prompt passed your configured equivalence threshold.":"The compressed prompt did not meet the configured threshold."}</p></div><div className="result-score"><b>{pct(score)}</b><span>equivalence score</span></div><button className="secondary-btn" onClick={downloadCsv}><ArrowDown size={14}/> Export CSV</button></div>
    <div className="result-metrics"><Metric label="Original tokens" value={result.original_token_count}/><Metric label="Compressed tokens" value={result.compressed_token_count}/><Metric label="Tokens saved" value={result.tokens_saved}/><Metric label="Est. cost saved / run" value={money(result.cost_saved)}/><Metric label="Rule verification" value={pct(result.rule_score)} good={result.rules_passed}/><Metric label="Protected spans" value={result.protected_intact?"Intact":"Failed"} good={result.protected_intact}/></div>
    <div className="panel compare-table-panel"><div className="panel-heading"><div><h2>Prompt comparison</h2><p>Measured for this experiment's test-case count.</p></div><span className="output-model">{result.variant_name}</span></div><div className="compare-table-wrap"><table className="compare-table"><thead><tr><th>METRIC</th><th>ORIGINAL</th><th>COMPRESSED</th></tr></thead><tbody><tr><td>Token count</td><td>{result.original_token_count}</td><td>{result.compressed_token_count}</td></tr><tr><td>Character count</td><td>{experiment.original_prompt.length.toLocaleString()}</td><td>{comparedPrompt.length.toLocaleString()}</td></tr><tr><td>Estimated cost</td><td>{money(result.original_cost)}</td><td>{money(result.compressed_cost)}</td></tr></tbody></table></div><div className="prompt-side-by-side"><div><span>ORIGINAL PROMPT</span><pre>{experiment.original_prompt}</pre></div><div><span>COMPRESSED PROMPT</span><pre>{comparedPrompt}</pre></div></div></div>
    <div className="panel outputs-panel"><div className="panel-heading"><div><h2>Output comparison</h2><p>Same test inputs, model settings, and random seed.</p></div><span className="output-model">{experiment.model}</span></div>{result.comparisons.map((item,index)=><div className="output-case" key={index}><div className="output-input"><span>TEST INPUT {String(index+1).padStart(2,"0")}</span><p>{item.input}</p></div><div className="output-pair"><div><span>ORIGINAL RESPONSE</span><p>{item.original_output}</p></div><div><span>COMPRESSED RESPONSE</span><p>{item.compressed_output}</p></div></div><div className="case-scores"><span>Similarity <b>{pct(item.embedding_similarity*100)}</b></span><span>Rule score <b>{pct(item.rule_score*100)}</b></span></div></div>)}</div>
    <div className="comparison-footnote"><ShieldCheck size={14}/> Empirical equivalence is measured only against the test cases above; it is not a guarantee of identical behavior in all situations. Similarity method: {result.similarity_method}.</div>
  </section>;
}

function Metric({label,value,good}) { return <div className="result-metric"><span>{label}</span><b className={good===false?"metric-bad":good===true?"metric-good":""}>{value}</b></div>; }
function StatusBadge({decision}) { return decision==="ACCEPT"?<span className="status-badge accepted"><Check size={12}/> ACCEPT</span>:decision==="REJECT"?<span className="status-badge rejected"><X size={12}/> REJECT</span>:<span className="status-badge pending"><Clock3 size={12}/> PENDING</span>; }

function highlightProtected(text,spans) {
  const ranges=[];
  spans.forEach((span)=>{let from=0;while(span&&from<text.length){const start=text.indexOf(span,from);if(start<0)break;ranges.push({start,end:start+span.length});from=start+span.length;}});
  ranges.sort((a,b)=>a.start-b.start||b.end-a.end);
  const merged=[];
  ranges.forEach((range)=>{const last=merged[merged.length-1];if(last&&range.start<=last.end)last.end=Math.max(last.end,range.end);else merged.push({...range});});
  let cursor=0;
  return merged.flatMap((range,index)=>{const parts=[];if(range.start>cursor)parts.push(text.slice(cursor,range.start));parts.push(<mark key={index}>{text.slice(range.start,range.end)}</mark>);cursor=range.end;return parts;}).concat(text.slice(cursor));
}

function HistoryPage({history,openRun}) {
  return <div className="page-enter"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> ACTIVITY LOG</div><h1>Run history</h1><p>Review and revisit your past compression experiments.</p></div><span className="history-count">{history.length} experiments</span></div><section className="panel history-panel">{history.length?<div className="table-scroll"><table><thead><tr><th>PROMPT</th><th>MODEL</th><th>ORIGINAL → NEW</th><th>SAVED</th><th>SCORE</th><th>DECISION</th><th>DATE</th><th></th></tr></thead><tbody>{history.map((item)=><tr key={item.id}><td><div className="prompt-cell"><span className="prompt-icon"><FileText size={14}/></span><b>{item.original_prompt?.slice(0,52)||"Prompt experiment"}</b></div></td><td className="muted-cell">{item.model}</td><td className="number-cell">{item.original_token_count||"—"} → {item.compressed_token_count||"—"}</td><td className="number-cell">-{item.tokens_saved||0}</td><td className="number-cell">{item.equivalence_score==null?"—":pct(item.equivalence_score)}</td><td><StatusBadge decision={item.decision}/></td><td className="muted-cell">{new Date(item.created_at).toLocaleDateString()}</td><td><button className="row-arrow" onClick={()=>openRun(item)}><ArrowRight size={15}/></button></td></tr>)}</tbody></table></div>:<div className="empty-table"><History size={22}/><b>No experiments recorded yet</b><span>Compression runs you create will be listed here.</span></div>}</section></div>;
}

function AdminPage({token,onSettingsSaved}) {
  const [users,setUsers]=useState([]);
  const [defaults,setDefaults]=useState({default_model:"gpt-4o-mini",default_threshold:95,input_price:0,output_price:0});
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(null);
  const [savingSettings,setSavingSettings]=useState(false);
  const [settingsNotice,setSettingsNotice]=useState("");
  const refresh=useCallback(async()=>{setLoading(true);try{const [members,settings]=await Promise.all([api("/api/admin/users",{token}),api("/api/admin/settings",{token})]);setUsers(members);setDefaults(settings);setError("");}catch(e){setError(e.message);}finally{setLoading(false);}},[token]);
  useEffect(()=>{refresh();},[refresh]);
  async function updateRole(userId,role) {
    setSaving(userId);setError("");
    try { await api(`/api/admin/users/${userId}/role`,{token,method:"PATCH",body:JSON.stringify({role})}); await refresh(); }
    catch(e){setError(e.message);}
    finally{setSaving(null);}
  }
  async function saveSettings(event) {
    event.preventDefault();setSavingSettings(true);setError("");setSettingsNotice("");
    try {const saved=await api("/api/admin/settings",{token,method:"PUT",body:JSON.stringify({...defaults,default_threshold:Number(defaults.default_threshold),input_price:Number(defaults.input_price),output_price:Number(defaults.output_price)})});setDefaults(saved);onSettingsSaved(saved);setSettingsNotice("Workspace defaults saved.");}
    catch(e){setError(e.message);}
    finally{setSavingSettings(false);}
  }
  return <div className="page-enter"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> WORKSPACE ADMIN</div><h1>Workspace settings</h1><p>Manage member roles and defaults for new experiments.</p></div><span className="history-count">{users.length} members</span></div>{error&&<div className="alert alert-error">{error}</div>}{settingsNotice&&<div className="alert alert-success"><Check size={15}/>{settingsNotice}</div>}<div className="admin-grid"><section className="panel admin-panel"><div className="panel-heading"><div><h2>Workspace members</h2><p>Analysts can run experiments; viewers have read-only access.</p></div><div className="small-icon"><Users size={16}/></div></div>{loading?<div className="empty-table">Loading members…</div>:<div className="table-scroll"><table><thead><tr><th>MEMBER</th><th>ROLE</th><th>ACCESS</th></tr></thead><tbody>{users.map((member)=><tr key={member.id}><td><div className="prompt-cell"><span className="user-avatar">{member.username.slice(0,1).toUpperCase()}</span><b>{member.username}</b></div></td><td><select className="role-select" value={member.role} disabled={saving===member.id} onChange={(e)=>updateRole(member.id,e.target.value)}><option value="admin">Admin</option><option value="analyst">Analyst</option><option value="viewer">Viewer</option></select></td><td className="muted-cell">{member.role==="viewer"?"Read-only":"Can create and test"}</td></tr>)}</tbody></table></div>}</section><section className="panel admin-settings"><div className="panel-heading"><div><h2>Experiment defaults</h2><p>Users can override these on each run.</p></div><div className="small-icon"><KeyRound size={15}/></div></div><form onSubmit={saveSettings}><label className="field-label">DEFAULT MODEL</label><select value={defaults.default_model} onChange={(e)=>setDefaults({...defaults,default_model:e.target.value})}><option>gpt-4o-mini</option><option>gpt-4o</option><option>gpt-4.1-mini</option><option>gpt-4.1</option></select><label className="field-label">DEFAULT ACCEPTANCE THRESHOLD (%)</label><input type="number" min="50" max="100" value={defaults.default_threshold} onChange={(e)=>setDefaults({...defaults,default_threshold:e.target.value})}/><label className="field-label">INPUT PRICE / 1M TOKENS ($)</label><input type="number" min="0" step="0.01" value={defaults.input_price} onChange={(e)=>setDefaults({...defaults,input_price:e.target.value})}/><label className="field-label">OUTPUT PRICE / 1M TOKENS ($)</label><input type="number" min="0" step="0.01" value={defaults.output_price} onChange={(e)=>setDefaults({...defaults,output_price:e.target.value})}/><button className="primary-btn settings-save" disabled={savingSettings}>{savingSettings?"Saving…":"Save workspace defaults"} <Check size={14}/></button></form></section></div><div className="disclaimer"><ShieldCheck size={14}/> Your own admin role cannot be removed here. Pricing is configurable and no current API price is assumed.</div></div>;
}

function CostPage() {
  const [model,setModel]=useState("Custom model");const [inputTokens,setInputTokens]=useState(1000);const [outputTokens,setOutputTokens]=useState(300);const [inputPrice,setInputPrice]=useState(0);const [outputPrice,setOutputPrice]=useState(0);const [requests,setRequests]=useState(10000);const [reduction,setReduction]=useState(35);
  const before=((inputTokens*inputPrice)+(outputTokens*outputPrice))/1_000_000*requests;
  const after=((inputTokens*(1-reduction/100)*inputPrice)+(outputTokens*outputPrice))/1_000_000*requests;
  return <div className="page-enter"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-dot"/> PRICING WORKSPACE</div><h1>Cost estimator</h1><p>Forecast your token spend with editable model pricing.</p></div></div><div className="cost-layout"><section className="panel cost-form"><div className="panel-heading"><div><h2>Configure estimate</h2><p>Prices are supplied by you; no API pricing is assumed.</p></div><div className="small-icon"><Coins size={16}/></div></div><label className="field-label">MODEL LABEL</label><input value={model} onChange={(e)=>setModel(e.target.value)}/><div className="form-row"><div><label className="field-label">INPUT TOKENS / REQUEST</label><input type="number" min="0" value={inputTokens} onChange={(e)=>setInputTokens(Number(e.target.value))}/></div><div><label className="field-label">OUTPUT TOKENS / REQUEST</label><input type="number" min="0" value={outputTokens} onChange={(e)=>setOutputTokens(Number(e.target.value))}/></div></div><div className="form-row"><div><label className="field-label">INPUT PRICE / 1M TOKENS ($)</label><input type="number" min="0" step="0.01" value={inputPrice} onChange={(e)=>setInputPrice(Number(e.target.value))}/></div><div><label className="field-label">OUTPUT PRICE / 1M TOKENS ($)</label><input type="number" min="0" step="0.01" value={outputPrice} onChange={(e)=>setOutputPrice(Number(e.target.value))}/></div></div><div className="form-row"><div><label className="field-label">MONTHLY REQUESTS</label><input type="number" min="0" value={requests} onChange={(e)=>setRequests(Number(e.target.value))}/></div><div><label className="field-label">INPUT REDUCTION</label><div className="input-with-suffix"><input type="number" min="0" max="100" value={reduction} onChange={(e)=>setReduction(Math.min(100,Math.max(0,Number(e.target.value))))}/><span>%</span></div></div></div><div className="cost-model-note"><Activity size={14}/> Output token count and output pricing are kept constant.</div></section><section className="panel cost-result"><div className="cost-result-top"><span className="cost-result-label">PROJECTED MONTHLY SAVINGS</span><div className="cost-savings">{money(before-after)}<span>/ month</span></div><div className="cost-result-model">{model} · {Number(requests).toLocaleString()} requests / month</div></div><div className="cost-breakdown"><div><span>Original monthly cost</span><b>{money(before)}</b></div><div><span>Compressed monthly cost</span><b>{money(after)}</b></div><div><span>Annual savings</span><b className="green-text">{money((before-after)*12)}</b></div><div><span>Cost reduction</span><b>{before?pct((before-after)/before*100):"0.0%"}</b></div></div><div className="cost-result-foot"><ShieldCheck size={15}/> Estimate uses configurable pricing and input token savings only.</div></section></div></div>;
}

export default App;
