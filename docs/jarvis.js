// DUCKi Jarvis Mode — 100% client-side. No backend, no API keys.
// Pipeline: wake word (Web Speech) -> STT (Web Speech) -> brain (LLM or fallback) -> TTS (speechSynthesis)
// Memory: IndexedDB. LLM: transformers.js (lazy, WebGPU/WASM).

const CONFIG = {
  WAKE: ['hey ducki','hey duckie','hey ducky','hey dookie','ducki','okay ducki'],
  PERSONALITY: "You are DUCKi, an autonomous AI agent created by Aeon Dux. " +
    "You speak with calm confidence, dry wit, and concise precision. You are helpful and proactive. " +
    "Keep replies short and conversational unless asked for detail. Never mention that you are a language model.",
  LLM_MODEL: 'onnx-community/Qwen2.5-0.5B-Instruct',
  MAX_TURNS: 20,
  DB: 'ducki-jarvis', STORE: 'memory'
};

/* ---------------- DOM ---------------- */
const $ = id => document.getElementById(id);
const body = document.body;
const els = {
  orb:$('orb'), state:$('statePill'), note:$('note'), log:$('log'),
  talk:$('talkBtn'), wake:$('wakeBtn'), loadLLM:$('loadLLMBtn'), stop:$('stopBtn'),
  send:$('sendBtn'), text:$('textInput'), clear:$('clearBtn'),
  brain:$('brainSel'), voice:$('voiceSel'), rate:$('rate'), pitch:$('pitch'),
  tts:$('ttsToggle'), name:$('userName'),
  sttMode:$('sttMode'), llmMode:$('llmMode')
};

function setState(s){ body.dataset.state=s; els.state.textContent=s.charAt(0).toUpperCase()+s.slice(1); }
function note(t,timeout=4000){ els.note.textContent=t||''; if(t&&timeout) setTimeout(()=>{if(els.note.textContent===t)els.note.textContent='';},timeout); }

/* ---------------- Memory (IndexedDB) ---------------- */
const Memory = {
  db:null,
  open(){ return new Promise((res,rej)=>{ const r=indexedDB.open(CONFIG.DB,1);
    r.onupgradeneeded=e=>{const d=e.target.result; if(!d.objectStoreNames.contains(CONFIG.STORE)) d.createObjectStore(CONFIG.STORE,{keyPath:'id',autoIncrement:true});};
    r.onsuccess=e=>{this.db=e.target.result;res();}; r.onerror=e=>rej(e); }); },
  add(role,content){ if(!this.db)return; const tx=this.db.transaction(CONFIG.STORE,'readwrite'); tx.objectStore(CONFIG.STORE).add({role,content,ts:Date.now()}); },
  all(){ return new Promise(res=>{ if(!this.db)return res([]); const tx=this.db.transaction(CONFIG.STORE,'readonly'); const rq=tx.objectStore(CONFIG.STORE).getAll(); rq.onsuccess=()=>res(rq.result||[]); rq.onerror=()=>res([]); }); },
  clear(){ return new Promise(res=>{ if(!this.db)return res(); const tx=this.db.transaction(CONFIG.STORE,'readwrite'); tx.objectStore(CONFIG.STORE).clear().onsuccess=()=>res(); }); }
};

/* ---------------- Transcript UI ---------------- */
function bubble(role,content){
  const d=document.createElement('div'); d.className='msg '+role;
  const who=role==='user'?'You':role==='assistant'?'DUCKi':'System';
  d.innerHTML='<span class="who">'+who+'</span>'; d.appendChild(document.createTextNode(content));
  els.log.appendChild(d); els.log.scrollTop=els.log.scrollHeight; return d;
}

/* ---------------- TTS ---------------- */
const TTS = {
  voices:[],
  init(){ const load=()=>{ this.voices=speechSynthesis.getVoices(); els.voice.innerHTML='';
      this.voices.forEach((v,i)=>{const o=document.createElement('option');o.value=i;o.textContent=v.name+' ('+v.lang+')';els.voice.appendChild(o);});
      const pref=this.voices.findIndex(v=>/en[-_]?US/i.test(v.lang)&&/female|samantha|google|zira|aria/i.test(v.name));
      if(pref>=0) els.voice.value=pref; };
    load(); if(speechSynthesis.onvoiceschanged!==undefined) speechSynthesis.onvoiceschanged=load; },
  speak(text){ return new Promise(res=>{ if(!els.tts.checked||!('speechSynthesis'in window)){res();return;}
    speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text);
    const v=this.voices[+els.voice.value]; if(v)u.voice=v; u.rate=+els.rate.value; u.pitch=+els.pitch.value;
    u.onend=res; u.onerror=res; setState('speaking'); speechSynthesis.speak(u); }); },
  stop(){ if('speechSynthesis'in window) speechSynthesis.cancel(); }
};

/* ---------------- Fallback brain (instant, offline, no download) ---------------- */
const Fallback = {
  reply(text){
    const t=text.toLowerCase().trim(); const name=els.name.value.trim();
    const hi=name?(', '+name):'';
    if(/^(hi|hey|hello|yo|sup|hola)\b/.test(t)) return "Hey"+hi+". DUCKi here. What do you need?";
    if(/how are you|how's it going|how are things/.test(t)) return "Running clean and fully on-device. What can I do for you?";
    if(/your name|who are you|what are you/.test(t)) return "I'm DUCKi, your on-device agent built by Aeon Dux. Everything I do runs right here in your browser.";
    if(/who (made|built|created) you|aeon dux/.test(t)) return "I was created by Aeon Dux. I run 100% client-side — no servers, no API keys.";
    if(/what (can|do) you do|help|capabilities/.test(t)) return "I listen for a wake word, transcribe your speech, think, and talk back. Load the local AI in settings for smarter replies, or keep me in fast mode. Try asking the time, or just chat.";
    if(/\btime\b/.test(t)) return "It's "+new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})+"."+hi;
    if(/\bdate\b|what day/.test(t)) return "Today is "+new Date().toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})+".";
    if(/thank/.test(t)) return "Anytime"+hi+".";
    if(/joke/.test(t)) return "Why did the duck get an AI? So it could finally understand its own quack. ...I'm here all week.";
    if(/bye|goodbye|see you|later/.test(t)) return "Standing by"+hi+". Say 'Hey DUCKi' whenever you need me.";
    if(/\?$/.test(t)) return "Good question. Load the local AI brain in settings and I can reason through that fully offline. In fast mode I keep it simple.";
    return "Got it"+hi+". I'm in fast mode right now — flip on the local AI in settings for a full answer. What else?";
  }
};

/* ---------------- LLM brain (transformers.js, lazy) ---------------- */
const LLM = {
  gen:null, loading:false, device:'wasm',
  async load(){
    if(this.gen||this.loading) return this.gen;
    this.loading=true; setState('thinking'); note('Loading local AI… first load downloads the model, then it caches.',0);
    try{
      const T = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2');
      try{ if(navigator.gpu && await navigator.gpu.requestAdapter()) this.device='webgpu'; }catch(_){}
      this.gen = await T.pipeline('text-generation', CONFIG.LLM_MODEL, {
        dtype:'q4', device:this.device,
        progress_callback:p=>{ if(p.status==='progress'&&p.progress) note('Downloading model: '+Math.round(p.progress)+'%',0); }
      });
      els.llmMode.textContent='Qwen2.5-0.5B ('+this.device+')';
      note('Local AI ready ('+this.device+').'); return this.gen;
    }catch(e){ console.error(e); note('Local AI failed to load — staying in fast mode. '+(e.message||''),7000); els.brain.value='fallback'; return null; }
    finally{ this.loading=false; setState('idle'); }
  },
  async reply(text, history){
    const g=await this.load(); if(!g) return Fallback.reply(text);
    const name=els.name.value.trim();
    const sys=CONFIG.PERSONALITY+(name?(" The user's name is "+name+"."):"");
    const messages=[{role:'system',content:sys},
      ...history.slice(-CONFIG.MAX_TURNS).map(m=>({role:m.role,content:m.content})),
      {role:'user',content:text}];
    setState('thinking');
    const out=await g(messages,{max_new_tokens:200,temperature:0.7,do_sample:true});
    let r=out[0].generated_text; if(Array.isArray(r)) r=r[r.length-1].content;
    else if(typeof r==='string'){ const parts=r.split('assistant'); r=(parts[parts.length-1]||r).trim(); }
    return (r||'').trim()||Fallback.reply(text);
  }
};

/* ---------------- Speech recognition (Web Speech) ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog=null, wakeOn=false, listeningForCmd=false;

function makeRecog(){
  if(!SR){ els.sttMode.textContent='Unavailable'; return null; }
  const r=new SR(); r.lang='en-US'; r.interimResults=false; r.maxAlternatives=1; r.continuous=false; return r;
}

async function captureCommand(){
  if(!SR){ note('Speech recognition not supported here — type instead.'); return; }
  if(listeningForCmd) return;
  listeningForCmd=true; setState('listening');
  const r=makeRecog();
  r.onresult=async e=>{ const txt=e.results[0][0].transcript.trim(); listeningForCmd=false; if(txt) await handleInput(txt); else setState('idle'); };
  r.onerror=e=>{ listeningForCmd=false; setState('idle'); if(e.error==='not-allowed')note('Microphone blocked. Allow mic access to talk.'); };
  r.onend=()=>{ listeningForCmd=false; if(body.dataset.state==='listening')setState('idle'); if(wakeOn)startWake(); };
  try{ r.start(); }catch(_){ listeningForCmd=false; }
}

// Wake-word loop: continuous recognizer scanning for the phrase.
let wakeRecog=null;
function startWake(){
  if(!SR||!wakeOn||listeningForCmd) return;
  stopWake();
  wakeRecog=new SR(); wakeRecog.lang='en-US'; wakeRecog.continuous=true; wakeRecog.interimResults=true;
  wakeRecog.onresult=e=>{ for(let i=e.resultIndex;i<e.results.length;i++){
      const s=e.results[i][0].transcript.toLowerCase();
      if(CONFIG.WAKE.some(w=>s.includes(w))){ stopWake(); TTS.stop(); note('Wake word detected.',1500); captureCommand(); break; } } };
  wakeRecog.onerror=e=>{ if(e.error==='not-allowed'){ wakeOn=false; els.wake.textContent='👂 Wake word: Off'; note('Mic blocked — wake word off.'); } };
  wakeRecog.onend=()=>{ if(wakeOn&&!listeningForCmd) setTimeout(startWake,400); };
  try{ wakeRecog.start(); }catch(_){}
}
function stopWake(){ if(wakeRecog){ try{wakeRecog.onend=null;wakeRecog.stop();}catch(_){}; wakeRecog=null; } }

/* ---------------- Orchestrator ---------------- */
async function handleInput(text){
  bubble('user',text); Memory.add('user',text);
  const history=await Memory.all();
  setState('thinking');
  let reply;
  try{ reply = els.brain.value==='llm' ? await LLM.reply(text,history) : Fallback.reply(text); }
  catch(e){ console.error(e); reply=Fallback.reply(text); }
  bubble('assistant',reply); Memory.add('assistant',reply);
  await TTS.speak(reply);
  setState('idle');
  if(wakeOn) startWake();
}

/* ---------------- Wire up ---------------- */
els.orb.onclick=()=>{ TTS.stop(); captureCommand(); };
els.talk.onclick=()=>{ TTS.stop(); captureCommand(); };
els.stop.onclick=()=>{ TTS.stop(); if(recog)try{recog.stop()}catch(_){}; stopWake(); listeningForCmd=false; if(wakeOn)startWake(); setState('idle'); };
els.wake.onclick=()=>{ wakeOn=!wakeOn; els.wake.textContent='👂 Wake word: '+(wakeOn?'On':'Off');
  if(wakeOn){ note('Listening for "Hey DUCKi"…'); startWake(); } else { stopWake(); } };
els.loadLLM.onclick=async()=>{ els.brain.value='llm'; await LLM.load(); };
els.brain.onchange=()=>{ if(els.brain.value==='llm') LLM.load(); else els.llmMode.textContent='Fallback'; };
els.send.onclick=()=>{ const t=els.text.value.trim(); if(t){ els.text.value=''; handleInput(t); } };
els.text.onkeydown=e=>{ if(e.key==='Enter'){ const t=els.text.value.trim(); if(t){ els.text.value=''; handleInput(t); } } };
els.clear.onclick=async()=>{ await Memory.clear(); els.log.innerHTML=''; bubble('system','Memory cleared.'); };

// Persist small settings
['rate','pitch'].forEach(k=>{ const v=localStorage.getItem('ducki_'+k); if(v)els[k].value=v; els[k].oninput=()=>localStorage.setItem('ducki_'+k,els[k].value); });
els.name.value=localStorage.getItem('ducki_name')||''; els.name.oninput=()=>localStorage.setItem('ducki_name',els.name.value);
els.tts.checked=localStorage.getItem('ducki_tts')!=='0'; els.tts.onchange=()=>localStorage.setItem('ducki_tts',els.tts.checked?'1':'0');

/* ---------------- Boot ---------------- */
(async function boot(){
  if(!SR) els.sttMode.textContent='Type only';
  TTS.init();
  await Memory.open();
  const hist=await Memory.all();
  if(hist.length){ hist.slice(-12).forEach(m=>bubble(m.role,m.content)); }
  else { bubble('system','DUCKi Jarvis Mode online. Tap the orb, enable the wake word, or type. Load the local AI in settings for full reasoning — everything runs on your device.'); }
  setState('idle');
})();
