import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, AreaChart, Area, CartesianGrid, Legend
} from "recharts";

// ═══ AWS SIGV4 SIGNING (Web Crypto API) ═══
const encoder = new TextEncoder();

async function hmacSHA256(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data)));
}

async function sha256(data) {
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getSignatureKey(secretKey, dateStamp, region, service) {
  let key = await hmacSHA256("AWS4" + secretKey, dateStamp);
  key = await hmacSHA256(key, region);
  key = await hmacSHA256(key, service);
  key = await hmacSHA256(key, "aws4_request");
  return key;
}

async function signRequest({ method, url, region, accessKeyId, secretAccessKey, service = "s3" }) {
  const parsedUrl = new URL(url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const headers = {
    host: parsedUrl.host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
  };
  const signedHeaderKeys = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers).sort().map(k => k + ":" + headers[k] + "\n").join("");
  const sortedParams = [...parsedUrl.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalQueryString = sortedParams.map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(v)).join("&");
  const canonicalRequest = [method, parsedUrl.pathname, canonicalQueryString, canonicalHeaders, signedHeaderKeys, "UNSIGNED-PAYLOAD"].join("\n");
  const credentialScope = dateStamp + "/" + region + "/" + service + "/aws4_request";
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, await sha256(canonicalRequest)].join("\n");
  const signingKey = await getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signatureBytes = await hmacSHA256(signingKey, stringToSign);
  const signature = Array.from(signatureBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  return {
    ...headers,
    Authorization: "AWS4-HMAC-SHA256 Credential=" + accessKeyId + "/" + credentialScope + ", SignedHeaders=" + signedHeaderKeys + ", Signature=" + signature,
  };
}

// ═══ S3 CLIENT ═══
async function s3ListObjects(bucket, region, prefix, accessKeyId, secretAccessKey, continuationToken) {
  const params = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
  if (continuationToken) params.set("continuation-token", continuationToken);
  const url = "https://" + bucket + ".s3." + region + ".amazonaws.com/?" + params;
  const headers = await signRequest({ method: "GET", url, region, accessKeyId, secretAccessKey });
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("S3 ListObjects failed: " + res.status + " " + (await res.text()));
  const text = await res.text();
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "text/xml");
  const keys = [...xml.querySelectorAll("Contents > Key")].map(n => n.textContent);
  const isTruncated = xml.querySelector("IsTruncated")?.textContent === "true";
  const nextToken = xml.querySelector("NextContinuationToken")?.textContent;
  return { keys, isTruncated, nextToken };
}

async function s3GetObject(bucket, region, key, accessKeyId, secretAccessKey) {
  const encodedKey = encodeURIComponent(key).replace(/%2F/g, "/");
  const url = "https://" + bucket + ".s3." + region + ".amazonaws.com/" + encodedKey;
  const headers = await signRequest({ method: "GET", url, region, accessKeyId, secretAccessKey });
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error("S3 GetObject failed for " + key + ": " + res.status);
  return res.text();
}

// ═══ COWRIE EVENT PARSER & SESSION CORRELATOR ═══
function parseNDJSON(text) {
  return text.split("\n").filter(l => l.trim()).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function correlateSessions(rawEvents) {
  const sessionMap = {};
  rawEvents.forEach(ev => {
    const sid = ev.session;
    if (!sid) return;
    if (!sessionMap[sid]) {
      sessionMap[sid] = {
        session: sid, src_ip: ev.src_ip, src_port: ev.src_port, dst_ip: ev.dst_ip,
        dst_port: ev.dst_port, protocol: ev.protocol || "unknown", sensor: ev.sensor,
        start_time: ev.timestamp, end_time: ev.timestamp, duration: 0,
        events: [], eventTypes: new Set(), commands: [], login_attempts: [],
        login_success: false, username: null, password: null, ssh_version: null,
        hassh: null, files_downloaded: [], files_uploaded: [], ttylog: null,
      };
    }
    const s = sessionMap[sid];
    s.events.push(ev);
    s.eventTypes.add(ev.eventid);
    if (ev.src_ip && !s.src_ip) s.src_ip = ev.src_ip;
    if (ev.timestamp > s.end_time) s.end_time = ev.timestamp;
    if (ev.timestamp < s.start_time) s.start_time = ev.timestamp;
    switch (ev.eventid) {
      case "cowrie.session.closed": s.duration = parseFloat(ev.duration) || 0; break;
      case "cowrie.login.failed": s.login_attempts.push({ username: ev.username, password: ev.password, success: false }); break;
      case "cowrie.login.success":
        s.login_success = true; s.username = ev.username; s.password = ev.password;
        s.login_attempts.push({ username: ev.username, password: ev.password, success: true }); break;
      case "cowrie.command.input": s.commands.push(ev.input); break;
      case "cowrie.client.version": s.ssh_version = ev.version; break;
      case "cowrie.client.kex": s.hassh = ev.hassh; break;
      case "cowrie.session.file_download":
      case "cowrie.session.file_download.failed":
        s.files_downloaded.push({ url: ev.url, shasum: ev.shasum, destfile: ev.destfile, success: ev.eventid === "cowrie.session.file_download" }); break;
      case "cowrie.session.file_upload": s.files_uploaded.push({ filename: ev.filename, shasum: ev.shasum }); break;
      case "cowrie.log.closed": s.ttylog = ev.ttylog; break;
    }
  });
  return Object.values(sessionMap).map(s => {
    s.eventTypes = [...s.eventTypes];
    s.attack_type = classifySession(s);
    s.severity = classifySeverity(s);
    return s;
  }).sort((a, b) => (a.start_time || "").localeCompare(b.start_time || ""));
}

function classifySession(s) {
  if (s.files_downloaded.length > 0 || s.commands.some(c => /wget|curl|tftp|scp/i.test(c))) return "Malware Delivery";
  if (s.commands.some(c => /mirai|botnet|busybox/i.test(c))) return "Botnet Propagation";
  if (s.commands.some(c => /mining|xmr|crypto|stratum/i.test(c))) return "Cryptomining";
  if (s.commands.length > 0 && s.login_success) return "Post-Auth Recon";
  if (s.login_success) return "Successful Compromise";
  if (s.login_attempts.length > 3) return "Brute Force";
  if (s.login_attempts.length > 0) return "Credential Probe";
  if (s.eventTypes.includes("cowrie.client.kex") && !s.login_attempts.length) return "SSH Scan";
  if (s.eventTypes.length <= 2 && s.duration < 3) return "Port Scan";
  return "Reconnaissance";
}

function classifySeverity(s) {
  if (s.files_downloaded.length > 0 || s.commands.some(c => /wget|curl|mirai|botnet/i.test(c))) return "critical";
  if (s.login_success && s.commands.length > 0) return "critical";
  if (s.login_success) return "high";
  if (s.login_attempts.length > 3) return "high";
  if (s.login_attempts.length > 0) return "medium";
  return "low";
}

// ═══ CONSTANTS ═══
const SEV_COLORS = { critical: "#ff1744", high: "#ff6d00", medium: "#ffd600", low: "#00e676" };
const COLORS = ["#00ffc8","#00b8ff","#ff1744","#ffd600","#b388ff","#ff6d00","#00e676","#ff80ab","#82b1ff","#69f0ae"];
const countBy = (arr, key) => arr.reduce((acc, item) => { const v = typeof key === "function" ? key(item) : item[key]; acc[v] = (acc[v] || 0) + 1; return acc; }, {});

// ═══ UI COMPONENTS ═══
const Scanlines = () => (
  <div style={{ position:"fixed",top:0,left:0,right:0,bottom:0,pointerEvents:"none",zIndex:9999,background:"repeating-linear-gradient(0deg,rgba(0,255,200,0.015) 0px,rgba(0,255,200,0.015) 1px,transparent 1px,transparent 3px)",mixBlendMode:"overlay"}} />
);

const StatCard = ({ label, value, sub, color = "#00ffc8" }) => (
  <div style={{ background:"linear-gradient(135deg,rgba(0,255,200,0.04) 0%,rgba(0,30,20,0.8) 100%)",border:"1px solid "+color+"22",borderRadius:8,padding:"18px 20px",position:"relative",overflow:"hidden",flex:1,minWidth:160}}>
    <div style={{ position:"absolute",top:0,left:0,width:"100%",height:2,background:"linear-gradient(90deg,transparent,"+color+",transparent)"}} />
    <div style={{ fontSize:11,color:"#5a7a6a",textTransform:"uppercase",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace",marginBottom:6}}>{label}</div>
    <div style={{ fontSize:28,fontWeight:700,color,fontFamily:"'Orbitron',sans-serif",lineHeight:1.1}}>{value}</div>
    {sub && <div style={{ fontSize:10,color:"#3a5a4a",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{sub}</div>}
  </div>
);

const SevBadge = ({ s }) => (
  <span style={{ display:"inline-block",padding:"2px 10px",borderRadius:4,fontSize:10,fontFamily:"'JetBrains Mono',monospace",textTransform:"uppercase",letterSpacing:1,background:SEV_COLORS[s]+"18",color:SEV_COLORS[s],border:"1px solid "+SEV_COLORS[s]+"44"}}>{s}</span>
);

const CTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (<div style={{ background:"rgba(0,12,8,0.95)",border:"1px solid #00ffc833",borderRadius:6,padding:"10px 14px",fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>
    <div style={{ color:"#00ffc8",marginBottom:4}}>{label}</div>
    {payload.map((p,i) => <div key={i} style={{ color:p.color||"#8af0d0"}}>{p.name}: {p.value}</div>)}
  </div>);
};

const Panel = ({ title, children, style = {}, headerRight = null }) => (
  <div style={{ background:"linear-gradient(180deg,rgba(0,255,200,0.02) 0%,rgba(0,10,8,0.6) 100%)",border:"1px solid #00ffc812",borderRadius:10,overflow:"hidden",...style}}>
    <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 18px",borderBottom:"1px solid #00ffc80a",background:"rgba(0,255,200,0.02)"}}>
      <div style={{ fontSize:11,color:"#3a8a6a",textTransform:"uppercase",letterSpacing:2,fontFamily:"'JetBrains Mono',monospace"}}>{title}</div>
      {headerRight}
    </div>
    <div style={{ padding:18}}>{children}</div>
  </div>
);

const Term = ({ children }) => (
  <div style={{ background:"rgba(0,0,0,0.5)",borderRadius:6,padding:"10px 14px",border:"1px solid #00ffc80a",fontFamily:"'JetBrains Mono',monospace",overflowX:"auto"}}>
    {children}
  </div>
);

// ═══ S3 MODAL ═══
const S3Modal = ({ show, onClose, onConnect, config, setConfig, loading }) => {
  if (!show) return null;
  const fields = [
    { key:"bucket", label:"Bucket Name", ph:"providence-honeypot-data" },
    { key:"region", label:"AWS Region", ph:"us-east-1" },
    { key:"prefix", label:"Key Prefix (optional)", ph:"logs/" },
    { key:"accessKeyId", label:"Access Key ID", ph:"AKIA..." },
    { key:"secretAccessKey", label:"Secret Access Key", ph:"secret", secret:true },
  ];
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:"linear-gradient(180deg,#0a1a14 0%,#060e0a 100%)",border:"1px solid #00ffc833",borderRadius:12,padding:32,width:460,maxWidth:"90vw"}}>
        <div style={{ fontSize:14,color:"#00ffc8",fontFamily:"'Orbitron',sans-serif",marginBottom:20}}>S3 BUCKET CONNECTION</div>
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom:14}}>
            <label style={{ display:"block",fontSize:10,color:"#3a8a6a",textTransform:"uppercase",letterSpacing:1.5,fontFamily:"'JetBrains Mono',monospace",marginBottom:4}}>{f.label}</label>
            <input type={f.secret?"password":"text"} value={config[f.key]||""} onChange={e => setConfig(p => ({...p,[f.key]:e.target.value}))} placeholder={f.ph}
              style={{ width:"100%",padding:"10px 14px",background:"rgba(0,255,200,0.04)",border:"1px solid #00ffc822",borderRadius:6,color:"#8af0d0",fontSize:13,fontFamily:"'JetBrains Mono',monospace",outline:"none",boxSizing:"border-box"}} />
          </div>
        ))}
        <div style={{ display:"flex",gap:10,marginTop:20}}>
          <button onClick={onConnect} disabled={loading} style={{ flex:1,padding:"10px 0",background:loading?"rgba(255,214,0,0.08)":"linear-gradient(135deg,#00ffc833,#00ffc811)",border:"1px solid "+(loading?"#ffd60044":"#00ffc844"),borderRadius:6,color:loading?"#ffd600":"#00ffc8",cursor:loading?"wait":"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12,letterSpacing:1}}>
            {loading ? "PULLING..." : "CONNECT & PULL"}
          </button>
          <button onClick={onClose} style={{ flex:1,padding:"10px 0",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff11",borderRadius:6,color:"#5a7a6a",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>CANCEL</button>
        </div>
        <div style={{ fontSize:10,color:"#2a4a3a",fontFamily:"'JetBrains Mono',monospace",marginTop:14,lineHeight:1.6}}>
          Credentials held in browser memory only. SigV4 signed requests direct to S3.
        </div>
      </div>
    </div>
  );
};

// ═══ SESSION DETAIL MODAL ═══
const SessionModal = ({ session: s, onClose }) => {
  if (!s) return null;
  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background:"linear-gradient(180deg,#0a1a14,#060e0a)",border:"1px solid #00ffc833",borderRadius:12,padding:28,width:760,maxWidth:"95vw",maxHeight:"85vh",overflow:"auto"}}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div>
            <div style={{ fontSize:14,color:"#00ffc8",fontFamily:"'Orbitron',sans-serif"}}>SESSION {s.session}</div>
            <div style={{ fontSize:11,color:"#3a5a4a",fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>{s.src_ip} &rarr; {s.dst_ip}:{s.dst_port}</div>
          </div>
          <SevBadge s={s.severity} />
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14,marginBottom:18}}>
          {[["Attack Type",s.attack_type],["Protocol",(s.protocol||"").toUpperCase()],["Duration",s.duration+"s"],
            ["SSH Client",s.ssh_version||"—"],["HASSH",s.hassh?s.hassh.slice(0,16)+"…":"—"],["Sensor",s.sensor],
            ["Start",(s.start_time||"").slice(0,19).replace("T"," ")],["End",(s.end_time||"").slice(0,19).replace("T"," ")],["Raw Events",s.events.length],
          ].map(([l,v]) => (
            <div key={l}><div style={{ fontSize:9,color:"#3a6a5a",textTransform:"uppercase",letterSpacing:1}}>{l}</div>
            <div style={{ fontSize:12,color:"#8af0d0",marginTop:2,wordBreak:"break-all"}}>{v}</div></div>
          ))}
        </div>
        {s.login_attempts.length > 0 && <div style={{ marginBottom:16}}>
          <div style={{ fontSize:10,color:"#3a8a6a",textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>Login Attempts ({s.login_attempts.length})</div>
          <Term>{s.login_attempts.map((a,i) => <div key={i} style={{ fontSize:11,color:a.success?"#00e676":"#ff6d00",marginBottom:2}}>{a.success?"✓":"✗"} {a.username}:{a.password}</div>)}</Term>
        </div>}
        {s.commands.length > 0 && <div style={{ marginBottom:16}}>
          <div style={{ fontSize:10,color:"#3a8a6a",textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>Commands Executed</div>
          <Term>{s.commands.map((cmd,i) => <div key={i} style={{ fontSize:11,color:/wget|curl|mirai|botnet|chmod|mining/i.test(cmd)?"#ff1744":"#00ffc8",marginBottom:2}}><span style={{ color:"#3a5a4a"}}>$ </span>{cmd}</div>)}</Term>
        </div>}
        {s.files_downloaded.length > 0 && <div style={{ marginBottom:16}}>
          <div style={{ fontSize:10,color:"#ff1744",textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>Files Downloaded</div>
          <Term>{s.files_downloaded.map((f,i) => <div key={i} style={{ fontSize:11,color:"#ff6d00",marginBottom:4}}><div>{f.url}</div>{f.shasum && <div style={{ color:"#3a5a4a"}}>SHA256: {f.shasum}</div>}</div>)}</Term>
        </div>}
        <div style={{ marginBottom:16}}>
          <div style={{ fontSize:10,color:"#3a8a6a",textTransform:"uppercase",letterSpacing:1.5,marginBottom:8}}>Event Timeline</div>
          <Term>{s.events.map((ev,i) => <div key={i} style={{ fontSize:10,color:"#5a8a7a",marginBottom:2,display:"flex",gap:8}}>
            <span style={{ color:"#3a5a4a",minWidth:70}}>{(ev.timestamp||"").slice(11,23)}</span>
            <span style={{ color:ev.eventid?.includes("failed")?"#ff6d00":ev.eventid?.includes("success")?"#00e676":ev.eventid?.includes("command")?"#00ffc8":"#5a8a7a"}}>{ev.eventid}</span>
            <span style={{ color:"#2a4a3a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{(ev.message||"").slice(0,80)}</span>
          </div>)}</Term>
        </div>
        <button onClick={onClose} style={{ width:"100%",padding:10,background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff11",borderRadius:6,color:"#5a7a6a",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>CLOSE</button>
      </div>
    </div>
  );
};

// ═══ REPORT MODAL ═══
const ReportModal = ({ show, onClose, selectedSessions, allSessions }) => {
  const [reportType, setReportType] = useState("aws_abuse");
  const [copied, setCopied] = useState(false);
  if (!show) return null;
  const sessions = selectedSessions.length > 0 ? selectedSessions : allSessions;
  const critSessions = sessions.filter(s => s.severity === "critical" || s.severity === "high");
  const uIPs = [...new Set(sessions.map(s => s.src_ip))];

  function genAWS() {
    let r = "AWS Abuse Report - Providence Honeypot Network\nGenerated: " + new Date().toISOString() + "\n";
    r += "─".repeat(55) + "\n\nREPORTING ENTITY: Providence Global Honeypot Network (Cowrie)\n";
    r += "INCIDENT PERIOD: " + (sessions[0]?.start_time||"N/A") + " to " + (sessions[sessions.length-1]?.end_time||"N/A") + "\n";
    r += "TOTAL SESSIONS: " + sessions.length + "\nCRITICAL/HIGH SEVERITY: " + critSessions.length + "\nUNIQUE SOURCE IPs: " + uIPs.length + "\n\n";
    r += "─".repeat(55) + "\nOFFENDING IP ADDRESSES:\n\n";
    uIPs.forEach(ip => {
      const ss = sessions.filter(s => s.src_ip === ip);
      const cmds = ss.flatMap(s => s.commands);
      const creds = ss.flatMap(s => s.login_attempts);
      r += "SOURCE: " + ip + "\n  Sessions: " + ss.length + "\n";
      r += "  Attack Types: " + [...new Set(ss.map(s => s.attack_type))].join(", ") + "\n";
      r += "  Ports Targeted: " + [...new Set(ss.map(s => s.dst_port))].join(", ") + "\n";
      r += "  Max Severity: " + (ss.some(s=>s.severity==="critical")?"CRITICAL":ss.some(s=>s.severity==="high")?"HIGH":"MEDIUM") + "\n";
      r += "  Credentials Tested: " + creds.length + " (" + creds.filter(c=>c.success).length + " successful)\n";
      if (cmds.length > 0) r += "  Commands:\n" + cmds.map(c => "    $ " + c).join("\n") + "\n";
      r += "  SSH Clients: " + ([...new Set(ss.map(s=>s.ssh_version).filter(Boolean))].join(", ")||"N/A") + "\n";
      r += "  HASSH: " + ([...new Set(ss.map(s=>s.hassh).filter(Boolean))].join(", ")||"N/A") + "\n\n";
    });
    r += "─".repeat(55) + "\nGenerated by Providence Threat Intelligence Dashboard.\nAll events captured on honeypot systems with no legitimate user access.";
    return r;
  }

  function genLE() {
    let r = "INCIDENT REPORT - Unauthorized Computer Access\nClassification: Cybercrime / Computer Fraud\nGenerated: " + new Date().toISOString() + "\n";
    r += "─".repeat(55) + "\n\nEXECUTIVE SUMMARY:\n";
    r += "The Providence honeypot network recorded " + sessions.length + " unauthorized sessions from " + uIPs.length + " unique IPs.\n";
    r += critSessions.length + " sessions were critical/high severity.\n\nEVIDENCE COLLECTION:\nAll data collected via Cowrie SSH/Telnet honeypots. Zero legitimate users.\n\nTHREAT ACTORS:\n";
    uIPs.forEach(ip => {
      const ss = sessions.filter(s => s.src_ip === ip);
      const logins = ss.flatMap(s => s.login_attempts);
      const cmds = ss.flatMap(s => s.commands);
      const files = ss.flatMap(s => s.files_downloaded);
      r += "\n  Source IP: " + ip + "\n  Sessions: " + ss.length + "\n";
      r += "  Credential Attempts: " + logins.length + " (" + logins.filter(l=>l.success).length + " successful)\n";
      r += "  Commands Executed: " + cmds.length + "\n  Files Downloaded: " + files.length + "\n";
      r += "  HASSH: " + ([...new Set(ss.map(s=>s.hassh).filter(Boolean))].join(", ")||"N/A") + "\n";
      r += "  Malicious Intent: " + (cmds.length>0||files.length>0?"YES":"Automated scanning") + "\n";
    });
    r += "\nAPPLICABLE STATUTES:\n- Computer Fraud and Abuse Act (18 U.S.C. 1030)\n- Relevant international cybercrime laws per attacker jurisdiction";
    return r;
  }

  function genIOC() {
    return JSON.stringify({
      type:"bundle", id:"bundle--prov-"+Date.now(), spec_version:"2.1", created:new Date().toISOString(),
      objects: uIPs.map(ip => {
        const ss = sessions.filter(s => s.src_ip === ip);
        return {
          type:"indicator", id:"indicator--"+ip.replace(/\./g,"-"), created:new Date().toISOString(),
          name:"Malicious IP: "+ip, pattern:"[ipv4-addr:value = '"+ip+"']", valid_from:ss[0]?.start_time,
          labels:[...new Set(ss.map(s=>s.attack_type))],
          extensions:{"x-providence":{
            sessions:ss.length, hassh:[...new Set(ss.map(s=>s.hassh).filter(Boolean))],
            ssh_versions:[...new Set(ss.map(s=>s.ssh_version).filter(Boolean))],
            commands:[...new Set(ss.flatMap(s=>s.commands))],
            creds_tested:ss.flatMap(s=>s.login_attempts).length,
            sensors:[...new Set(ss.map(s=>s.sensor).filter(Boolean))],
          }}
        };
      })
    }, null, 2);
  }

  const reports = { aws_abuse:{title:"AWS Abuse",fn:genAWS}, law_enforcement:{title:"Law Enforcement",fn:genLE}, ioc_export:{title:"IOC Export",fn:genIOC} };
  const content = reports[reportType].fn();
  const handleCopy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(()=>setCopied(false),2000); };

  return (
    <div style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"linear-gradient(180deg,#0a1a14,#060e0a)",border:"1px solid #00ffc833",borderRadius:12,padding:28,width:720,maxWidth:"95vw",maxHeight:"85vh",display:"flex",flexDirection:"column"}}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{ fontSize:14,color:"#00ffc8",fontFamily:"'Orbitron',sans-serif"}}>GENERATE REPORT</div>
          <div style={{ fontSize:11,color:"#3a5a4a",fontFamily:"'JetBrains Mono',monospace"}}>{selectedSessions.length>0?selectedSessions.length+" selected":"All "+allSessions.length} sessions</div>
        </div>
        <div style={{ display:"flex",gap:8,marginBottom:16}}>
          {Object.entries(reports).map(([key,r]) => (
            <button key={key} onClick={()=>setReportType(key)} style={{ padding:"8px 16px",borderRadius:6,fontSize:11,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",background:reportType===key?"rgba(0,255,200,0.12)":"rgba(255,255,255,0.02)",border:"1px solid "+(reportType===key?"#00ffc844":"#ffffff0a"),color:reportType===key?"#00ffc8":"#5a7a6a"}}>{r.title}</button>
          ))}
        </div>
        <pre style={{ flex:1,overflow:"auto",padding:16,background:"rgba(0,0,0,0.4)",borderRadius:8,border:"1px solid #00ffc80a",color:"#6ab89a",fontSize:11,lineHeight:1.6,fontFamily:"'JetBrains Mono',monospace",whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{content}</pre>
        <div style={{ display:"flex",gap:10,marginTop:16}}>
          <button onClick={handleCopy} style={{ flex:1,padding:10,background:copied?"rgba(0,230,118,0.15)":"linear-gradient(135deg,#00ffc833,#00ffc811)",border:"1px solid "+(copied?"#00e676":"#00ffc844"),borderRadius:6,color:copied?"#00e676":"#00ffc8",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{copied?"COPIED":"COPY TO CLIPBOARD"}</button>
          <button onClick={()=>{const b=new Blob([content],{type:"text/plain"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="providence-"+reportType+"-"+Date.now()+"."+(reportType==="ioc_export"?"json":"txt");a.click();}} style={{ flex:1,padding:10,background:"rgba(0,184,255,0.08)",border:"1px solid #00b8ff33",borderRadius:6,color:"#00b8ff",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>DOWNLOAD</button>
          <button onClick={onClose} style={{ padding:"10px 20px",background:"rgba(255,255,255,0.03)",border:"1px solid #ffffff0a",borderRadius:6,color:"#5a7a6a",cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>CLOSE</button>
        </div>
      </div>
    </div>
  );
};

// ═══ MAIN DASHBOARD ═══
export default function ProvidenceDashboard() {
  const [rawEvents, setRawEvents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [tab, setTab] = useState("overview");
  const [showS3, setShowS3] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [selSession, setSelSession] = useState(null);
  const [s3Cfg, setS3Cfg] = useState({ bucket:"",region:"",prefix:"",accessKeyId:"",secretAccessKey:"" });
  const [selSessions, setSelSessions] = useState([]);
  const [sevFilter, setSevFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [statusLog, setStatusLog] = useState([]);
  const [s3Loading, setS3Loading] = useState(false);
  const [sortCol, setSortCol] = useState("start_time");
  const [sortDir, setSortDir] = useState("desc");
  const fileRef = useRef(null);
  const [clock, setClock] = useState(new Date());

  useEffect(() => { const t = setInterval(()=>setClock(new Date()),1000); return ()=>clearInterval(t); }, []);
  const addLog = useCallback((type, msg) => { setStatusLog(p => [{type,msg,time:Date.now()},...p].slice(0,50)); }, []);

  useEffect(() => { if (rawEvents.length > 0) setSessions(correlateSessions(rawEvents)); }, [rawEvents]);

  const handleUpload = useCallback((e) => {
    Array.from(e.target.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = parseNDJSON(ev.target.result);
          if (parsed.length > 0) { setRawEvents(p => [...p,...parsed]); addLog("success", "Loaded "+parsed.length+" events from "+file.name); }
          else { const arr = JSON.parse(ev.target.result); const ne = Array.isArray(arr)?arr:[arr]; setRawEvents(p=>[...p,...ne]); addLog("success","Loaded "+ne.length+" events from "+file.name); }
        } catch(err) { addLog("error","Failed to parse "+file.name+": "+err.message); }
      };
      reader.readAsText(file);
    });
    e.target.value = "";
  }, [addLog]);

  const handleS3 = useCallback(async () => {
    const { bucket,region,accessKeyId,secretAccessKey,prefix } = s3Cfg;
    if (!bucket||!region||!accessKeyId||!secretAccessKey) { addLog("error","Missing required S3 fields"); return; }
    setS3Loading(true); setShowS3(false);
    addLog("loading","Connecting to s3://"+bucket+"/"+prefix+"...");
    try {
      let allKeys = [], ct = null, pg = 0;
      do {
        pg++; addLog("loading","Listing objects (page "+pg+")...");
        const result = await s3ListObjects(bucket,region,prefix,accessKeyId,secretAccessKey,ct);
        const jsonKeys = result.keys.filter(k => k.endsWith(".json")||k.endsWith(".log")||k.endsWith(".jsonl"));
        allKeys = [...allKeys,...jsonKeys];
        ct = result.isTruncated ? result.nextToken : null;
      } while (ct);
      addLog("success","Found "+allKeys.length+" log files");
      if (allKeys.length === 0) { addLog("error","No .json/.log/.jsonl files found"); setS3Loading(false); return; }
      let total = 0;
      const BATCH = 10;
      for (let i = 0; i < allKeys.length; i += BATCH) {
        const batch = allKeys.slice(i, i+BATCH);
        addLog("loading","Pulling files "+(i+1)+"-"+Math.min(i+BATCH,allKeys.length)+" of "+allKeys.length+"...");
        const results = await Promise.allSettled(batch.map(key => s3GetObject(bucket,region,key,accessKeyId,secretAccessKey)));
        const ne = [];
        results.forEach((r,j) => {
          if (r.status === "fulfilled") {
            const p = parseNDJSON(r.value);
            if (p.length > 0) ne.push(...p);
            else { try { const a = JSON.parse(r.value); ne.push(...(Array.isArray(a)?a:[a])); } catch {} }
          } else addLog("error","Failed: "+batch[j]);
        });
        total += ne.length;
        if (ne.length > 0) setRawEvents(p => [...p,...ne]);
      }
      addLog("success","S3 pull complete. "+total+" events from "+allKeys.length+" files");
    } catch(err) { addLog("error","S3 error: "+err.message); }
    setS3Loading(false);
  }, [s3Cfg, addLog]);

  const filtered = useMemo(() => {
    return sessions
      .filter(s => sevFilter==="all"||s.severity===sevFilter)
      .filter(s => { if (!search) return true; const q=search.toLowerCase(); return [s.src_ip,s.session,s.attack_type,s.protocol,s.ssh_version,s.username,s.sensor,...(s.commands||[])].some(v=>v&&String(v).toLowerCase().includes(q)); })
      .sort((a,b) => { const av=a[sortCol],bv=b[sortCol]; const c=typeof av==="number"?av-bv:String(av||"").localeCompare(String(bv||"")); return sortDir==="asc"?c:-c; });
  }, [sessions,sevFilter,search,sortCol,sortDir]);

  const toggleSort = (c) => { if(sortCol===c) setSortDir(d=>d==="asc"?"desc":"asc"); else { setSortCol(c); setSortDir("desc"); } };

  const stats = useMemo(() => {
    const uIPs = [...new Set(sessions.map(s=>s.src_ip))];
    const uHash = [...new Set(sessions.map(s=>s.hassh).filter(Boolean))];
    const uSens = [...new Set(sessions.map(s=>s.sensor).filter(Boolean))];
    const sevC = countBy(sessions,"severity");
    const atkC = countBy(sessions,"attack_type");
    const allCreds = sessions.flatMap(s=>s.login_attempts);
    const topUser = countBy(allCreds,"username");
    const topPass = countBy(allCreds,"password");
    const sshV = countBy(sessions.filter(s=>s.ssh_version),"ssh_version");
    const succLogins = sessions.filter(s=>s.login_success);
    const hBuckets = {};
    sessions.forEach(s => { const h=(s.start_time||"").slice(0,13); if(h){if(!hBuckets[h])hBuckets[h]={hour:h.slice(11)+":00",d:h.slice(0,10),critical:0,high:0,medium:0,low:0};hBuckets[h][s.severity]++;} });
    const timeline = Object.values(hBuckets).sort((a,b)=>(a.d+a.hour).localeCompare(b.d+b.hour));
    return {
      uIPs,uHash,uSens,sevC,allCreds,succLogins,
      atkData:Object.entries(atkC).map(([n,v])=>({name:n,value:v})).sort((a,b)=>b.value-a.value),
      sevData:Object.entries(sevC).map(([n,v])=>({name:n,value:v})),
      topUserData:Object.entries(topUser).map(([n,v])=>({name:n,value:v})).sort((a,b)=>b.value-a.value).slice(0,15),
      topPassData:Object.entries(topPass).map(([n,v])=>({name:n,value:v})).sort((a,b)=>b.value-a.value).slice(0,15),
      sshVData:Object.entries(sshV).map(([n,v])=>({name:n.replace("SSH-2.0-",""),value:v})).sort((a,b)=>b.value-a.value),
      timeline,
    };
  }, [sessions]);

  const actors = useMemo(() => {
    const m = {};
    sessions.forEach(s => {
      const k = s.src_ip;
      if (!m[k]) m[k] = {ip:k,sessions:[],hashSet:new Set(),verSet:new Set(),atkSet:new Set(),cmds:[],creds:[],files:[]};
      m[k].sessions.push(s); if(s.hassh)m[k].hashSet.add(s.hassh); if(s.ssh_version)m[k].verSet.add(s.ssh_version);
      m[k].atkSet.add(s.attack_type); m[k].cmds.push(...s.commands); m[k].creds.push(...s.login_attempts); m[k].files.push(...s.files_downloaded);
    });
    return Object.values(m).map(a=>({...a,hassh:[...a.hashSet],ssh_versions:[...a.verSet],attacks:[...a.atkSet],
      maxSev:a.sessions.some(s=>s.severity==="critical")?"critical":a.sessions.some(s=>s.severity==="high")?"high":a.sessions.some(s=>s.severity==="medium")?"medium":"low",
      firstSeen:a.sessions[0]?.start_time,lastSeen:a.sessions[a.sessions.length-1]?.end_time,
      totalDur:a.sessions.reduce((sum,s)=>sum+s.duration,0),
    })).sort((a,b)=>b.sessions.length-a.sessions.length);
  }, [sessions]);

  const tabs = [{id:"overview",label:"OVERVIEW"},{id:"sessions",label:"SESSIONS"},{id:"actors",label:"THREAT ACTORS"},{id:"credentials",label:"CREDENTIALS"},{id:"log",label:"INGESTION LOG"}];
  const empty = sessions.length === 0;

  return (
    <div style={{ minHeight:"100vh",background:"radial-gradient(ellipse at 20% 50%,#0a1a14 0%,#050c08 50%,#020504 100%)",color:"#8af0d0",fontFamily:"'JetBrains Mono',monospace"}}>
      <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Orbitron:wght@400;500;700;900&display=swap" rel="stylesheet" />
      <Scanlines />

      {/* HEADER */}
      <div style={{ padding:"16px 28px",borderBottom:"1px solid #00ffc80a",background:"linear-gradient(180deg,rgba(0,255,200,0.03) 0%,transparent 100%)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div style={{ display:"flex",alignItems:"center",gap:14}}>
          <div style={{ width:36,height:36,borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",background:"linear-gradient(135deg,#00ffc822,#00ffc806)",border:"1px solid #00ffc822",fontSize:18}}>&#x26E8;</div>
          <div>
            <div style={{ fontSize:16,fontFamily:"'Orbitron',sans-serif",fontWeight:700,color:"#00ffc8",letterSpacing:3}}>PROVIDENCE</div>
            <div style={{ fontSize:9,color:"#2a5a4a",letterSpacing:2}}>THREAT INTELLIGENCE &bull; COWRIE HONEYPOT</div>
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:12}}>
          <div style={{ fontSize:10,color:"#2a5a4a"}}>
            <span style={{ color:"#5a8a7a"}}>{rawEvents.length} events</span>
            <span style={{ margin:"0 6px",color:"#1a3a2a"}}>|</span>
            <span style={{ color:"#5a8a7a"}}>{sessions.length} sessions</span>
            <span style={{ margin:"0 6px",color:"#1a3a2a"}}>|</span>
            <span style={{ color:"#00ffc8"}}>{clock.toLocaleTimeString()}</span>
          </div>
          <button onClick={()=>fileRef.current?.click()} style={{ padding:"7px 14px",background:"rgba(0,255,200,0.06)",border:"1px solid #00ffc822",borderRadius:6,color:"#00ffc8",cursor:"pointer",fontSize:10,letterSpacing:1,fontFamily:"'JetBrains Mono',monospace"}}>UPLOAD</button>
          <input ref={fileRef} type="file" accept=".json,.jsonl,.log" multiple onChange={handleUpload} style={{ display:"none"}} />
          <button onClick={()=>setShowS3(true)} style={{ padding:"7px 14px",background:"rgba(0,184,255,0.06)",border:"1px solid #00b8ff22",borderRadius:6,color:"#00b8ff",cursor:"pointer",fontSize:10,letterSpacing:1,fontFamily:"'JetBrains Mono',monospace"}}>S3 PULL</button>
          <button onClick={()=>setShowReport(true)} disabled={empty} style={{ padding:"7px 14px",background:"rgba(255,23,68,0.06)",border:"1px solid #ff174422",borderRadius:6,color:empty?"#5a3a3a":"#ff1744",cursor:empty?"not-allowed":"pointer",fontSize:10,letterSpacing:1,fontFamily:"'JetBrains Mono',monospace"}}>REPORT</button>
        </div>
      </div>

      {/* TABS */}
      <div style={{ padding:"0 28px",display:"flex",gap:0,borderBottom:"1px solid #00ffc808",overflowX:"auto"}}>
        {tabs.map(t => <button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"12px 20px",fontSize:11,letterSpacing:1.5,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace",background:"transparent",border:"none",color:tab===t.id?"#00ffc8":"#2a5a4a",borderBottom:tab===t.id?"2px solid #00ffc8":"2px solid transparent",whiteSpace:"nowrap"}}>{t.label}</button>)}
      </div>

      <div style={{ padding:"20px 28px",maxWidth:1400,margin:"0 auto"}}>

      {/* EMPTY STATE */}
      {empty && tab !== "log" && (
        <div style={{ textAlign:"center",padding:"80px 20px"}}>
          <div style={{ fontSize:48,marginBottom:16,opacity:0.3}}>&#x26E8;</div>
          <div style={{ fontSize:16,color:"#3a6a5a",fontFamily:"'Orbitron',sans-serif",marginBottom:8}}>NO DATA LOADED</div>
          <div style={{ fontSize:12,color:"#2a4a3a",marginBottom:24,lineHeight:1.8}}>Upload Cowrie log files or connect to your S3 bucket to begin analysis.</div>
          <div style={{ display:"flex",gap:12,justifyContent:"center"}}>
            <button onClick={()=>fileRef.current?.click()} style={{ padding:"12px 24px",background:"linear-gradient(135deg,#00ffc822,#00ffc808)",border:"1px solid #00ffc833",borderRadius:8,color:"#00ffc8",cursor:"pointer",fontSize:12,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>UPLOAD FILES</button>
            <button onClick={()=>setShowS3(true)} style={{ padding:"12px 24px",background:"linear-gradient(135deg,#00b8ff22,#00b8ff08)",border:"1px solid #00b8ff33",borderRadius:8,color:"#00b8ff",cursor:"pointer",fontSize:12,fontFamily:"'JetBrains Mono',monospace",letterSpacing:1}}>CONNECT S3</button>
          </div>
        </div>
      )}

      {/* OVERVIEW */}
      {tab === "overview" && !empty && (<>
        <div style={{ display:"flex",gap:12,flexWrap:"wrap",marginBottom:18}}>
          <StatCard label="Sessions" value={sessions.length} sub={rawEvents.length+" raw events"} />
          <StatCard label="Unique IPs" value={stats.uIPs.length} color="#00b8ff" />
          <StatCard label="HASSH Fingerprints" value={stats.uHash.length} color="#b388ff" />
          <StatCard label="Compromised" value={stats.succLogins.length} color="#ff1744" sub={stats.allCreds.length+" cred attempts"} />
          <StatCard label="Sensors" value={stats.uSens.length} color="#ffd600" sub={stats.uSens.join(", ")} />
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
          <Panel title="Attack Classification">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={stats.atkData} layout="vertical" margin={{left:120,right:20,top:5,bottom:5}}>
                <XAxis type="number" tick={{fill:"#3a5a4a",fontSize:10}} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{fill:"#6ab89a",fontSize:10}} axisLine={false} width={115} />
                <Tooltip content={<CTooltip />} />
                <Bar dataKey="value" name="Sessions" radius={[0,4,4,0]}>{stats.atkData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]} fillOpacity={0.7} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Severity Distribution">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={stats.sevData} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value" nameKey="name" stroke="none" label={({name,percent})=>name+" "+Math.round(percent*100)+"%"} labelLine={{stroke:"#3a5a4a"}}>
                  {stats.sevData.map(e=><Cell key={e.name} fill={SEV_COLORS[e.name]} fillOpacity={0.8} />)}
                </Pie>
                <Tooltip content={<CTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </Panel>
        </div>
        <Panel title="Session Timeline" style={{marginBottom:14}}>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.timeline} margin={{top:5,right:20,bottom:5,left:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#00ffc808" />
              <XAxis dataKey="hour" tick={{fill:"#3a5a4a",fontSize:10}} axisLine={false} />
              <YAxis tick={{fill:"#3a5a4a",fontSize:10}} axisLine={false} />
              <Tooltip content={<CTooltip />} />
              <Area type="monotone" dataKey="critical" stackId="1" stroke="#ff1744" fill="#ff174433" />
              <Area type="monotone" dataKey="high" stackId="1" stroke="#ff6d00" fill="#ff6d0033" />
              <Area type="monotone" dataKey="medium" stackId="1" stroke="#ffd600" fill="#ffd60033" />
              <Area type="monotone" dataKey="low" stackId="1" stroke="#00e676" fill="#00e67633" />
              <Legend wrapperStyle={{fontSize:10,color:"#3a5a4a"}} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <Panel title="SSH Client Versions">
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stats.sshVData.slice(0,8)} layout="vertical" margin={{left:140,right:20,top:5,bottom:5}}>
                <XAxis type="number" tick={{fill:"#3a5a4a",fontSize:10}} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{fill:"#6ab89a",fontSize:9}} axisLine={false} width={135} />
                <Tooltip content={<CTooltip />} />
                <Bar dataKey="value" name="Sessions" radius={[0,4,4,0]} fill="#b388ff" fillOpacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Top Targeted Ports">
            {(()=>{const pc=countBy(sessions,"dst_port");return Object.entries(pc).map(([p,c])=>({port:p,count:c,pct:c/sessions.length})).sort((a,b)=>b.count-a.count).map((d,i,arr)=>(
              <div key={d.port} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:i<arr.length-1?"1px solid #00ffc808":"none"}}>
                <span style={{padding:"2px 8px",borderRadius:4,background:"rgba(0,184,255,0.08)",color:"#00b8ff",fontSize:12,border:"1px solid #00b8ff22"}}>{d.port}</span>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{width:80,height:6,background:"rgba(0,255,200,0.06)",borderRadius:3,overflow:"hidden"}}><div style={{width:d.pct*100+"%",height:"100%",background:"#00ffc866",borderRadius:3}}/></div>
                  <span style={{color:"#5a8a7a",fontSize:11,minWidth:30,textAlign:"right"}}>{d.count}</span>
                </div>
              </div>
            ));})()}
          </Panel>
        </div>
      </>)}

      {/* SESSIONS */}
      {tab === "sessions" && !empty && (
        <Panel title="Session Log" headerRight={
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="IP, session, command..." style={{padding:"6px 12px",background:"rgba(0,255,200,0.04)",border:"1px solid #00ffc815",borderRadius:5,color:"#8af0d0",fontSize:11,fontFamily:"'JetBrains Mono',monospace",outline:"none",width:180}} />
            <select value={sevFilter} onChange={e=>setSevFilter(e.target.value)} style={{padding:"6px 10px",background:"rgba(0,255,200,0.04)",border:"1px solid #00ffc815",borderRadius:5,color:"#8af0d0",fontSize:11,fontFamily:"'JetBrains Mono',monospace",outline:"none",cursor:"pointer"}}>
              <option value="all" style={{background:"#0a1a14"}}>All Severity</option>
              {["critical","high","medium","low"].map(s=><option key={s} value={s} style={{background:"#0a1a14"}}>{s.toUpperCase()}</option>)}
            </select>
            {selSessions.length > 0 && <button onClick={()=>setShowReport(true)} style={{padding:"6px 12px",background:"rgba(255,23,68,0.08)",border:"1px solid #ff174422",borderRadius:5,color:"#ff1744",fontSize:10,cursor:"pointer",fontFamily:"'JetBrains Mono',monospace"}}>REPORT ({selSessions.length})</button>}
          </div>
        }>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
              <thead><tr style={{borderBottom:"1px solid #00ffc815"}}>
                <th style={{padding:"8px 4px",width:30}}><input type="checkbox" checked={selSessions.length===filtered.length&&filtered.length>0} onChange={e=>setSelSessions(e.target.checked?[...filtered]:[])} style={{accentColor:"#00ffc8"}} /></th>
                {[["start_time","Time"],["src_ip","Source IP"],["dst_port","Port"],["protocol","Proto"],["attack_type","Classification"],["severity","Sev"],["duration","Dur(s)"],["login_attempts","Creds"],["commands","Cmds"],["sensor","Sensor"]].map(([col,lbl])=>(
                  <th key={col} onClick={()=>col!=="login_attempts"&&col!=="commands"&&toggleSort(col)} style={{padding:"8px 6px",textAlign:"left",color:sortCol===col?"#00ffc8":"#3a6a5a",fontWeight:500,cursor:"pointer",whiteSpace:"nowrap",letterSpacing:1,textTransform:"uppercase",fontSize:10}}>
                    {lbl} {sortCol===col?(sortDir==="asc"?"↑":"↓"):""}
                  </th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map((s,i)=>(
                  <tr key={s.session} style={{borderBottom:"1px solid #00ffc808",background:selSessions.includes(s)?"rgba(0,255,200,0.04)":i%2===0?"transparent":"rgba(0,255,200,0.01)",cursor:"pointer"}}>
                    <td style={{padding:"7px 4px"}} onClick={e=>{e.stopPropagation();setSelSessions(p=>p.includes(s)?p.filter(x=>x!==s):[...p,s]);}}>
                      <input type="checkbox" checked={selSessions.includes(s)} onChange={()=>{}} style={{accentColor:"#00ffc8"}} />
                    </td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px",color:"#5a8a7a"}}>{(s.start_time||"").slice(5,19).replace("T"," ")}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px",color:"#00ffc8"}}>{s.src_ip}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px"}}>{s.dst_port}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px"}}>{s.protocol}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px",color:"#b8e0d0"}}>{s.attack_type}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px"}}><SevBadge s={s.severity} /></td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px"}}>{s.duration.toFixed(1)}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px",color:s.login_success?"#00e676":s.login_attempts.length>0?"#ff6d00":"#2a4a3a"}}>{s.login_attempts.length}{s.login_success?" ✓":""}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px",color:s.commands.length>0?"#ff1744":"#2a4a3a"}}>{s.commands.length}</td>
                    <td onClick={()=>setSelSession(s)} style={{padding:"7px 6px",color:"#3a5a4a",fontSize:10}}>{(s.sensor||"").replace("ip-","").replace(/-/g,".")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{marginTop:12,fontSize:10,color:"#2a4a3a"}}>{filtered.length} of {sessions.length} sessions &bull; {selSessions.length} selected &bull; Click row for details</div>
        </Panel>
      )}

      {/* THREAT ACTORS */}
      {tab === "actors" && !empty && (
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          {actors.map(a => (
            <Panel key={a.ip} title={a.ip} headerRight={<div style={{display:"flex",gap:8,alignItems:"center"}}><SevBadge s={a.maxSev} /><span style={{fontSize:10,color:"#3a5a4a"}}>{a.sessions.length} sessions</span></div>}>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:16}}>
                <div>
                  <div style={{fontSize:9,color:"#3a6a5a",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Attack Types</div>
                  {a.attacks.map(at=><div key={at} style={{color:"#b8e0d0",fontSize:11,marginBottom:2}}>{at}</div>)}
                </div>
                <div>
                  <div style={{fontSize:9,color:"#3a6a5a",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>HASSH Fingerprints</div>
                  {a.hassh.length>0?a.hassh.map(h=><div key={h} style={{color:"#b388ff",fontSize:10,marginBottom:2}}>{h}</div>):<div style={{color:"#2a4a3a",fontSize:11}}>None</div>}
                </div>
                <div>
                  <div style={{fontSize:9,color:"#3a6a5a",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>SSH Clients</div>
                  {a.ssh_versions.length>0?a.ssh_versions.map(v=><div key={v} style={{color:"#82b1ff",fontSize:10,marginBottom:2}}>{v}</div>):<div style={{color:"#2a4a3a",fontSize:11}}>N/A</div>}
                </div>
                <div>
                  <div style={{fontSize:9,color:"#3a6a5a",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Intel</div>
                  <div style={{fontSize:11,color:"#6ab89a"}}>Cred Attempts: {a.creds.length}</div>
                  <div style={{fontSize:11,color:a.creds.some(c=>c.success)?"#00e676":"#6ab89a"}}>Successful: {a.creds.filter(c=>c.success).length}</div>
                  <div style={{fontSize:11,color:"#6ab89a"}}>Commands: {a.cmds.length}</div>
                  <div style={{fontSize:11,color:"#6ab89a"}}>Files: {a.files.length}</div>
                  <div style={{fontSize:11,color:"#6ab89a"}}>Active: {a.totalDur.toFixed(1)}s</div>
                  <div style={{fontSize:10,color:"#3a5a4a",marginTop:4}}>First: {(a.firstSeen||"").slice(0,16).replace("T"," ")}</div>
                  <div style={{fontSize:10,color:"#3a5a4a"}}>Last: {(a.lastSeen||"").slice(0,16).replace("T"," ")}</div>
                </div>
              </div>
              {a.cmds.length > 0 && <div style={{marginTop:14}}>
                <div style={{fontSize:9,color:"#3a6a5a",textTransform:"uppercase",letterSpacing:1,marginBottom:6}}>Captured Commands</div>
                <Term>{[...new Set(a.cmds)].map((cmd,j)=><div key={j} style={{fontSize:11,color:/wget|curl|mirai|botnet|chmod|mining|passwd|shadow/i.test(cmd)?"#ff1744":"#00ffc8",marginBottom:2}}><span style={{color:"#3a5a4a"}}>$ </span>{cmd}</div>)}</Term>
              </div>}
            </Panel>
          ))}
        </div>
      )}

      {/* CREDENTIALS */}
      {tab === "credentials" && !empty && (<>
        <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:18}}>
          <StatCard label="Total Attempts" value={stats.allCreds.length} />
          <StatCard label="Unique Usernames" value={stats.topUserData.length} color="#00b8ff" />
          <StatCard label="Unique Passwords" value={stats.topPassData.length} color="#b388ff" />
          <StatCard label="Successful Logins" value={stats.allCreds.filter(c=>c.success).length} color="#ff1744" sub={((stats.allCreds.filter(c=>c.success).length/Math.max(stats.allCreds.length,1))*100).toFixed(1)+"% success rate"} />
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <Panel title="Top Usernames">
            <ResponsiveContainer width="100%" height={Math.max(200,stats.topUserData.length*24)}>
              <BarChart data={stats.topUserData} layout="vertical" margin={{left:90,right:20,top:5,bottom:5}}>
                <XAxis type="number" tick={{fill:"#3a5a4a",fontSize:10}} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{fill:"#6ab89a",fontSize:10}} axisLine={false} width={85} />
                <Tooltip content={<CTooltip />} />
                <Bar dataKey="value" name="Attempts" radius={[0,4,4,0]} fill="#00ffc8" fillOpacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title="Top Passwords">
            <ResponsiveContainer width="100%" height={Math.max(200,stats.topPassData.length*24)}>
              <BarChart data={stats.topPassData} layout="vertical" margin={{left:100,right:20,top:5,bottom:5}}>
                <XAxis type="number" tick={{fill:"#3a5a4a",fontSize:10}} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{fill:"#ff6d00",fontSize:10}} axisLine={false} width={95} />
                <Tooltip content={<CTooltip />} />
                <Bar dataKey="value" name="Attempts" radius={[0,4,4,0]} fill="#ff6d00" fillOpacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        </div>
      </>)}

      {/* LOG */}
      {tab === "log" && (
        <Panel title="Ingestion & Connection Log">
          {statusLog.length === 0
            ? <div style={{color:"#2a4a3a",fontSize:12,padding:20,textAlign:"center"}}>No activity yet. Upload files or connect to S3.</div>
            : <Term>{statusLog.map((e,i)=><div key={i} style={{fontSize:11,marginBottom:4,display:"flex",gap:10}}>
                <span style={{color:"#3a5a4a",minWidth:80}}>{new Date(e.time).toLocaleTimeString()}</span>
                <span style={{color:e.type==="error"?"#ff1744":e.type==="loading"?"#ffd600":"#00e676"}}>{e.type==="error"?"ERR":e.type==="loading"?"...":"OK "}</span>
                <span style={{color:"#6ab89a"}}>{e.msg}</span>
              </div>)}</Term>
          }
        </Panel>
      )}

      </div>
      <S3Modal show={showS3} onClose={()=>setShowS3(false)} onConnect={handleS3} config={s3Cfg} setConfig={setS3Cfg} loading={s3Loading} />
      <ReportModal show={showReport} onClose={()=>setShowReport(false)} selectedSessions={selSessions} allSessions={sessions} />
      <SessionModal session={selSession} onClose={()=>setSelSession(null)} />
    </div>
  );
}