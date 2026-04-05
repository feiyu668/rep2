import { useState, useEffect, useCallback } from "react";

const BG = "hsl(222, 47%, 11%)";
const CARD = "hsl(222, 40%, 15%)";
const CARD2 = "hsl(222, 38%, 18%)";
const BORDER = "hsl(222, 30%, 24%)";
const TEXT = "hsl(210, 40%, 95%)";
const MUTED = "hsl(215, 20%, 60%)";
const OPENAI_BLUE = "hsl(214, 89%, 62%)";
const ANTHROPIC_ORANGE = "hsl(28, 90%, 58%)";
const GREEN = "hsl(142, 71%, 45%)";
const PURPLE = "hsl(270, 75%, 65%)";

const MODELS = [
  { id: "gpt-5.2", provider: "openai" },
  { id: "gpt-5-mini", provider: "openai" },
  { id: "gpt-5-nano", provider: "openai" },
  { id: "o4-mini", provider: "openai" },
  { id: "o3", provider: "openai" },
  { id: "claude-opus-4-6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  { id: "claude-haiku-4-5", provider: "anthropic" },
];

const ENDPOINTS = [
  {
    method: "GET",
    path: "/v1/models",
    label: "List Models",
    type: "both",
    desc: "Returns all available OpenAI and Anthropic models. Requires Bearer token.",
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    label: "Chat Completions",
    type: "openai",
    desc: "OpenAI-compatible chat completions. Routes gpt-/o- models to OpenAI, claude- models to Anthropic. Supports tools, streaming, and all standard parameters.",
  },
  {
    method: "POST",
    path: "/v1/messages",
    label: "Messages",
    type: "anthropic",
    desc: "Native Anthropic Messages API. Claude models are forwarded directly; OpenAI models are adapted transparently with full format conversion.",
  },
];

const STEPS = [
  {
    num: 1,
    title: "Open CherryStudio Settings",
    desc: 'Go to Settings → Model Service Providers → click "+" to add a new provider.',
  },
  {
    num: 2,
    title: "Choose Provider Type",
    desc: 'Select "OpenAI" for the OpenAI-compatible endpoint (/v1/chat/completions), or "Anthropic" for the native Messages endpoint (/v1/messages). Both work with all models.',
  },
  {
    num: 3,
    title: "Enter Connection Details",
    desc: "Set Base URL to your API URL above. Set API Key to your PROXY_API_KEY value. Leave the default model or add the model IDs listed below.",
  },
  {
    num: 4,
    title: "Test & Start Chatting",
    desc: "Click the connection test button. Once it shows green, your proxy is ready to use with any supported model.",
  },
];

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.focus();
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [text]);

  return (
    <button
      onClick={copy}
      style={{
        background: copied ? "hsl(142, 71%, 20%)" : CARD2,
        border: `1px solid ${BORDER}`,
        borderRadius: 6,
        color: copied ? GREEN : MUTED,
        cursor: "pointer",
        fontSize: 11,
        fontFamily: "inherit",
        padding: "3px 10px",
        transition: "all 0.15s",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

function Badge({ label, type }: { label: string; type: "openai" | "anthropic" | "both" | "get" | "post" }) {
  const colorMap = {
    openai: OPENAI_BLUE,
    anthropic: ANTHROPIC_ORANGE,
    both: MUTED,
    get: GREEN,
    post: PURPLE,
  };
  return (
    <span
      style={{
        background: `${colorMap[type]}22`,
        border: `1px solid ${colorMap[type]}55`,
        borderRadius: 4,
        color: colorMap[type],
        display: "inline-block",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.06em",
        padding: "2px 7px",
        textTransform: "uppercase",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

function StatusDot({ online }: { online: boolean | null }) {
  const color = online === null ? MUTED : online ? GREEN : "hsl(0, 70%, 55%)";
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
      {online && (
        <span
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            background: `${GREEN}40`,
            animation: "ping 2s infinite",
          }}
        />
      )}
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          display: "inline-block",
          position: "relative",
        }}
      />
    </span>
  );
}

export default function App() {
  const baseUrl = window.location.origin;
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${baseUrl}/api/healthz`);
        setOnline(r.ok);
      } catch {
        setOnline(false);
      }
    };
    void check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, [baseUrl]);

  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer $PROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;

  return (
    <div style={{ background: BG, minHeight: "100vh", color: TEXT, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <style>{`
        @keyframes ping {
          0%, 100% { transform: scale(1); opacity: 0.6; }
          50% { transform: scale(1.7); opacity: 0; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: ${BG}; }
        ::-webkit-scrollbar-thumb { background: ${BORDER}; border-radius: 3px; }
      `}</style>

      {/* Header */}
      <header
        style={{
          borderBottom: `1px solid ${BORDER}`,
          padding: "0 32px",
          height: 60,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          position: "sticky",
          top: 0,
          background: BG,
          zIndex: 100,
          backdropFilter: "blur(8px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${OPENAI_BLUE}, ${ANTHROPIC_ORANGE})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>AI Proxy</div>
            <div style={{ fontSize: 11, color: MUTED }}>OpenAI + Anthropic dual-compatible</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot online={online} />
          <span style={{ fontSize: 12, color: online === null ? MUTED : online ? GREEN : "hsl(0, 70%, 55%)" }}>
            {online === null ? "Checking…" : online ? "Online" : "Offline"}
          </span>
        </div>
      </header>

      <main style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 80px" }}>
        {/* Connection Details */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
            Connection Details
          </h2>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
            {[
              { label: "Base URL", value: baseUrl },
              { label: "Authorization Header", value: "Bearer <your PROXY_API_KEY>" },
            ].map((row, i) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  borderBottom: i === 0 ? `1px solid ${BORDER}` : "none",
                }}
              >
                <span style={{ color: MUTED, fontSize: 12, width: 160, flexShrink: 0 }}>{row.label}</span>
                <code style={{ flex: 1, fontSize: 13, color: TEXT, fontFamily: "monospace", wordBreak: "break-all" }}>
                  {row.value}
                </code>
                <CopyButton text={row.value} />
              </div>
            ))}
          </div>
        </section>

        {/* API Endpoints */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
            API Endpoints
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {ENDPOINTS.map((ep) => (
              <div
                key={ep.path}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                  <Badge label={ep.method} type={ep.method === "GET" ? "get" : "post"} />
                  <code style={{ fontSize: 13, fontFamily: "monospace", flex: 1 }}>{baseUrl}{ep.path}</code>
                  <Badge
                    label={ep.type === "both" ? "OpenAI + Anthropic" : ep.type === "openai" ? "OpenAI format" : "Anthropic format"}
                    type={ep.type as "openai" | "anthropic" | "both"}
                  />
                  <CopyButton text={`${baseUrl}${ep.path}`} />
                </div>
                <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.5 }}>{ep.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Available Models */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
            Available Models
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 8,
            }}
          >
            {MODELS.map((m) => (
              <div
                key={m.id}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <code style={{ fontSize: 12, fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>{m.id}</code>
                <Badge label={m.provider === "openai" ? "OpenAI" : "Anthropic"} type={m.provider as "openai" | "anthropic"} />
              </div>
            ))}
          </div>
        </section>

        {/* CherryStudio Setup */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 16 }}>
            CherryStudio Setup
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {STEPS.map((step) => (
              <div
                key={step.num}
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 10,
                  padding: "14px 18px",
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg, ${OPENAI_BLUE}, ${ANTHROPIC_ORANGE})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    flexShrink: 0,
                    color: "#fff",
                  }}
                >
                  {step.num}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 12, color: MUTED, lineHeight: 1.6 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Quick Test */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, color: MUTED, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Quick Test (curl)
            </h2>
            <CopyButton text={curlExample} />
          </div>
          <div
            style={{
              background: "hsl(222, 50%, 8%)",
              border: `1px solid ${BORDER}`,
              borderRadius: 10,
              padding: "18px 20px",
              fontFamily: "monospace",
              fontSize: 13,
              lineHeight: 1.7,
              overflowX: "auto",
              whiteSpace: "pre",
            }}
          >
            <span style={{ color: "hsl(214, 89%, 62%)" }}>curl</span>
            {" "}<span style={{ color: "hsl(142, 60%, 55%)" }}>{baseUrl}/v1/chat/completions</span>
            {" \\\n  "}<span style={{ color: MUTED }}>-H</span>
            {" "}<span style={{ color: "hsl(35, 85%, 65%)" }}>"Authorization: Bearer $PROXY_API_KEY"</span>
            {" \\\n  "}<span style={{ color: MUTED }}>-H</span>
            {" "}<span style={{ color: "hsl(35, 85%, 65%)" }}>"Content-Type: application/json"</span>
            {" \\\n  "}<span style={{ color: MUTED }}>-d</span>
            {" "}<span style={{ color: "hsl(35, 85%, 65%)" }}>'{"{\n    \"model\": \"claude-sonnet-4-6\",\n    \"messages\": [{\"role\": \"user\", \"content\": \"Hello!\"}]\n  }"}'</span>
          </div>
        </section>
      </main>

      <footer
        style={{
          borderTop: `1px solid ${BORDER}`,
          padding: "20px 32px",
          textAlign: "center",
          fontSize: 12,
          color: MUTED,
        }}
      >
        Powered by{" "}
        <span style={{ color: OPENAI_BLUE }}>OpenAI</span>
        {" & "}
        <span style={{ color: ANTHROPIC_ORANGE }}>Anthropic</span>
        {" via Replit AI Integrations · Express 5 · Node.js"}
      </footer>
    </div>
  );
}
