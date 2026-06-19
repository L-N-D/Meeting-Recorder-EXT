var content=(function(){function e(e){return e}var t=`virtual-ext-focus-bubble-host`,n=e({matches:[`http://*/*`,`https://*/*`],runAt:`document_idle`,allFrames:!1,main(){let e=null,n=null,r=null,i=e=>{let t=Math.max(0,Math.floor(e)),n=Math.floor(t/3600),r=Math.floor(t%3600/60),i=t%60,a=e=>String(e).padStart(2,`0`);return n>0?`${a(n)}:${a(r)}:${a(i)}`:`${a(r)}:${a(i)}`};function a(){return n||(e=document.createElement(`div`),e.id=t,e.style.cssText=`all: initial; position: fixed; z-index: 2147483647;`,n=e.attachShadow({mode:`open`}),n.innerHTML=`
        <style>
          :host { all: initial; }
          .bubble {
            position: fixed;
            right: 16px;
            bottom: 16px;
            display: flex;
            align-items: center;
            gap: 10px;
            max-width: 320px;
            padding: 10px 14px;
            border-radius: 12px;
            background: rgba(17, 24, 39, 0.95);
            color: #f9fafb;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            line-height: 1.35;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.08);
            cursor: default;
            user-select: none;
          }
          .bubble.warn { border-color: rgba(245, 158, 11, 0.6); }
          .dot {
            width: 10px; height: 10px; border-radius: 50%;
            background: #ef4444; flex: 0 0 auto;
          }
          .dot.recording { animation: pulse 1.4s ease-in-out infinite; }
          .dot.idle { background: #9ca3af; }
          .dot.paused { background: #f59e0b; animation: none; }
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.35; transform: scale(0.82); }
          }
          .body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
          .title { font-weight: 600; }
          .sub { color: #cbd5e1; font-size: 12px; }
          .kbd {
            display: inline-block;
            padding: 1px 6px;
            border-radius: 5px;
            background: rgba(255,255,255,0.14);
            border: 1px solid rgba(255,255,255,0.18);
            font-weight: 600;
            font-size: 11px;
          }
          .timer { font-variant-numeric: tabular-nums; color: #e5e7eb; }
        </style>
        <div class="bubble" part="bubble">
          <span class="dot"></span>
          <div class="body">
            <span class="title"></span>
            <span class="sub"></span>
          </div>
        </div>
      `,document.documentElement.appendChild(e),n)}function o(){e&&e.parentNode&&e.parentNode.removeChild(e),e=null,n=null}function s(e){if(!e||!e.active){o();return}let t=a(),n=t.querySelector(`.bubble`),r=t.querySelector(`.dot`),s=t.querySelector(`.title`),c=t.querySelector(`.sub`),l=i(e.duration);n.classList.remove(`warn`),r.className=`dot`,e.isCurrent?(r.classList.add(e.paused?`paused`:`recording`),s.textContent=e.paused?`Paused — this tab`:`Recording this tab`,c.innerHTML=`<span class="timer">${l}</span>`):e.armed?(r.classList.add(`idle`),s.textContent=`This tab is ready`,c.innerHTML=`Recording another tab now · <span class="timer">${l}</span>`):e.capturable?(n.classList.add(`warn`),r.classList.add(`idle`),s.textContent=`This tab is NOT being recorded`,c.innerHTML=`Press <span class="kbd">Alt</span>+<span class="kbd">Shift</span>+<span class="kbd">F</span> to record it`):(r.classList.add(`idle`),s.textContent=`This page cannot be recorded`,c.innerHTML=`Only http/https tabs · <span class="timer">${l}</span>`)}async function c(){let e=null;try{e=await chrome.runtime.sendMessage({type:`GET_BUBBLE_STATUS`})}catch{e=null}s(e),l(!!e?.active&&document.visibilityState===`visible`)}function l(e){e&&r===null?r=setInterval(()=>void c(),1e3):!e&&r!==null&&(clearInterval(r),r=null)}chrome.runtime.onMessage.addListener(e=>{e?.type===`BUBBLE_REFRESH`&&c()}),document.addEventListener(`visibilitychange`,()=>void c()),c()}}),r={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},i=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome,a=class e extends Event{static EVENT_NAME=o(`wxt:locationchange`);constructor(t,n){super(e.EVENT_NAME,{}),this.newUrl=t,this.oldUrl=n}};function o(e){return`${i?.runtime?.id}:content:${e}`}var s=typeof globalThis.navigation?.addEventListener==`function`;function c(e){let t,n=!1;return{run(){n||(n=!0,t=new URL(location.href),s?globalThis.navigation.addEventListener(`navigate`,e=>{let n=new URL(e.destination.url);n.href!==t.href&&(window.dispatchEvent(new a(n,t)),t=n)},{signal:e.signal}):e.setInterval(()=>{let e=new URL(location.href);e.href!==t.href&&(window.dispatchEvent(new a(e,t)),t=e)},1e3))}}}var l=class e{static SCRIPT_STARTED_MESSAGE_TYPE=o(`wxt:content-script-started`);id;abortController;locationWatcher=c(this);constructor(e,t){this.contentScriptName=e,this.options=t,this.id=Math.random().toString(36).slice(2),this.abortController=new AbortController,this.stopOldScripts(),this.listenForNewerScripts()}get signal(){return this.abortController.signal}abort(e){return this.abortController.abort(e)}get isInvalid(){return i.runtime?.id??this.notifyInvalidated(),this.signal.aborted}get isValid(){return!this.isInvalid}onInvalidated(e){return this.signal.addEventListener(`abort`,e),()=>this.signal.removeEventListener(`abort`,e)}block(){return new Promise(()=>{})}setInterval(e,t){let n=setInterval(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearInterval(n)),n}setTimeout(e,t){let n=setTimeout(()=>{this.isValid&&e()},t);return this.onInvalidated(()=>clearTimeout(n)),n}requestAnimationFrame(e){let t=requestAnimationFrame((...t)=>{this.isValid&&e(...t)});return this.onInvalidated(()=>cancelAnimationFrame(t)),t}requestIdleCallback(e,t){let n=requestIdleCallback((...t)=>{this.signal.aborted||e(...t)},t);return this.onInvalidated(()=>cancelIdleCallback(n)),n}addEventListener(e,t,n,r){t===`wxt:locationchange`&&this.isValid&&this.locationWatcher.run(),e.addEventListener?.(t.startsWith(`wxt:`)?o(t):t,n,{...r,signal:this.signal})}notifyInvalidated(){this.abort(`Content script context invalidated`),r.debug(`Content script "${this.contentScriptName}" context invalidated`)}stopOldScripts(){document.dispatchEvent(new CustomEvent(e.SCRIPT_STARTED_MESSAGE_TYPE,{detail:{contentScriptName:this.contentScriptName,messageId:this.id}})),this.options?.noScriptStartedPostMessage||window.postMessage({type:e.SCRIPT_STARTED_MESSAGE_TYPE,contentScriptName:this.contentScriptName,messageId:this.id},`*`)}verifyScriptStartedEvent(e){let t=e.detail?.contentScriptName===this.contentScriptName,n=e.detail?.messageId===this.id;return t&&!n}listenForNewerScripts(){let t=e=>{!(e instanceof CustomEvent)||!this.verifyScriptStartedEvent(e)||this.notifyInvalidated()};document.addEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t),this.onInvalidated(()=>document.removeEventListener(e.SCRIPT_STARTED_MESSAGE_TYPE,t))}},u={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)};return(async()=>{try{let{main:e,...t}=n;return await e(new l(`content`,t))}catch(e){throw u.error(`The content script "content" crashed on startup!`,e),e}})()})();
content;