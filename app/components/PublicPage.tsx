/**
 * Layout for the public (non-embedded) marketing + legal pages.
 * Self-contained styles so it renders without Polaris / App Bridge.
 */
import type { ReactNode } from "react";

const CSS = `
  .mp-public { --ink:#1a1a1a; --muted:#5c5f62; --line:#e3e3e3; --brand:#1f2937; --bg:#fbfbfa;
    color:var(--ink); background:var(--bg); font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-height:100vh; margin:0; -webkit-font-smoothing:antialiased; }
  .mp-wrap { max-width:760px; margin:0 auto; padding:64px 24px 96px; }
  .mp-nav { display:flex; align-items:center; justify-content:space-between; max-width:760px; margin:0 auto; padding:20px 24px; }
  .mp-brand { display:flex; align-items:center; gap:10px; font-weight:700; letter-spacing:-.01em; text-decoration:none; color:var(--ink); }
  .mp-logo { width:28px; height:28px; border-radius:8px; background:linear-gradient(135deg,#111827,#374151); display:grid; place-items:center; color:#fff; font-size:14px; font-weight:800; }
  .mp-nav a.mp-link { color:var(--muted); text-decoration:none; margin-left:20px; font-size:14px; }
  .mp-nav a.mp-link:hover { color:var(--ink); }
  .mp-public h1 { font-size:2.1rem; line-height:1.2; letter-spacing:-.02em; margin:0 0 12px; }
  .mp-public h2 { font-size:1.15rem; letter-spacing:-.01em; margin:38px 0 10px; }
  .mp-public h3 { font-size:1rem; margin:24px 0 6px; }
  .mp-public p, .mp-public li { color:var(--ink); }
  .mp-public .lede { font-size:1.15rem; color:var(--muted); margin:0 0 28px; }
  .mp-public a { color:#1f6feb; }
  .mp-public code { background:#f0f0ef; padding:2px 6px; border-radius:5px; font-size:.9em; }
  .mp-public pre { background:#f6f6f5; border:1px solid var(--line); border-radius:10px; padding:16px; overflow:auto; font-size:13px; line-height:1.6; }
  .mp-card { border:1px solid var(--line); border-radius:14px; padding:22px 24px; background:#fff; margin:14px 0; }
  .mp-grid { display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); margin:22px 0; }
  .mp-cta { display:inline-block; background:var(--brand); color:#fff; text-decoration:none; padding:11px 20px; border-radius:10px; font-weight:600; font-size:15px; margin-top:8px; }
  .mp-foot { border-top:1px solid var(--line); margin-top:56px; padding-top:22px; color:var(--muted); font-size:13.5px; display:flex; gap:18px; flex-wrap:wrap; }
  .mp-foot a { color:var(--muted); text-decoration:none; }
  .mp-foot a:hover { color:var(--ink); }
  .mp-muted { color:var(--muted); }
`;

export function PublicPage({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="mp-public">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <nav className="mp-nav">
        <a className="mp-brand" href="/">
          <span className="mp-logo">M</span> MarginPilot
        </a>
        <div>
          <a className="mp-link" href="/#features">
            Features
          </a>
          <a className="mp-link" href="/support">
            Support
          </a>
          <a className="mp-link" href="/privacy">
            Privacy
          </a>
        </div>
      </nav>
      <main className="mp-wrap">
        {title ? <h1>{title}</h1> : null}
        {children}
        <div className="mp-foot">
          <span className="mp-muted">© {new Date().getFullYear()} MarginPilot</span>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="/support">Support</a>
        </div>
      </main>
    </div>
  );
}
