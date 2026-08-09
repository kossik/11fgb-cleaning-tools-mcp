const styles = `
  :host{display:block;color:#152238;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  *{box-sizing:border-box}.card{overflow:hidden;border:1px solid #dce3ee;border-radius:22px;background:#fff;box-shadow:0 12px 35px rgba(28,48,78,.08)}
  .hero{padding:22px;background:linear-gradient(135deg,#0e64f4,#1848bd);color:#fff}.eyebrow{font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;opacity:.8}.hero h2{margin:6px 0 0;font-size:25px;line-height:1.15}
  .metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(135px,1fr));gap:1px;background:#e7ecf4;border-bottom:1px solid #e7ecf4}.metric{padding:14px 16px;background:#fff}.metric span{display:block;color:#64748b;font-size:12px}.metric strong{display:block;margin-top:5px;font-size:19px}
  .content{display:grid;gap:20px;padding:20px}.bars{display:grid;gap:12px}.bar-head{display:flex;justify-content:space-between;gap:12px;font-size:13px}.track{height:10px;overflow:hidden;border-radius:999px;background:#edf1f7}.fill{height:100%;min-width:5px;border-radius:inherit;background:#0e64f4}.fill.green{background:#14a371}.fill.orange{background:#f39226}.fill.purple{background:#8065e8}
  .notes{display:grid;gap:8px;margin:0;padding-left:20px;color:#536177;font-size:13px}.warning{padding:11px 13px;border-radius:12px;background:#fff6e8;color:#7c4b08;font-size:13px}.actions{display:flex;flex-wrap:wrap;gap:10px}.action{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 15px;border-radius:999px;text-decoration:none;font:800 13px inherit;cursor:pointer}.primary{border:0;background:#0e64f4;color:#fff}.secondary{border:1px solid #ced7e5;color:#214066;background:#fff}.source{font-size:11px;color:#7b8799}
  @media(max-width:500px){.hero{padding:18px}.hero h2{font-size:21px}.content{padding:16px}.metrics{grid-template-columns:1fr 1fr}}
`;

class CleaningCalculationResult extends HTMLElement {
  constructor(){super();this.attachShadow({mode:"open"});this._result=null;}
  set result(value){this._result=value;this.render();}
  get result(){return this._result;}
  connectedCallback(){this.render();}
  esc(value){return String(value ?? "").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));}
  render(){
    const result=this._result;
    if(!result){this.shadowRoot.innerHTML=`<style>${styles}</style>`;return;}
    const max=Math.max(1,...(result.visualization?.items||[]).map(item=>Number(item.value)||0));
    const metrics=(result.metrics||[]).map(item=>`<div class="metric"><span>${this.esc(item.label)}</span><strong>${this.esc(item.value)}${item.unit?` <small>${this.esc(item.unit)}</small>`:""}</strong></div>`).join("");
    const bars=(result.visualization?.items||[]).map(item=>`<div><div class="bar-head"><strong>${this.esc(item.label)}</strong><span>${this.esc(item.value)} ${this.esc(item.unit)}</span></div><div class="track"><div class="fill ${this.esc(item.tone||"")}" style="width:${Math.max(5,Math.round((Number(item.value)||0)/max*100))}%"></div></div></div>`).join("");
    const notes=(result.assumptions||[]).map(item=>`<li>${this.esc(item)}</li>`).join("");
    const warnings=(result.warnings||[]).map(item=>`<div class="warning">${this.esc(item)}</div>`).join("");
    this.shadowRoot.innerHTML=`<style>${styles}</style><article class="card"><header class="hero"><div class="eyebrow">11FGB Cleaning Tools</div><h2>${this.esc(result.headline)}</h2></header><section class="metrics">${metrics}</section><div class="content"><div class="bars">${bars}</div><ul class="notes">${notes}</ul>${warnings}<div class="actions">${result.cta_url?`<a class="action primary" data-event="cta" href="${this.esc(result.cta_url)}" target="_blank" rel="noopener">Check service options</a>`:""}<a class="action secondary" href="${this.esc(result.visualization_url)}" target="_blank" rel="noopener">Open report</a><button class="action secondary" data-action="share" type="button">Share</button><button class="action secondary" data-action="download" type="button">Download JSON</button><a class="action secondary" href="${this.esc(result.methodology_url)}" target="_blank" rel="noopener">Methodology</a></div><div class="source">${this.esc(result.location?.market_label)} · methodology ${this.esc(result.methodology_version)} · expires ${this.esc(result.expires_at?.slice(0,10))}</div></div></article>`;
    const eventPayload=(action)=>JSON.stringify({action,calculator:result.calculator,confidence:result.location?.confidence});
    const emit=(action)=>{try{navigator.sendBeacon("https://mcp.11fgb.com/api/v1/events",new Blob([eventPayload(action)],{type:"application/json"}));}catch{}};
    this.shadowRoot.querySelector('[data-event="cta"]')?.addEventListener("click",()=>emit("cta"));
    this.shadowRoot.querySelector('[data-action="share"]')?.addEventListener("click",async()=>{const data={title:"11FGB cleaning calculation",url:result.visualization_url};try{if(navigator.share)await navigator.share(data);else await navigator.clipboard.writeText(data.url);emit("share");}catch{}});
    this.shadowRoot.querySelector('[data-action="download"]')?.addEventListener("click",()=>{const blob=new Blob([JSON.stringify(result,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download=`11fgb-${result.calculator}-estimate.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);emit("download");});
  }
}
customElements.define("cleaning-calculation-result",CleaningCalculationResult);
