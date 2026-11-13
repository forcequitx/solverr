const STYLE_ID = "solverr-embed-styles";

/** Overlay stylesheet, shared with `solverr-react`; `all: initial` keeps the host page's CSS from changing the overlay. */
export const OVERLAY_CSS = `
.solverr-overlay{all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:16px;background:rgba(10,10,10,.6)}
.solverr-overlay::backdrop{background:transparent}
.solverr-overlay[data-state=closing]{pointer-events:none}
.solverr-panel{all:initial;box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:480px;height:100%;max-height:760px;overflow:hidden;background:#FFFFFF;border:1px solid #EBEBEB;border-radius:22px;box-shadow:0 24px 64px rgba(10,10,10,.32)}
.solverr-bar{all:initial;box-sizing:border-box;display:flex;flex:none;align-items:center;justify-content:flex-end;height:48px;padding:0 6px;border-bottom:1px solid #EBEBEB}
.solverr-close{all:initial;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;color:#6b6b6b;cursor:pointer}
.solverr-close:hover{background:#F7F7F7;color:#0A0A0A}
.solverr-close:focus-visible{outline:2px solid #155DFC;outline-offset:2px}
.solverr-close svg{display:block;width:20px;height:20px}
.solverr-frame{all:initial;display:block;flex:1 1 auto;width:100%;min-height:0;border:0}
@media (max-width:640px){.solverr-overlay{padding:0}.solverr-panel{max-width:none;max-height:none;border:0;border-radius:0}}
@media (prefers-color-scheme:dark){.solverr-panel{background:#0A0A0A;border-color:#262626}.solverr-bar{border-bottom-color:#262626}.solverr-close{color:#A1A1A1}.solverr-close:hover{background:#1C1C1C;color:#FAFAFA}}
`;

/** Adds the overlay stylesheet to the page once. */
export function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = OVERLAY_CSS;
  document.head.append(style);
}
