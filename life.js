
const STORAGE_KEY = "lifeos_phase1_v1";
// Data-layer constants. Declared at the very top so the load-time init
// (ensurePhase2Data, called right after state) can reference them safely.
const COLLECTIONS=["tasks","events","study","habits","expenses","workouts","meals","groceries","savings","dikr","quran"];
const RECORD_DEFAULTS={
  tasks:{title:"",date:"",time:"",category:"personal"},
  study:{date:"",time:"",duration:60,subject:"",topic:"",chapter:"",objective:"",priority:"medium",notes:""},
  workouts:{date:"",time:"",type:"",duration:"",exercises:"",sets:"",notes:""},
  meals:{date:"",slot:"Lunch",name:"",ingredients:""},
  quran:{date:"",time:"",surah:"",ayahRange:"",type:"",confidence:"steady",notes:""},
  events:{date:"",time:"",title:"",type:"personal"},
  expenses:{date:"",title:"",category:"",amount:0},
  groceries:{name:"",done:false},
  savings:{date:"",name:"",target:0,saved:0},
  habits:{history:{}},
  dikr:{target:1,history:{}}
};
const DONE_COLLECTIONS=["tasks","study","workouts","quran"];
const HISTORY_COLLECTIONS=["habits","dikr"];

const state = loadState();
ensurePhase2Data();
let currentPage = "dashboard";
let presetEditId = null;
let calendarCursor = new Date();
let weekCursor = new Date();
let plannerView="month", dayCursor=new Date();

function uid(prefix="id"){ return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function isoDate(d=new Date()){ return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
function fmtDate(dateStr, opts={month:"short",day:"numeric"}){ return new Intl.DateTimeFormat(undefined,opts).format(new Date(dateStr+"T12:00:00")); }
function startOfWeek(d){ const x=new Date(d); const day=x.getDay(); x.setDate(x.getDate()-(day===0?6:day-1)); x.setHours(0,0,0,0); return x; }
function esc(s=""){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

function defaultState(){
  return {
    version:1,
    tasks:[
      {id:uid("task"),title:"Review today's priorities",date:isoDate(),time:"18:30",category:"personal",done:false}
    ],
    events:[],
    study:[
      {id:uid("study"),date:isoDate(),time:"17:00",duration:90,subject:"",topic:"",chapter:"",objective:"",priority:"medium",notes:"",done:false}
    ],
    habits:[
      {id:uid("habit"),name:"Study",history:{}},
      {id:uid("habit"),name:"Reading",history:{}},
      {id:uid("habit"),name:"Coding",history:{}},
      {id:uid("habit"),name:"Prayer",history:{}}
    ],
    expenses:[],
    reminders:[],
    settings:{theme:"light",quranDailyGoal:1,name:"Hiba"},
    dikr:[
      {id:uid("dikr"),name:"Morning Dikr",target:1,history:{}},
      {id:uid("dikr"),name:"Evening Dikr",target:1,history:{}}
    ],
    quran:[]
  };
}
// COLLECTIONS every section may render. They must always exist as arrays before
// any view runs, so a missing/broken collection can never crash the app.

function loadState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const data=JSON.parse(raw);
    if(!data || typeof data!=="object" || Array.isArray(data)){
      console.warn("LifeOS: stored data is not a plain object; starting fresh.");
      return defaultState();
    }
    return data;
  }catch(e){
    console.warn("LifeOS: could not restore/parse saved data safely.", e);
    return defaultState();
  }
}
// Fill only MISSING fields (never overwrite existing values). Returns null for
// a corrupt entry so its collection can drop it instead of crashing later.
function normalizeRecord(r, defaults, done, history){
  if(!r || typeof r!=="object" || Array.isArray(r)) return null;
  for(const k in defaults){ if(r[k]===undefined) r[k]=defaults[k]; }
  if(done && r.done==null) r.done=false;
  if(history && (!r.history || typeof r.history!=="object" || Array.isArray(r.history))) r.history={};
  return r;
}
// Central, safe initialization + normalization (non-destructive, backward-compatible).
function ensurePhase2Data(){
  COLLECTIONS.forEach(k=>{ if(!Array.isArray(state[k])) state[k]=[]; });
  state.settings=(state.settings && typeof state.settings==="object" && !Array.isArray(state.settings))?state.settings:{};
  state.settings.theme ||= "light";
  state.settings.name ||= "Hiba";
  state.settings.quranDailyGoal ||= 1;

  // Reminders & notifications config (non-destructive defaults).
  if(!Array.isArray(state.reminders)) state.reminders=[];
  state.reminders=state.reminders.filter(r=>r&&typeof r==="object"&&!Array.isArray(r)&&typeof r.id==="string"&&typeof r.title==="string");
  state.settings.notify = (state.settings.notify && typeof state.settings.notify==="object" && !Array.isArray(state.settings.notify))?state.settings.notify:{};
  const n=state.settings.notify;
  if(typeof n.enabled!=="boolean") n.enabled=true;
  if(typeof n.browser!=="boolean") n.browser=false;
  if(!Array.isArray(n.log)) n.log=[];
  n.log=n.log.filter(x=>x&&typeof x==="object"&&typeof x.id==="string");
  if(n.log.length>40) n.log=n.log.slice(n.log.length-40);
  n.smart=(n.smart&&typeof n.smart==="object"&&!Array.isArray(n.smart))?n.smart:{};
  const DEF_SMART={
    prayer:{label:"Prayer reminder",desc:"A gentle nudge at your chosen time.",enabled:true,time:"12:00"},
    dikr:{label:"Dikr",desc:"Reminds you to finish today's Dikr target.",enabled:true,time:"09:00"},
    habits:{label:"Habits",desc:"Reminds you to finish today's habits.",enabled:true,time:"18:00"},
    study:{label:"Study session",desc:"Reminds you before an upcoming study session.",enabled:true,time:"17:00"},
    quran:{label:"Quran",desc:"Reminds you to complete today's Quran goal.",enabled:true,time:"19:00"},
    tasks:{label:"Tasks",desc:"Reminds you of unfinished tasks today.",enabled:true,time:"20:00"},
    events:{label:"Events",desc:"Reminds you before an event today.",enabled:true,time:"08:00"},
    savings:{label:"Savings deadline",desc:"Warns when a goal's target date is near.",enabled:true,time:"21:00"}
  };
  for(const k in DEF_SMART){
    if(!n.smart[k]||typeof n.smart[k]!=="object") n.smart[k]={...DEF_SMART[k]};
    else{
      for(const f in DEF_SMART[k]){ if(n.smart[k][f]===undefined) n.smart[k][f]=DEF_SMART[k][f]; }
    }
  }

  // School timetable: nullable until created. Normalize (never wipe) existing
  // structures so a partial/older timetable can't break rendering.
  if(state.timetable!=null){
    if(typeof state.timetable!=="object" || Array.isArray(state.timetable)) state.timetable=null;
    else{
      if(!Array.isArray(state.timetable.days)) state.timetable.days=["Monday","Tuesday","Wednesday","Thursday","Friday"];
      if(!Array.isArray(state.timetable.slots)) state.timetable.slots=[];
      state.timetable.days=state.timetable.days.map(x=>typeof x==="string"?x:"");
      state.timetable.slots=state.timetable.slots.map(x=>typeof x==="string"?x:"");
      const c=state.timetable.cells;
      state.timetable.cells=(c && typeof c==="object" && !Array.isArray(c))?c:{};
      const nc={};
      for(const k in state.timetable.cells){ if(typeof state.timetable.cells[k]==="string") nc[k]=state.timetable.cells[k]; }
      state.timetable.cells=nc;
    }
  }

  // Daily journal / notes: date -> free-text map (like habit history).
  // Non-destructive: keep only string values, drop empties.
  state.notes=(state.notes && typeof state.notes==="object" && !Array.isArray(state.notes))?state.notes:{};
  const nn={};
  for(const d in state.notes){ if(typeof state.notes[d]==="string" && state.notes[d].trim()) nn[d]=state.notes[d]; }
  state.notes=nn;

  COLLECTIONS.forEach(k=>{
    if(HISTORY_COLLECTIONS.includes(k)) return;
    const defs=RECORD_DEFAULTS[k]||{}, done=DONE_COLLECTIONS.includes(k);
    state[k]=state[k].filter(x=>normalizeRecord(x,defs,done,false)!==null);
  });
  state.habits=state.habits.filter(x=>normalizeRecord(x,RECORD_DEFAULTS.habits,false,true)!==null);
  state.dikr=state.dikr.filter(x=>normalizeRecord(x,RECORD_DEFAULTS.dikr,false,true)!==null);

  // Dikr: older boolean history -> per-date count (target preserved).
  state.dikr.forEach(x=>{
    x.target=Number(x.target)||1;
    for(const d in x.history){ if(typeof x.history[d]==="boolean") x.history[d]=x.history[d]?x.target:0; }
  });

  // Save the normalized structure back safely (no wipe, non-throwing).
  persist();
}
// Non-throwing persist used at load (and normalization). Interactive saves use
// save() which intentionally throws so per-action rollback logic can run.
function persist(){
  try{ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); }
  catch(e){ console.warn("LifeOS: could not persist data.", e); }
}
function save(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); renderAll(); }

function pageNav(page){
  currentPage=page;
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById("page-"+page)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  const sb=document.getElementById("sidebar");
  sb.classList.remove("open");
  sb.classList.remove("collapsed");
}
function toggleMenu(){
  const sb=document.getElementById("sidebar");
  if(window.innerWidth<=760) sb.classList.toggle("open");
  else sb.classList.toggle("collapsed");
}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>pageNav(b.dataset.page)));

document.getElementById("prevMonth")?.addEventListener("click",()=>{if(plannerView==="day"){dayCursor.setDate(dayCursor.getDate()-1);}else{calendarCursor.setMonth(calendarCursor.getMonth()-1);}renderPlanner()});
document.getElementById("nextMonth")?.addEventListener("click",()=>{if(plannerView==="day"){dayCursor.setDate(dayCursor.getDate()+1);}else{calendarCursor.setMonth(calendarCursor.getMonth()+1);}renderPlanner()});
document.getElementById("todayMonth")?.addEventListener("click",()=>{if(plannerView==="day"){dayCursor=new Date();}else{calendarCursor=new Date();}renderPlanner()});
document.getElementById("prevWeek")?.addEventListener("click",()=>{weekCursor.setDate(weekCursor.getDate()-7);renderWeek()});
document.getElementById("nextWeek")?.addEventListener("click",()=>{weekCursor.setDate(weekCursor.getDate()+7);renderWeek()});
document.getElementById("todayWeek")?.addEventListener("click",()=>{weekCursor=new Date();renderWeek()});
document.getElementById("weeklyResetBtn")?.addEventListener("click",openWeeklyResetConfirm);
document.addEventListener("click",e=>{
  const v=e.target.closest("[data-view]")?.dataset.view;
  if(!v)return;
  plannerView=v;
  document.querySelectorAll(".view-switch [data-view]").forEach(b=>b.classList.toggle("active",b.dataset.view===v));
  if(v==="day"){ dayCursor = new Date(); }
  renderPlanner();
});
document.addEventListener("click",e=>{
  const target=e.target.closest("[data-page-target]");
  if(target) pageNav(target.dataset.pageTarget);
});
document.addEventListener("click",e=>{
  const action=e.target.closest("[data-action]")?.dataset.action;
  if(!action)return;
  if(action==="add-event")openForm("event");
  if(action==="add-study")openForm("study");
  if(action==="add-habit")openForm("habit");
  if(action==="add-expense")openForm("expense");
  if(action==="add-workout")openForm("workout");
  if(action==="add-meal")openForm("meal");
  if(action==="add-savings")openForm("savings");
  if(action==="add-grocery")openForm("grocery");
  if(action==="add-dikr")openForm("dikr");
  if(action==="add-quran")openForm("quran");
  if(action==="quran-goal")setQuranGoal();
});
document.getElementById("menuBtn").onclick=toggleMenu;
document.getElementById("floatingAdd").onclick=()=>openQuickAdd();
document.getElementById("quickAddBtn").onclick=()=>openQuickAdd();
document.getElementById("addTaskFromTimeline").onclick=()=>openForm("task");
document.getElementById("closeModal").onclick=closeModal;
document.getElementById("modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal()});
document.getElementById("themeBtn").onclick=toggleTheme;
document.getElementById("settingsTheme").onclick=toggleTheme;
document.getElementById("profileBtn").onclick=e=>{ e.stopPropagation(); setProfileMenu(document.getElementById("profileMenu").hidden); };
document.getElementById("menuThemeBtn").onclick=e=>{ e.stopPropagation(); toggleTheme(); };
const profileNameInput=document.getElementById("profileNameInput");
profileNameInput.addEventListener("keydown",e=>{ if(e.key==="Enter") e.target.blur(); });
profileNameInput.addEventListener("blur",saveProfileName);
// Close the profile menu when clicking anywhere outside it (or its button).
document.addEventListener("click",e=>{
  const m=document.getElementById("profileMenu");
  if(!m||m.hidden) return;
  if(!e.target.closest("#profileMenu") && !e.target.closest("#profileBtn")) m.hidden=true;
});
// Selecting a menu option closes the dropdown (theme stays open so its label updates live).
document.addEventListener("click",e=>{
  if(e.target.closest(".profile-opt")){ const m=document.getElementById("profileMenu"); if(m) m.hidden=true; }
});
function toggleTheme(){ state.settings.theme=state.settings.theme==="dark"?"light":"dark"; save(); }
function applyTheme(){ document.body.classList.toggle("dark",state.settings.theme==="dark"); }

// Profile / Preferences — a small dropdown reusing the existing theme + settings systems.
function getUserName(){ return String(state.settings.name||"").trim()||"Hiba"; }
function setProfileMenu(open){
  const m=document.getElementById("profileMenu"); if(!m) return;
  m.hidden=!open;
  const btn=document.getElementById("profileBtn"); if(btn) btn.setAttribute("aria-expanded",String(open));
  if(open) refreshProfile();
}
function closeProfileMenu(){ setProfileMenu(false); }
function refreshProfile(){
  const n=getUserName(), ch=n.charAt(0).toUpperCase();
  const btn=document.getElementById("profileBtn"), av=document.getElementById("profileAvatar"), ni=document.getElementById("profileNameInput");
  if(btn) btn.textContent=ch;
  if(av) av.textContent=ch;
  if(ni && document.activeElement!==ni) ni.value=n;
  const tl=document.getElementById("menuThemeLabel");
  if(tl) tl.textContent=state.settings.theme==="dark"?"Dark":"Light";
  const em=document.querySelector("#menuThemeBtn .opt-emoji");
  if(em) em.textContent=state.settings.theme==="dark"?"🌙":"☀️";
}
function saveProfileName(){
  const ni=document.getElementById("profileNameInput"); if(!ni) return;
  const v=ni.value.trim();
  state.settings.name=v||"Hiba";
  save(); // persists + re-renders (greeting/avatar update from the stored name)
}

function greeting(){
  const h=new Date().getHours(), n=getUserName();
  return h<12?`Good morning, ${n}.`:h<18?`Good afternoon, ${n}.`:`Good evening, ${n}.`;
}
function datedItems(){
  const out=[];
  state.study.filter(x=>x.date).forEach(x=>out.push({date:x.date,time:x.time||"",cat:"Study",icon:"📚",model:"study",id:x.id,label:x.subject||"Study",sub:x.topic||"",done:x.done,completable:true}));
  state.tasks.filter(x=>x.date).forEach(x=>out.push({date:x.date,time:x.time||"",cat:"Task",icon:"✅",model:"task",id:x.id,label:x.title,sub:"",done:x.done,completable:true}));
  state.workouts.filter(x=>x.date).forEach(x=>out.push({date:x.date,time:x.time||"",cat:"Workout",icon:"🏋️",model:"workout",id:x.id,label:x.type||"Workout",sub:x.duration||"",done:x.done,completable:true}));
  state.events.filter(x=>x.date).forEach(x=>out.push({date:x.date,time:x.time||"",cat:"Event",icon:"📅",model:"event",id:x.id,label:x.title||"Event",sub:"",done:false,completable:false}));
  state.meals.filter(x=>x.date).forEach(x=>out.push({date:x.date,time:"",cat:"Meal",icon:"🍽️",model:"meal",id:x.id,label:(x.slot?x.slot+": ":"")+(x.name||"Meal"),sub:"",done:false,completable:false}));
  state.quran.filter(x=>x.date).forEach(x=>out.push({date:x.date,time:x.time||"",cat:"Quran",icon:"📖",model:"quran",id:x.id,label:x.surah||"Quran",sub:x.type||"",done:x.done,completable:true}));
  return out;
}

function renderDashboard(){
  const today=isoDate(), d=new Date();
  document.getElementById("todayLabel").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(d).toUpperCase();
  document.getElementById("sideDate").textContent=fmtDate(today,{weekday:"long",month:"short",day:"numeric"});
  document.getElementById("greeting").textContent=greeting();
  const comp=["task","study","workout"];
  const todayItems=datedItems().filter(x=>x.date===today);
  const cItems=todayItems.filter(x=>x.completable);
  const done=cItems.filter(x=>x.done).length,total=cItems.length,pct=total?Math.round(done/total*100):0;
  document.getElementById("dailyProgress").textContent=pct+"%";
  document.getElementById("dailyProgressBar").style.width=pct+"%";
  document.getElementById("dailyRing").style.setProperty("--p",pct+"%");
  document.querySelector("#dailyRing span").textContent=pct+"%";
  document.getElementById("dailyProgressMeta").textContent=`${done} of ${total} planned items complete`;
  document.getElementById("sideProgress").textContent=`${pct}% complete`;
  document.getElementById("studyCount").textContent=state.study.filter(x=>x.date===today).length;
  const month=new Date().toISOString().slice(0,7),spend=state.expenses.filter(x=>x.date?.startsWith(month)).reduce((a,x)=>a+Number(x.amount||0),0);
  document.getElementById("monthSpend").textContent=money(spend);
  document.getElementById("areaStudy").textContent=state.study.filter(x=>x.date===today).length;
  const habitsToday=state.habits.map(h=>h.history?.[today]).filter(Boolean).length;
  document.getElementById("areaHabits").textContent=(state.habits.length?Math.round(habitsToday/state.habits.length*100):0)+"%";
  document.getElementById("areaMoney").textContent=money(spend);
  document.getElementById("areaTasks").textContent=state.tasks.filter(x=>x.date===today&&!x.done).length;
  const jn=(state.notes||{})[today]||"";
  const dj=document.getElementById("dashJournal");
  if(dj){ dj.value=jn; const dh=document.getElementById("dashJournalHint"); if(dh) dh.textContent=jn?`${jn.length} characters · saved automatically`:"Saved automatically on this device"; }
  const timeline=document.getElementById("todayTimeline"),sorted=todayItems.sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  timeline.classList.toggle("empty-state",!sorted.length);
  timeline.innerHTML=sorted.length?sorted.map(x=>`
    <div class="timeline-item"><span class="timeline-time">${esc(x.time||"Anytime")}</span><span class="timeline-dot"></span>
      <div class="tl-body">
        <div class="tl-main"><strong class="${x.done?"completed":""}">${x.icon} ${esc(x.label)}</strong>${x.completable?`<button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('${x.model}','${x.id}')">${x.done?"✓":""}</button>`:""}${actionButtons(x.model,x.id)}</div>
        ${x.sub?`<small>${esc(x.sub)}</small>`:""}
      </div>
    </div>`).join(""):`<div class="empty-state">Nothing planned yet. Add your first task.</div>`;
  const upcoming=datedItems().filter(x=>x.date>=today).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  const upEl=document.getElementById("dashboardUpcoming");
  if(upEl) upEl.innerHTML=upcoming.slice(0,6).map(x=>`
    <div class="list-item"><div><strong class="${x.done?"completed":""}">${x.icon} ${esc(x.label)}</strong><small>${x.date===today?"Today":fmtDate(x.date)}${x.time?" · "+esc(x.time):""}</small></div>
    <span class="priority">${esc(x.cat)}</span>${x.completable?`<button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('${x.model}','${x.id}')">${x.done?"✓":""}</button>`:""}</div>`).join("")||`<div class="empty-state">No upcoming activities.</div>`;
  document.getElementById("dashboardHabits").innerHTML=state.habits.slice(0,5).map(h=>`
    <div class="list-item"><div><strong>${esc(h.name)}</strong><small>${h.history?.[today]?"Completed today":"Ready for today"}</small></div>
    <button class="check ${h.history?.[today]?"done":""}" onclick="toggleHabit('${h.id}')">${h.history?.[today]?"✓":""}</button>${actionButtons("habit",h.id)}</div>`).join("")||`<div class="empty-state">No habits yet.</div>`;
  const ws=startOfWeek(new Date()), we=new Date(ws); we.setDate(we.getDate()+6);
  const inWk=x=>x.date>=isoDate(ws)&&x.date<=isoDate(we);
  const wk=[["Tasks",state.tasks.filter(inWk)],["Study",state.study.filter(inWk)],["Workouts",state.workouts.filter(inWk)]];
  const wkEl=document.getElementById("dashboardWeek");
  if(wkEl) wkEl.innerHTML=wk.map(([label,arr])=>{const dd=arr.filter(x=>x.done).length;return `<div class="analytics-bar-row"><span>${label}</span><div class="analytics-bar"><i style="width:${arr.length?Math.round(dd/arr.length*100):0}%"></i></div><strong>${dd}/${arr.length}</strong></div>`}).join("")||`<div class="empty-state">No weekly progress yet.</div>`;
  const todayMeals=state.meals.filter(x=>x.date===today), todayWorkouts=state.workouts.filter(x=>x.date===today), todayQuran=state.quran.filter(x=>x.date===today);
  const dikrToday=state.dikr.filter(x=>dikrCompleted(x,today)).length;
  const saved=state.savings.reduce((a,g)=>a+Number(g.saved||0),0);
  let lines="";
  if(todayMeals.length) lines+=`<div class="dash-line"><span>🍽️ ${todayMeals.length} meal${todayMeals.length>1?"s":""}</span><strong>${esc(todayMeals.map(m=>m.name||m.slot).filter(Boolean).join(", "))}</strong></div>`;
  if(todayWorkouts.length) lines+=`<div class="dash-line"><span>🏋️ Workout</span><strong>${esc(todayWorkouts[0].type||"Scheduled")}</strong></div>`;
  if(todayQuran.length) lines+=`<div class="dash-line"><span>📖 Quran</span><strong>${todayQuran.filter(x=>x.done).length} / ${todayQuran.length} completed</strong></div>`;
  if(state.dikr.length) lines+=`<div class="dash-line"><span>🤲 Dikr</span><strong>${dikrToday}/${state.dikr.length}</strong></div>`;
  if(state.habits.length) lines+=`<div class="dash-line"><span>✓ Habits</span><strong>${habitsToday}/${state.habits.length}</strong></div>`;
  if(saved>0) lines+=`<div class="dash-line"><span>◇ Savings</span><strong>${money(saved)}</strong></div>`;
  const _ag=state.goals?state.goals.filter(g=>g.status!=="completed"&&(g.progress||0)<100).length:0;
  const _vc=state.vision?state.vision.length:0;
  const _wr=(state.wishlist?state.wishlist.filter(w=>!w.purchased).length:0);
  if(_ag||_vc||_wr) lines+=`<div class="dash-line"><span>🎯 Goals</span><strong>${_ag} active · ${_vc} vision · ${_wr} wishlist</strong></div>`;
  const todayEl=document.getElementById("dashboardToday");
  if(todayEl) todayEl.innerHTML=lines||`<div class="empty-state">Nothing scheduled today.</div>`;
}

function money(n){ return `${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})} DH`; }

function dayItems(date){
  const items=[];
  state.study.filter(x=>x.date===date).forEach(x=>items.push({cat:"study",icon:"📚",id:x.id,model:"study",label:x.subject||"Study",time:x.time||"",sub:(x.time?x.time+" · ":"")+(x.topic||""),done:x.done,completable:true}));
  state.tasks.filter(x=>x.date===date).forEach(x=>items.push({cat:"task",icon:"✅",id:x.id,model:"task",label:x.title,time:x.time||"",sub:x.time||"",done:x.done,completable:true}));
  state.workouts.filter(x=>x.date===date).forEach(x=>items.push({cat:"workout",icon:"🏋️",id:x.id,model:"workout",label:x.type||"Workout",time:x.time||"",sub:(x.time||"")+(x.duration?" · "+x.duration:""),done:x.done,completable:true}));
  state.meals.filter(x=>x.date===date).forEach(x=>items.push({cat:"meal",icon:"🍽️",id:x.id,model:"meal",label:(x.slot?x.slot+": ":"")+(x.name||"Meal"),time:"",sub:x.ingredients||"",done:false,completable:false}));
  state.quran.filter(x=>x.date===date).forEach(x=>items.push({cat:"quran",icon:"📖",id:x.id,model:"quran",label:x.surah||"Quran"+(x.ayahRange?" · "+x.ayahRange:""),time:x.time||"",sub:x.type||"",done:x.done,completable:true}));
  state.expenses.filter(x=>x.date===date).forEach(x=>items.push({cat:"expense",icon:"💰",id:x.id,model:"expense",label:x.title||x.category||"Expense",time:"",sub:money(x.amount),done:false,completable:false}));
  state.events.filter(x=>x.date===date).forEach(x=>items.push({cat:"event",icon:"📅",id:x.id,model:"event",label:x.title||"Event",time:x.time||"",sub:x.time||"",done:false,completable:false}));
  return items;
}
const CAT_LABEL={study:"Study",task:"Tasks",workout:"Workouts",meal:"Meals",quran:"Quran",expense:"Money",event:"Events"};
const CAT_DOT={study:"dot-study",task:"dot-task",workout:"dot-workout",meal:"dot-meal",quran:"dot-quran","expense":"dot-money",event:"dot-event"};

// Monthly Planner entry point: renders Month or Day depending on the active view.
function renderPlanner(){ if(plannerView==="day") renderDay(); else renderCalendar(); }

// Real Day view: shows the selected day's records chronologically, using the
// same underlying LifeOS data + completion/edit/delete/quick-add functions.
function renderDay(){
  const date=isoDate(dayCursor);
  document.getElementById("monthTitle").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(dayCursor);
  const items=dayItems(date).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  let html=`<div class="day-view">
    <div class="day-add-row"><button class="primary-btn" onclick="openForm('task','${date}')">＋ Quick add</button><button class="secondary-btn" onclick="openForm('event','${date}')">＋ Event</button></div>`;
  if(!items.length){
    html+=`<div class="empty-state">Nothing scheduled for this day.</div>`;
  }else{
    html+=items.map(x=>`<div class="list-item day-item">
      <div><span class="day-cat-label">${CAT_LABEL[x.cat]||esc(x.cat)}</span><strong class="${x.done?"completed":""}">${x.icon} ${esc(x.label)}</strong>${x.sub?`<small>${esc(x.sub)}</small>`:``}</div>
      <div style="display:flex;gap:7px;align-items:center">
        <span class="day-time">${esc(x.time||"Anytime")}</span>
        ${x.completable?`<button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('${x.model}','${x.id}')">${x.done?"✓":""}</button>`:``}
        <button class="action-btn edit" title="Edit" onclick="openForm('${x.model}','${date}','${x.id}')">✎</button>
        <button class="action-btn delete" title="Delete" onclick="deleteRecord('${x.model}','${x.id}')">×</button>
      </div>
    </div>`).join("");
  }
  html+=`</div>`;
  document.getElementById("calendar").innerHTML=html;
}

function renderCalendar(){
  const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth();
  document.getElementById("monthTitle").textContent=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(calendarCursor);
  const first=new Date(y,m,1), offset=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  let cells="";
  for(let i=0;i<offset;i++) cells+=`<div class="day-cell"></div>`;
  for(let day=1;day<=days;day++){
    const date=isoDate(new Date(y,m,day)), today=date===isoDate();
    const items=dayItems(date);
    const cats=[...new Set(items.map(x=>x.cat))];
    const dikrDone=state.dikr.filter(x=>dikrCompleted(x,date)).length;
    const habitDone=state.habits.filter(x=>x.history?.[date]).length;
    const hasNote=(state.notes||{})[date];
    const dots=cats.map(c=>`<b class="dot ${CAT_DOT[c]}"></b>`).join("")+(dikrDone?`<b class="dot dot-dikr"></b>`:"")+(habitDone?`<b class="dot dot-habit"></b>`:"")+(hasNote?`<b class="dot dot-note"></b>`:"");
    const visible=items.slice(0,2);
    const extra=items.length-visible.length;
    cells+=`<div class="day-cell ${items.length||dikrDone||habitDone||hasNote?"has-data":""}" onclick="openDayDetail('${date}')">
      <div class="day-number ${today?"today":""}">${day}</div>
      ${dots?`<div class="day-dots">${dots}</div>`:""}
      ${visible.map(e=>`<div class="event-pill event-${e.cat}"><span class="event-label">${e.icon} ${esc(e.label)}</span></div>`).join("")}
      ${extra>0?`<button class="day-more" onclick="event.stopPropagation();openDayDetail('${date}')">+${extra} more</button>`:""}
    </div>`;
  }
  const total=Math.ceil((offset+days)/7)*7;
  for(let i=offset+days;i<total;i++) cells+=`<div class="day-cell"></div>`;
  document.getElementById("calendar").innerHTML=`<div class="calendar-head">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(x=>`<div>${x}</div>`).join("")}</div><div class="calendar-body">${cells}</div>`;
}

function dayNoteHTML(date){
  const note=(state.notes||{})[date]||"";
  return `<div class="day-note">
    <span class="eyebrow">JOURNAL</span>
    <textarea rows="3" placeholder="Write a note / journal entry for this day…" oninput="onDayNoteInput('${date}',this.value)">${esc(note)}</textarea>
    <small class="muted">${note?`${note.length} characters · saved automatically`:"Saved automatically on this device"}</small>
  </div>`;
}
// Autosave the day's note. Uses persist() (no re-render) so typing keeps focus.
function onDayNoteInput(date,value){
  state.notes=state.notes||{};
  if(value && value.trim()) state.notes[date]=value;
  else delete state.notes[date];
  persist();
}
// Dashboard journal for today: same data as the day modal, with a live hint.
function onDayJournalInput(value){
  onDayNoteInput(isoDate(),value);
  const dh=document.getElementById("dashJournalHint");
  if(dh){ const t=value.trim(); dh.textContent=t?`${t.length} characters · saved automatically`:"Saved automatically on this device"; }
}
function openDayDetail(date){
  const items=dayItems(date);
  document.getElementById("modalTitle").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"}).format(new Date(date+"T12:00:00"));
  document.getElementById("modalEyebrow").textContent="DAY OVERVIEW";
  const form=document.getElementById("modalForm"); form.onsubmit=null;
  if(!items.length){
    form.innerHTML=dayNoteHTML(date)+`<div class="empty-state">No activities scheduled for this day.</div>
    <div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Close</button></div>`;
    document.getElementById("modalBackdrop").classList.add("open"); return;
  }
  const mini=x=>x.completable?`<button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDoneIn('${x.model}','${x.id}','${date}')">${x.done?"✓":""}</button>`:"";
  let html=dayNoteHTML(date)+'<div class="day-detail-list">';
  Object.keys(CAT_LABEL).forEach(cat=>{
    const list=items.filter(x=>x.cat===cat); if(!list.length) return;
    html+=`<div class="day-cat"><span class="eyebrow">${CAT_LABEL[cat]}</span>`+list.map(x=>`<div class="list-item"><div><strong class="${x.done?"completed":""}">${x.icon} ${esc(x.label)}</strong>${x.sub?`<small>${esc(x.sub)}</small>`:""}</div><div style="display:flex;gap:7px;align-items:center">${mini(x)}<button class="action-btn edit" onclick="editFromDay('${x.model}','${x.id}','${date}')">✎</button><button class="action-btn delete" onclick="deleteFromDay('${x.model}','${x.id}','${date}')">×</button></div></div>`).join("")+`</div>`;
  });
  const dikrDone=state.dikr.filter(x=>dikrCompleted(x,date)).length;
  const habitDone=state.habits.filter(x=>x.history?.[date]).length;
  if(dikrDone) html+=`<div class="list-item"><div><strong>🤲 Dikr</strong><small>${dikrDone} / ${state.dikr.length} completed</small></div></div>`;
  if(habitDone) html+=`<div class="list-item"><div><strong>✓ Habits</strong><small>${habitDone} / ${state.habits.length} completed</small></div></div>`;
  html+='</div><div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Close</button></div>';
  form.innerHTML=html;
  document.getElementById("modalBackdrop").classList.add("open");
}
function toggleRecordDoneIn(model,id,date){ toggleRecordDone(model,id); openDayDetail(date); }
function editFromDay(model,id,date){ openForm(model,date,id); }
function deleteFromDay(model,id,date){ deleteRecord(model,id); openDayDetail(date); }

function renderWeek(){
  const start=startOfWeek(weekCursor), end=new Date(start);
  end.setDate(end.getDate()+6);
  document.getElementById("weekTitle").textContent=`${fmtDate(isoDate(start),{month:"short",day:"numeric"})} – ${fmtDate(isoDate(end),{month:"short",day:"numeric",year:"numeric"})}`;

  const dayNames=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  let html="";

  for(let i=0;i<7;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    const date=isoDate(d), today=date===isoDate();
    const tasks=state.tasks.filter(x=>x.date===date);
    const study=state.study.filter(x=>x.date===date);
    const workouts=state.workouts.filter(x=>x.date===date);
    const meals=state.meals.filter(x=>x.date===date);
    const events=state.events.filter(x=>x.date===date);
    const quran=state.quran.filter(x=>x.date===date);
    const expenses=state.expenses.filter(x=>x.date===date);
    const completedHabits=state.habits.filter(x=>x.history?.[date]).length;
    const completedDikr=state.dikr.filter(x=>dikrCompleted(x,date)).length;

    const blocks=[...tasks,...study,...workouts,...meals,...quran,...events,...expenses];

    html+=`<article class="card week-day ${today?"today":""}">
      <header>
        <div><span class="eyebrow">${dayNames[i]}</span><strong>${d.getDate()}</strong></div>
        <button class="week-add" title="Add task for this day" onclick="openForm('task','${date}')">＋</button>
      </header>
      <div class="week-content">

        ${study.map(x=>`<div class="week-block">
          <div class="week-main"><button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('study','${x.id}')">${x.done?"✓":""}</button>
            <div><strong class="${x.done?"completed":""}">📚 ${esc(x.subject||"Study")}</strong><small>${esc(x.time||"Anytime")}${x.topic?` · ${esc(x.topic)}`:""}</small></div>
          </div>${actionButtons("study",x.id)}
        </div>`).join("")}

        ${tasks.map(x=>`<div class="week-block">
          <div class="week-main"><button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('task','${x.id}')">${x.done?"✓":""}</button>
            <div><strong class="${x.done?"completed":""}">✅ ${esc(x.title)}</strong><small>${esc(x.time||"Anytime")} · ${esc(x.category||"personal")}</small></div>
          </div>${actionButtons("task",x.id)}
        </div>`).join("")}

        ${workouts.map(x=>`<div class="week-block">
          <div class="week-main"><button class="mini-check ${x.done?"done":""}" onclick="toggleWorkout('${x.id}')">${x.done?"✓":""}</button>
            <div><strong class="${x.done?"completed":""}">🏋️ ${esc(x.type||"Workout")}</strong><small>${esc(x.time||"Anytime")}${x.duration?` · ${esc(x.duration)}`:""}</small></div>
          </div>${actionButtons("workout",x.id)}
        </div>`).join("")}

        ${meals.map(x=>`<div class="week-block">
          <div class="week-main"><span class="event-week-icon">🍽️</span>
            <div><strong>${esc(x.slot||"Meal")} · ${esc(x.name||"Meal")}</strong><small>${esc(x.ingredients||"Planned meal")}</small></div>
          </div>${actionButtons("meal",x.id)}
        </div>`).join("")}

        ${quran.map(x=>`<div class="week-block">
          <div class="week-main"><button class="mini-check ${x.done?"done":""}" onclick="toggleQuranDone('${x.id}')">${x.done?"✓":""}</button><span class="event-week-icon">📖</span>
            <div><strong class="${x.done?"completed":""}">${esc(x.surah||"Quran")} · ${esc(x.ayahRange||"")}</strong><small>${esc(x.type||"Quran")}${x.time?` · ${esc(x.time)}`:""}</small></div>
          </div>${actionButtons("quran",x.id)}
        </div>`).join("")}

        ${state.dikr.length?`<div class="week-block week-habit-summary">
          <div class="week-main"><span class="event-week-icon">🤲</span>
            <div><strong>Dikr</strong><small>${completedDikr} / ${state.dikr.length} complete</small></div>
          </div>
        </div>`:``}

        ${expenses.map(x=>`<div class="week-block">
          <div class="week-main"><span class="event-week-icon">💰</span>
            <div><strong>${esc(x.title||x.category||"Expense")}</strong><small>${esc(x.category||"Money")} · ${money(x.amount)}</small></div>
          </div>${actionButtons("expense",x.id)}
        </div>`).join("")}

        ${events.map(x=>`<div class="week-block">
          <div class="week-main"><span class="event-week-icon">📅</span>
            <div><strong>${esc(x.title||"Event")}</strong><small>${esc(x.time||"Anytime")} · ${esc(x.type||"personal")}</small></div>
          </div>${actionButtons("event",x.id)}
        </div>`).join("")}

        ${state.habits.length?`<div class="week-block week-habit-summary">
          <div class="week-main"><span class="event-week-icon">✓</span>
            <div><strong>Habits</strong><small>${completedHabits} / ${state.habits.length} complete</small></div>
          </div>
        </div>`:""}

        ${!blocks.length&&!state.habits.length&&!state.dikr.length?`<div class="empty-state">Open space</div>`:""}
      </div>
    </article>`;
  }

  document.getElementById("weekGrid").innerHTML=html;
}

function renderStudy(){
  const start=startOfWeek(new Date()), end=new Date(start);end.setDate(end.getDate()+6);
  const week=state.study.filter(x=>x.date>=isoDate(start)&&x.date<=isoDate(end));
  document.getElementById("studyWeekCount").textContent=week.length;
  document.getElementById("studyDoneCount").textContent=state.study.filter(x=>x.done).length;
  document.getElementById("studyConsistency").textContent=(state.study.length?Math.round(state.study.filter(x=>x.done).length/state.study.length*100):0)+"%";
  document.getElementById("studyList").innerHTML=state.study.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(x=>`
    <div class="study-row">
      <span class="study-date">${fmtDate(x.date)}<br>${esc(x.time||"")}</span>
      <div><strong>${esc(x.subject||"Untitled subject")}</strong><small>${esc(x.topic||"No topic")} · ${esc(x.objective||"No objective")}</small></div>
      <button class="check ${x.done?"done":""}" onclick="toggleStudy('${x.id}')">${x.done?"✓":""}</button>
      ${actionButtons("study",x.id)}
    </div>`).join("") || `<div class="empty-state">No study sessions yet.</div>`;
}

function toggleStudy(id){const x=state.study.find(x=>x.id===id);if(x){x.done=!x.done;save()}}
// One shared path for ALL workout completion toggles (Workout page, Dashboard,
// Week view, Day overview). Routes through toggleWorkout so every view uses the
// same robust, error-safe handler on the single source of truth (state.workouts).
function toggleRecordDone(type,id){
  if(type==="workout"){ toggleWorkout(id); return; }
  if(type==="quran"){ toggleQuranDone(id); return; }
  const map={task:"tasks",study:"study",workout:"workouts"};
  const item=state[map[type]]?.find(x=>x.id===id);
  if(!item)return;
  item.done=!item.done; save();
}

function toggleHabit(id){
  const h=state.habits.find(x=>x.id===id), today=isoDate();
  if(!h)return;
  h.history=h.history||{};
  h.history[today]=!h.history[today];
  save();
}
function toggleHabitDate(id,date){const h=state.habits.find(x=>x.id===id);if(!h)return;h.history=h.history||{};h.history[date]=!h.history[date];save()}
function renderHabits(){
  const today=isoDate(), done=state.habits.filter(h=>h.history?.[today]).length;
  document.getElementById("habitSummary").textContent=`${done} / ${state.habits.length} complete`;
  document.getElementById("habitBar").style.width=(state.habits.length?done/state.habits.length*100:0)+"%";
  document.getElementById("habitList").innerHTML=state.habits.map(h=>{
    const days=[]; const base=new Date(today+"T12:00:00");
    for(let i=6;i>=0;i--){const d=new Date(base);d.setDate(base.getDate()-i);days.push(isoDate(d))}
    const total=Object.values(h.history||{}).filter(Boolean).length;
    return `<article class="card habit-card">${actionButtons("habit",h.id)}<div class="card-title"><h3>${esc(h.name)}</h3><button class="check ${h.history?.[today]?"done":""}" onclick="toggleHabit('${h.id}')">${h.history?.[today]?"✓":""}</button></div>
      <div class="habit-days">${days.map(x=>`<button class="habit-day ${h.history?.[x]?"done":""}" title="${x}" onclick="toggleHabitDate('${h.id}','${x}')"><span class="habit-checkbox">${h.history?.[x]?"✓":""}</span><em>${new Date(x+"T12:00:00").toLocaleDateString(undefined,{weekday:"narrow"})}</em></button>`).join("")}</div>
      <div class="habit-meta"><span>${total} total check-ins</span><span>${h.history?.[today]?"Done today":"Open today"}</span></div></article>`;
  }).join("")||`<div class="empty-state">No habits yet. Add one to build a routine.</div>`;
}

function renderMoney(){
  const month=new Date().toISOString().slice(0,7), list=state.expenses.filter(x=>x.date?.startsWith(month));
  const total=list.reduce((a,x)=>a+Number(x.amount||0),0);
  document.getElementById("moneyTotal").textContent=money(total);
  document.getElementById("monthSpend").textContent=money(total);
  document.getElementById("transactionCount").textContent=list.length;
  const by={};list.forEach(x=>by[x.category]=(by[x.category]||0)+Number(x.amount||0));
  const cats=Object.entries(by).sort((a,b)=>b[1]-a[1]);
  document.getElementById("topCategory").textContent=cats[0]?.[0]||"—";
  document.getElementById("moneyBreakdown").innerHTML=cats.map(([cat,val])=>`<div class="break-row"><span>${esc(cat)}</span><div class="break-bar"><i style="width:${total?val/total*100:0}%"></i></div><strong>${money(val)}</strong></div>`).join("")||`<div class="empty-state">No expenses this month.</div>`;
  document.getElementById("transactionList").innerHTML=list.slice().reverse().slice(0,8).map(x=>`<div class="list-item"><div><strong>${esc(x.title||x.category)}</strong><small>${fmtDate(x.date)} · ${esc(x.category)}</small></div><strong>${money(x.amount)}</strong>${actionButtons("expense",x.id)}</div>`).join("")||`<div class="empty-state">No transactions yet.</div>`;
  renderMoneyHistory();
}
function renderMoneyHistory(){
  const el=document.getElementById("moneyHistory"); if(!el) return;
  const monthly={};
  state.expenses.forEach(x=>{
    const ym=x.date?x.date.slice(0,7):null;
    if(!ym) return;
    monthly[ym]=(monthly[ym]||0)+Number(x.amount||0);
  });
  const months=Object.keys(monthly).sort().reverse();
  if(!months.length){
    el.innerHTML=`<div class="empty-state">No spending history yet<br><span class="small">Your monthly spending history will appear here once you add an expense.</span></div>`;
    return;
  }
  el.innerHTML=months.map(ym=>{
    const label=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(new Date(ym+"-01T12:00:00"));
    return `<div class="history-month"><div><h4>${esc(label)}</h4><span class="history-total">Total spent</span></div><strong>${money(monthly[ym])}</strong></div>`;
  }).join("");
}

function field(label,name,type="text",value="",extra="",full=false){
  return `<div class="field ${full?"full":""}"><label>${label}</label>${type==="textarea"?`<textarea name="${name}" ${extra}>${esc(value)}</textarea>`:`<input name="${name}" type="${type}" value="${esc(value)}" ${extra}>`}</div>`;
}
function selectField(label,name,options,value="",full=false){
  return `<div class="field ${full?"full":""}"><label>${label}</label><select name="${name}">${options.map(o=>`<option ${o===value?"selected":""}>${esc(o)}</option>`).join("")}</select></div>`;
}
function renderWorkouts(){
  const start=startOfWeek(new Date()), end=new Date(start);end.setDate(end.getDate()+6);
  const week=state.workouts.filter(x=>x.date>=isoDate(start)&&x.date<=isoDate(end));
  document.getElementById("workoutWeekCount").textContent=week.length;
  document.getElementById("workoutDoneCount").textContent=week.filter(x=>x.done).length;
  document.getElementById("restDayCount").textContent=Math.max(0,7-new Set(week.map(x=>x.date)).size);
  document.getElementById("workoutList").innerHTML=week.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time)).map(x=>`
    <div class="study-row"><span class="study-date">${fmtDate(x.date)}<br>${esc(x.time||"")}</span>
    <div><strong>${esc(x.type||"Workout")}</strong><small>${esc(x.exercises||"General movement")} · ${esc(x.duration||"Flexible duration")}</small></div>
    <button class="check ${x.done?"done":""}" onclick="toggleWorkout('${x.id}')">${x.done?"✓":""}</button>
    ${actionButtons("workout",x.id)}</div>`).join("")||`<div class="empty-state">No workouts planned this week. Rest counts too.</div>`;
}

// In-flight guard: while a workout save is being persisted, ignore repeat clicks
// so we don't send multiple identical requests or double-toggle the record.
let savingWorkoutId=null;
function toggleWorkout(id){
  const x=state.workouts.find(x=>x.id===id);
  if(!x) return;
  if(savingWorkoutId===id) return; // prevent double-clicks during save
  savingWorkoutId=id;
  const prev=x.done, next=!prev;
  x.done=next;                 // optimistic UI update (single source: state.workouts)
  try{
    save();                    // persists to localStorage + re-renders ALL views
    showToast(next?"Workout completed ✓":"Workout marked pending");
  }catch(err){
    x.done=prev;               // rollback in-memory on failure — no false success
    console.error("Failed to update workout:",err);
    try{ renderAll(); }catch(_draw){} // redraw UI from corrected state; don't re-attempt failing write
    showToast("Couldn't update workout. Please try again.",true);
  }finally{
    savingWorkoutId=null;      // re-enable so the user can retry
  }
}
function renderMeals(){
  const start=startOfWeek(new Date()), labels=["Breakfast","Lunch","Dinner","Snack"]; let html="";
  for(let i=0;i<7;i++){const d=new Date(start);d.setDate(start.getDate()+i);const date=isoDate(d);
    html+=`<article class="card meal-day"><span class="eyebrow">${new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(d).toUpperCase()}</span><h3>${fmtDate(date,{month:"short",day:"numeric"})}</h3>`;
    labels.forEach(slot=>{const m=state.meals.find(x=>x.date===date&&x.slot===slot);html+=m?`<div class="meal-slot"><span>${slot}</span><strong>${esc(m.name)}</strong>${actionButtons("meal",m.id)}</div>`:`<div class="meal-slot empty" onclick="openMealForDate('${date}','${slot}')"><span>${slot}</span><strong>＋ Add</strong></div>`}); html+=`</article>`;
  }
  document.getElementById("mealGrid").innerHTML=html;
  document.getElementById("groceryList").innerHTML=state.groceries.map(g=>`<div class="list-item grocery-item ${g.done?"done":""}"><button class="check ${g.done?"done":""}" onclick="toggleGrocery('${g.id}')">${g.done?"✓":""}</button><span>${esc(g.name)}</span>${actionButtons("grocery",g.id)}</div>`).join("")||`<div class="empty-state">Your grocery list is empty.</div>`;
}

function toggleGrocery(id){const g=state.groceries.find(x=>x.id===id);if(g){g.done=!g.done;save()}}
function openMealForDate(date,slot){openForm("meal",date);setTimeout(()=>{const s=document.querySelector('#modalForm select[name="slot"]');if(s)s.value=slot},0)}

function renderSavings(){
  const el=document.getElementById("savingsGrid");
  el.innerHTML=state.savings.map(g=>{const target=Number(g.target||0),saved=Number(g.saved||0),pct=target?Math.min(100,saved/target*100):0;return `<article class="card saving-card">${actionButtons("savings",g.id)}<span class="eyebrow">GOAL</span><h3>${esc(g.name)}</h3><div class="saving-amount"><strong>${money(saved)}</strong><span>of ${money(target)}</span></div><div class="saving-progress"><i style="width:${pct}%"></i></div><div class="saving-meta"><span>${Math.round(pct)}% complete</span><span>Target ${fmtDate(g.date)}</span></div></article>`}).join("")||`<div class="card saving-card"><div class="empty-state">No savings goals yet. Add one to give your money a destination.</div></div>`;
}

function setQuranGoal(){
  const v=prompt("How many Quran sessions would you like as your daily goal?",String(state.settings.quranDailyGoal||1));
  if(v!==null && Number(v)>0){state.settings.quranDailyGoal=Math.round(Number(v));save()}
}
function renderAnalytics(){
  const today=isoDate();
  const setStat=(num,bar,denom,done)=>{const p=denom?Math.round(done/denom*100):null;const n=document.getElementById(num),b=document.getElementById(bar);if(n){n.classList.toggle("no-data",p==null);n.textContent=p==null?"No data yet":p+"%";}if(b)b.style.width=(p==null?0:p)+"%";};
  setStat("aStudy","aStudyBar",state.study.length,state.study.filter(x=>x.done).length);
  setStat("aTasks","aTasksBar",state.tasks.length,state.tasks.filter(x=>x.done).length);
  setStat("aHabits","aHabitsBar",state.habits.length,state.habits.filter(h=>h.history?.[today]).length);
  setStat("aDikr","aDikrBar",state.dikr.length,state.dikr.filter(x=>dikrCompleted(x,today)).length);
  const ws=startOfWeek(new Date()),we=new Date(ws);we.setDate(we.getDate()+6);
  const wsI=isoDate(ws),weI=isoDate(we),inWk=x=>x.date>=wsI&&x.date<=weI;
  const weekDays=[];for(let d=new Date(ws);d<=we;d.setDate(d.getDate()+1))weekDays.push(isoDate(d));
  const wkStudy=state.study.filter(inWk),wkTasks=state.tasks.filter(inWk),wkWorkouts=state.workouts.filter(inWk),wkQuran=state.quran.filter(inWk);
  const wkHabitDone=state.habits.reduce((s,h)=>s+weekDays.filter(d=>h.history?.[d]).length,0);
  const rows=[];
  rows.push(["Study",wkStudy.length?Math.round(wkStudy.filter(x=>x.done).length/wkStudy.length*100):null]);
  rows.push(["Tasks",wkTasks.length?Math.round(wkTasks.filter(x=>x.done).length/wkTasks.length*100):null]);
  rows.push(["Workouts",wkWorkouts.length?Math.round(wkWorkouts.filter(x=>x.done).length/wkWorkouts.length*100):null]);
  rows.push(["Habits",state.habits.length?Math.round(wkHabitDone/(state.habits.length*7)*100):null]);
  rows.push(["Quran",wkQuran.length?Math.round(wkQuran.filter(x=>x.done).length/wkQuran.length*100):null]);
  const snapshot=document.getElementById("weeklySnapshot");
  if(snapshot) snapshot.innerHTML=rows.map(([name,val])=>`<div class="analytics-bar-row"><span>${name}</span><div class="analytics-bar"><i style="width:${val==null?0:val}%"></i></div><strong>${val==null?"—":val+"%"}</strong></div>`).join("");
  const month=new Date().toISOString().slice(0,7);
  const spend=state.expenses.filter(x=>x.date?.startsWith(month)).reduce((a,x)=>a+Number(x.amount||0),0);
  const moneyEl=document.getElementById("aMoney");if(moneyEl)moneyEl.textContent=money(spend);
  const monthly={};state.expenses.forEach(x=>{const ym=x.date?x.date.slice(0,7):null;if(ym)monthly[ym]=(monthly[ym]||0)+Number(x.amount||0);});
  const now=new Date(),trendMonths=[];
  for(let i=5;i>=0;i--){const d=new Date(now.getFullYear(),now.getMonth()-i,1);const ym=d.toISOString().slice(0,7);trendMonths.push({ym,label:new Intl.DateTimeFormat(undefined,{month:"short"}).format(d),amount:monthly[ym]||0});}
  const max=Math.max(1,...trendMonths.map(m=>m.amount));
  const trend=document.getElementById("moneyTrend");
  if(trend) trend.innerHTML=Object.keys(monthly).length?trendMonths.map(m=>`<div class="analytics-bar-row"><span>${m.label}</span><div class="analytics-bar"><i style="width:${Math.round(m.amount/max*100)}%"></i></div><strong>${m.amount?money(m.amount):"0"}</strong></div>`).join(""):`<div class="empty-state">No spending yet. Add an expense to see the trend.</div>`;
  const stats=[];
  if(state.study.length) stats.push(["Study sessions",state.study.length]);
  if(state.tasks.filter(x=>!x.done).length) stats.push(["Tasks to do",state.tasks.filter(x=>!x.done).length]);
  if(state.quran.length) stats.push(["Quran completed",`${state.quran.filter(x=>x.done).length}/${state.quran.length}`]);
  if(state.meals.length) stats.push(["Meals planned",state.meals.length]);
  if(wkWorkouts.length) stats.push(["Workouts this week",wkWorkouts.length]);
  if(state.dikr.length) stats.push(["Dikr today",`${state.dikr.filter(x=>dikrCompleted(x,today)).length}/${state.dikr.length}`]);
  const saved=state.savings.reduce((a,g)=>a+Number(g.saved||0),0);
  if(saved>0) stats.push(["Savings",money(saved)]);
  const qs=document.getElementById("quickStats");
  if(qs) qs.innerHTML=stats.length?stats.map(([k,v])=>`<div class="dash-line"><span>${esc(k)}</span><strong>${esc(String(v))}</strong></div>`).join(""):`<div class="empty-state">No data yet — add tasks, expenses, and activities to see stats here.</div>`;
}

function openQuickAdd(){openForm("quick")}
let editingRecord=null;

function recordFor(type,id){
  const map={task:"tasks",study:"study",event:"events",expense:"expenses",habit:"habits",workout:"workouts",meal:"meals",grocery:"groceries",savings:"savings",dikr:"dikr",quran:"quran",reminder:"reminders"};
  return id && map[type] ? state[map[type]].find(x=>x.id===id) : null;
}
function actionButtons(type,id){
  return `<div class="item-actions">
    <button class="action-btn edit" title="Edit" onclick="openForm('${type}',undefined,'${id}')">✎</button>
    <button class="action-btn delete" title="Delete" onclick="deleteRecord('${type}','${id}')">×</button>
  </div>`;
}
function deleteRecord(type,id){
  const map={task:"tasks",study:"study",event:"events",expense:"expenses",habit:"habits",workout:"workouts",meal:"meals",grocery:"groceries",savings:"savings",dikr:"dikr",quran:"quran",reminder:"reminders"};
  const key=map[type]; if(!key)return;
  const item=state[key].find(x=>x.id===id); if(!item)return;
  const label=item.title||item.name||item.subject||item.type||"this item";
  if(!confirm(`Delete "${label}"?`))return;
  state[key]=state[key].filter(x=>x.id!==id);
  save();
  showToast("Deleted.");
}
function openForm(type,presetDate=isoDate(),editId=null){
  const form=document.getElementById("modalForm"), title=document.getElementById("modalTitle"), eyebrow=document.getElementById("modalEyebrow");
  editingRecord=editId?recordFor(type,editId):null;
  const r=editingRecord;
  const val=(key,fallback="")=>r?.[key] ?? fallback;
  let content="";
  if(type==="quick"){
    title.textContent="Quick add"; eyebrow.textContent="ONE TAP";
    content=`<div class="quick-grid">${[
      ["task","Task"],["study","Study session"],["event","Event"],["expense","Expense"],["habit","Habit"],["workout","Workout"],["meal","Meal"],["savings","Savings goal"],["grocery","Grocery"]
    ].map(([v,t])=>`<button type="button" class="secondary-btn" onclick="openForm('${v}')">${t}</button>`).join("")}</div>`;
  }else if(type==="task"){
    title.textContent=r?"Edit task":"Add task"; eyebrow.textContent="TASK";
    content=`<div class="form-grid">${field("Task title","title","text",val("title"),"required",true)}${field("Date","date","date",val("date",presetDate),"required")}${field("Time","time","time",val("time"))}${selectField("Category","category",["personal","study","workout","other"],val("category","personal"))}</div>`;
  }else if(type==="study"){
    title.textContent=r?"Edit study session":"New study session"; eyebrow.textContent="STUDY";
    content=`<div class="form-grid">${field("Subject","subject","text",val("subject"),"required")}${field("Topic","topic","text",val("topic"),"required")}${field("Chapter","chapter", "text", val("chapter"))}${field("Objective","objective","text",val("objective"),"",true)}${field("Date","date","date",val("date",presetDate),"required")}${field("Start time","time","time",val("time","17:00"))}${field("Duration (minutes)","duration","number",val("duration",60),"min='5'")}${selectField("Priority","priority",["low","medium","high"],val("priority","medium"))}${field("Notes","notes","textarea",val("notes"),"",true)}</div>`;
  }else if(type==="event"){
    title.textContent=r?"Edit event":"Add event"; eyebrow.textContent="CALENDAR";
    content=`<div class="form-grid">${field("Event title","title","text",val("title"),"required",true)}${field("Date","date","date",val("date",presetDate),"required")}${field("Time","time","time",val("time"))}${selectField("Type","type",["personal","task","study","workout"],val("type","personal"))}</div>`;
  }else if(type==="expense"){
    title.textContent=r?"Edit expense":"Add expense"; eyebrow.textContent="MONEY";
    content=`<div class="form-grid">${field("What was it?","title","text",val("title"),"required",true)}${field("Amount (DH)","amount","number",val("amount"),"step='0.01' min='0' required")}${field("Date","date","date",val("date",presetDate),"required")}${selectField("Category","category",["Food","School","Transport","Personal","Entertainment","Other"],val("category","Personal"))}</div>`;
  }else if(type==="workout"){
    title.textContent=r?"Edit workout":"Plan workout"; eyebrow.textContent="MOVEMENT";
    content=`<div class="form-grid">${selectField("Workout type","type",["Strength","Mobility","Walk","Cardio","Sport","Rest"],val("type","Strength"))}${field("Date","date","date",val("date",presetDate),"required")}${field("Start time","time","time",val("time"))}${field("Duration","duration","text",val("duration","45 min"))}${field("Exercises","exercises","text",val("exercises"),"",true)}${field("Sets / reps","sets","text",val("sets"),"",true)}${field("Notes","notes","textarea",val("notes"),"",true)}</div>`;
  }else if(type==="meal"){
    title.textContent=r?"Edit meal":"Add meal"; eyebrow.textContent="MEALS";
    content=`<div class="form-grid">${selectField("Meal","slot",["Breakfast","Lunch","Dinner","Snack"],val("slot","Lunch"))}${field("Date","date","date",val("date",presetDate),"required")}${field("Meal name","name","text",val("name"),"required",true)}${field("Ingredients","ingredients","text",val("ingredients"),"",true)}</div>`;
  }else if(type==="grocery"){
    title.textContent=r?"Edit grocery item":"Add grocery item"; eyebrow.textContent="SHOPPING";
    content=`<div class="form-grid">${field("Ingredient","name","text",val("name"),"required",true)}</div>`;
  }else if(type==="savings"){
    title.textContent=r?"Edit savings goal":"Create savings goal"; eyebrow.textContent="SAVINGS";
    content=`<div class="form-grid">${field("Goal name","name","text",val("name"),"required",true)}${field("Target amount (DH)","target","number",val("target"),"min='0' step='0.01' required")}${field("Already saved (DH)","saved","number",val("saved",0),"min='0' step='0.01'")}${field("Target date","date","date",val("date",presetDate),"required")}</div>`;
  }else if(type==="habit"){
    title.textContent=r?"Edit habit":"New habit"; eyebrow.textContent="HABIT";
    content=`<div class="form-grid">${field("Habit name","name","text",val("name"),"required",true)}</div>`;
  }else if(type==="dikr"){
    title.textContent=r?"Edit Dikr":"Add Dikr"; eyebrow.textContent="DIKR";
    content=`<div class="form-grid">${field("Dikr name","name","text",val("name"),"required",true)}${field("Daily target (repetitions)","target","number",val("target",1),"min='1' required",true)}</div>`;
  }else if(type==="quran"){
    title.textContent=r?"Edit Quran session":"Quran session"; eyebrow.textContent="QURAN";
    content=`<div class="form-grid">${field("Surah","surah","text",val("surah"),"required")}${field("Ayah range","ayahRange","text",val("ayahRange"),"required")}${selectField("Session type","qType",["Memorisation","Revision"],val("type","Memorisation"))}${field("Date","date","date",val("date",presetDate),"required")}${field("Time","time","time",val("time"))}${selectField("Confidence","confidence",["steady","building","strong"],val("confidence","steady"))}${field("Notes","notes","textarea",val("notes"),"",true)}</div>`;
  }else if(type==="reminder"){
    title.textContent=r?"Edit reminder":"Add reminder"; eyebrow.textContent="REMINDER";
    const recur=val("recur","once");
    content=`<div class="form-grid">${field("Reminder title","title","text",val("title"),"required",true)}${field("Message","message","textarea",val("message"),"",true)}${selectField("Repeats","recur",["once","daily","weekly"],recur)}${field("Date","date","date",val("date",presetDate),recur==="once"?"required":"")}${field("Time","time","time",val("time","09:00"),"required")}</div>
      <div class="hint">Daily reminders fire every day at the chosen time; weekly reminders fire on the chosen weekday. Date only applies to one-time reminders.</div>`;
  }
  form.innerHTML=content+`<div class="form-actions">${type!=="quick"?`<button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">${r?"Save changes":"Save"}</button>`:""}</div>`;
  form.onsubmit=e=>{e.preventDefault();handleForm(type,new FormData(form),editId)};
  document.getElementById("modalBackdrop").classList.add("open");
}
function closeModal(){document.getElementById("modalBackdrop").classList.remove("open");editingRecord=null}
function handleForm(type,fd,editId=null){
  const d=Object.fromEntries(fd.entries());
  const map={task:"tasks",study:"study",event:"events",expense:"expenses",workout:"workouts",meal:"meals",grocery:"groceries",savings:"savings",habit:"habits",dikr:"dikr",quran:"quran",reminder:"reminders"};
  const key=map[type];
  if(editId && key){
    const item=state[key]?.find(x=>x.id===editId);
    if(item){
      if(type==="study") Object.assign(item,d,{duration:Number(d.duration||60)});
      else if(type==="expense") Object.assign(item,d,{amount:Number(d.amount||0)});
      else if(type==="savings") Object.assign(item,d,{target:Number(d.target||0),saved:Number(d.saved||0)});
      else if(type==="habit") item.name=d.name;
      else if(type==="reminder"){ Object.assign(item,d); if(d.recur!=="once") item.date=""; }
      else if(type==="dikr"){ item.name=d.name; item.target=Number(d.target)||1; }
      else if(type==="quran"){d.type=d.qType;delete d.qType;Object.assign(item,d)}
      else Object.assign(item,d);
    }
  }else{
    if(type==="task") state.tasks.push({id:uid("task"),...d,done:false});
    if(type==="study") state.study.push({id:uid("study"),...d,duration:Number(d.duration||60),done:false});
    if(type==="event") state.events.push({id:uid("event"),...d});
    if(type==="expense") state.expenses.push({id:uid("expense"),...d,amount:Number(d.amount||0)});
    if(type==="workout") state.workouts.push({id:uid("workout"),...d,done:false});
    if(type==="meal") state.meals.push({id:uid("meal"),...d});
    if(type==="grocery") state.groceries.push({id:uid("grocery"),...d,done:false});
    if(type==="savings") state.savings.push({id:uid("saving"),...d,target:Number(d.target||0),saved:Number(d.saved||0)});
    if(type==="habit") state.habits.push({id:uid("habit"),name:d.name,history:{}});
    if(type==="dikr") state.dikr.push({id:uid("dikr"),name:d.name,target:Number(d.target)||1,history:{}});
    if(type==="quran"){d.type=d.qType;delete d.qType;state.quran.push({id:uid("quran"),...d,done:false})}
    if(type==="reminder"){ if(d.recur!=="once") d.date=""; state.reminders.push({id:uid("reminder"),...d,lastFired:""}); }
  }
  closeModal();save();showToast(editId?"Updated.":"Added.");
}

function openWeeklyReset(){
  document.getElementById("modalEyebrow").textContent="WEEKLY RESET";
  document.getElementById("modalTitle").textContent="Prepare your next week";
  document.getElementById("modalForm").innerHTML=`
    <div class="form-grid">
      ${field("What do I need to study?","studyNeeds","textarea","","",true)}
      ${field("Subjects / topics","subjects","textarea","","",true)}
      ${field("Which workouts?","workouts","textarea","","",true)}
      ${field("Which meals?","meals","textarea","","",true)}
      ${field("Which habits?","habits","textarea","","",true)}
      ${field("Quran memorisation / revision","quran","textarea","","",true)}
      ${field("Dikr","dikr","textarea","","",true)}
      ${field("Expenses / savings goals","money","textarea","","",true)}
      ${field("Important tasks","tasks","textarea","","",true)}
    </div>
    <p class="modal-note">Tip: put one item per line. Items are spread across the seven days starting Monday. Use <strong>Mon:</strong>, <strong>Tue:</strong>, etc. to choose a specific day.</p>
    <div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">Create weekly draft</button></div>`;

  document.getElementById("modalForm").onsubmit=e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const values=Object.fromEntries(fd.entries());
    const start=startOfWeek(weekCursor);
    const dayMap={mon:0,monday:0,tue:1,tuesday:1,wed:2,wednesday:2,thu:3,thursday:3,fri:4,friday:4,sat:5,saturday:5,sun:6,sunday:6};
    let created=0;

    function lines(text=""){
      return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    }
    function dateFor(line,index){
      const match=line.match(/^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*:\s*/i);
      const clean=match?line.slice(match[0].length).trim():line;
      const key=match?match[1].toLowerCase():null;
      const offset=key!=null?dayMap[key]:Math.min(index,6);
      const d=new Date(start); d.setDate(start.getDate()+offset);
      return {date:isoDate(d),text:clean};
    }

    lines(values.studyNeeds).forEach((line,i)=>{const x=dateFor(line,i);state.tasks.push({id:uid("task"),title:`Study: ${x.text}`,date:x.date,time:"",category:"study",done:false});created++});
    lines(values.subjects).forEach((line,i)=>{const x=dateFor(line,i);state.study.push({id:uid("study"),date:x.date,time:"",duration:60,subject:x.text,topic:"",chapter:"",objective:"",priority:"medium",notes:"Weekly reset",done:false});created++});
    lines(values.workouts).forEach((line,i)=>{const x=dateFor(line,i);state.workouts.push({id:uid("workout"),type:x.text,date:x.date,time:"",duration:"45 min",exercises:"",sets:"",notes:"Weekly reset",done:false});created++});
    lines(values.meals).forEach((line,i)=>{const x=dateFor(line,i);state.meals.push({id:uid("meal"),slot:"Lunch",date:x.date,name:x.text,ingredients:""});created++});
    lines(values.habits).forEach(line=>{if(!state.habits.some(h=>h.name.toLowerCase()===line.toLowerCase())){state.habits.push({id:uid("habit"),name:line,history:{}});created++}});
    lines(values.quran).forEach((line,i)=>{const x=dateFor(line,i);state.quran.push({id:uid("quran"),surah:x.text,ayahRange:"",type:"Memorisation",date:x.date,time:"",confidence:"steady",notes:"Weekly reset",done:false});created++});
    lines(values.dikr).forEach(line=>{if(!state.dikr.some(d=>d.name.toLowerCase()===line.toLowerCase())){state.dikr.push({id:uid("dikr"),name:line,target:1,history:{}});created++}});
    lines(values.money).forEach((line,i)=>{const x=dateFor(line,i);state.tasks.push({id:uid("task"),title:`Money: ${x.text}`,date:x.date,time:"",category:"personal",done:false});created++});
    lines(values.tasks).forEach((line,i)=>{const x=dateFor(line,i);state.tasks.push({id:uid("task"),title:x.text,date:x.date,time:"",category:"personal",done:false});created++});

    save();
    closeModal();
    alert(created?`Weekly draft created with ${created} item${created===1?"":"s"}.`:"No items were entered, so nothing was created.");
  };
  document.getElementById("modalBackdrop").classList.add("open");
}

function openWeeklyResetConfirm(){
  document.getElementById("modalEyebrow").textContent="WEEKLY RESET";
  document.getElementById("modalTitle").textContent="Reset this week?";
  document.getElementById("modalForm").innerHTML=`
    <p class="modal-note">This will clear the current week's planner items (Study, Tasks, Workouts, Meals, Quran, Events) and reset this week's Habit & Dikr completion.\nYour Money History, Savings, settings, and all past data will not be deleted.</p>
    <div class="form-actions">
      <button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button>
      <button type="button" class="danger-btn" id="resetConfirmBtn" onclick="performWeeklyReset()">Reset Week</button>
    </div>`;
  document.getElementById("modalBackdrop").classList.add("open");
}

function performWeeklyReset(){
  const btn=document.getElementById("resetConfirmBtn"); if(btn) btn.disabled=true;
  const start=startOfWeek(weekCursor), end=new Date(start); end.setDate(end.getDate()+6);
  const startIso=isoDate(start), endIso=isoDate(end);
  const inWeek=x=>x>=startIso&&x<=endIso;
  const days=[]; for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)) days.push(isoDate(d));
  try{
    state.study=state.study.filter(x=>!inWeek(x.date));
    state.tasks=state.tasks.filter(x=>!inWeek(x.date));
    state.workouts=state.workouts.filter(x=>!inWeek(x.date));
    state.meals=state.meals.filter(x=>!inWeek(x.date));
    state.quran=state.quran.filter(x=>!inWeek(x.date));
    state.events=state.events.filter(x=>!inWeek(x.date));
    state.habits.forEach(h=>{ h.history=h.history||{}; days.forEach(dt=>delete h.history[dt]); });
    state.dikr.forEach(x=>{ x.history=x.history||{}; days.forEach(dt=>delete x.history[dt]); });
    save();
    closeModal();
    showToast("Week reset successfully.");
  }catch(err){
    if(btn) btn.disabled=false;
    console.error("Weekly reset failed:",err);
    closeModal();
    showToast("Couldn't reset the week. Please try again.",true);
  }
}

function showToast(msg,isError=false){
  const t=document.getElementById("toast"); if(!t) return;
  t.textContent=msg;
  t.classList.toggle("error",isError);
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove("show"),3200);
}

function exportData(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`lifeos-backup-${isoDate()}.json`;a.click();URL.revokeObjectURL(a.href);
}
document.getElementById("exportBtn").onclick=exportData;
document.getElementById("importInput").onchange=e=>{
  const file=e.target.files[0];if(!file)return;
  const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(reader.result);Object.keys(state).forEach(k=>delete state[k]);Object.assign(state,incoming);save();alert("Backup imported.");}catch{alert("That backup file could not be read.")}};reader.readAsText(file);
};
document.getElementById("resetBtn").onclick=()=>{
  if(confirm("Reset all local LifeOS data? This cannot be undone.")){localStorage.removeItem(STORAGE_KEY);location.reload()}
};


// Dikr helpers — each Dikr owns target + per-date count history (single source of truth).
function dikrCount(x,date){ return Number(x.history?.[date]||0); }
function dikrCompleted(x,date){ return dikrCount(x,date) >= Number(x.target||1); }

function renderDikr(){
  const today=isoDate();
  // Today's completed Dikr (target reached).
  const done=state.dikr.filter(x=>dikrCompleted(x,today)).length;
  document.getElementById("dikrTodayCount").textContent=`${done} / ${state.dikr.length}`;
  document.getElementById("dikrTodayBar").style.width=(state.dikr.length?done/state.dikr.length*100:0)+"%";
  // Connected summary card: total repetitions today vs total target.
  const totalCount=state.dikr.reduce((s,x)=>s+dikrCount(x,today),0);
  const totalTarget=state.dikr.reduce((s,x)=>s+Number(x.target||1),0);
  const totalEl=document.getElementById("dikrTotalCount");
  if(totalEl) totalEl.textContent=`${totalCount} / ${totalTarget}`;
  const totalBar=document.getElementById("dikrTotalBar");
  if(totalBar) totalBar.style.width=(totalTarget?Math.min(100,Math.round(totalCount/totalTarget*100)):0)+"%";
  // List: each Dikr shows its own counter and a tap button.
  document.getElementById("dikrList").innerHTML=state.dikr.map(x=>{
    const c=dikrCount(x,today), t=Number(x.target||1), done=c>=t;
    return `<div class="list-item dikr-item ${done?"done":""}">
      <div><strong>${esc(x.name)}</strong><small>${done?"Completed today":"Tap to count"}</small></div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="dikr-count"><strong>${c}</strong><em>/ ${t}</em></span>
        <button class="dikr-tap${done?" done":""}" onclick="tapDikr('${x.id}')" ${done?"disabled":""} aria-label="Count ${esc(x.name)}">${done?"✓":"＋"}</button>
        <button class="icon-btn small-btn" onclick="editDikr('${x.id}')">✎</button>
        <button class="icon-btn small-btn" onclick="deleteDikr('${x.id}')">×</button>
      </div>
    </div>`;
  }).join("")||`<div class="empty-state">No Dikr added yet.</div>`;
}

// Tap only increases THIS Dikr's count for today, capped at its target.
// Reaching the target auto-marks it completed. Errors roll back with a toast.
function tapDikr(id){
  const x=state.dikr.find(x=>x.id===id);
  if(!x) return;
  const today=isoDate(), target=Number(x.target||1);
  x.history=x.history||{};
  const cur=dikrCount(x,today);
  if(cur>=target) return;           // no over-counting past the target
  x.history[today]=cur+1;           // optimistic
  try{
    save();                          // persists + re-renders ALL views (single source)
  }catch(err){
    // rollback on failure — do not pretend it saved
    if(cur===0) delete x.history[today]; else x.history[today]=cur;
    console.error("Failed to update Dikr:",err);
    try{ renderAll(); }catch(_d){}
    showToast("Couldn't update Dikr. Please try again.",true);
  }
}
function deleteDikr(id){if(confirm("Delete this Dikr?")){state.dikr=state.dikr.filter(x=>x.id!==id);save();showToast("Dikr deleted.")}}
function editDikr(id){openForm("dikr",null,id)}

function renderQuran(){
  const today=isoDate(), start=startOfWeek(new Date()), end=new Date(start);end.setDate(end.getDate()+6);
  const week=state.quran.filter(x=>x.date>=isoDate(start)&&x.date<=isoDate(end));
  document.getElementById("quranWeekCount").textContent=week.length;
  document.getElementById("quranMemCount").textContent=state.quran.filter(x=>x.type==="Memorisation").length;
  document.getElementById("quranRevCount").textContent=state.quran.filter(x=>x.type==="Revision").length;
  // Daily goal: counts only COMPLETED sessions — a created session is NOT complete.
  const goal=Number(state.settings.quranDailyGoal||1);
  const todayDone=state.quran.filter(x=>x.date===today&&x.done).length;
  document.getElementById("quranGoalValue").textContent=`${Math.min(todayDone,goal)} / ${goal}`;
  document.getElementById("quranGoalBar").style.width=Math.min(todayDone/Math.max(goal,1)*100,100)+"%";
  document.getElementById("quranList").innerHTML=state.quran.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(x=>`
    <div class="list-item quran-item ${x.done?"done":""}">
      <div><strong class="${x.done?"completed":""}">${esc(x.surah)} · ${esc(x.ayahRange)}</strong><small>${fmtDate(x.date)} · ${esc(x.type)}${x.notes?" · "+esc(x.notes):""}</small></div>
      <div style="display:flex;gap:7px;align-items:center"><span class="quran-status ${x.done?"done":""}">${x.done?"Completed":"Planned"}</span><span class="quran-type">${esc(x.confidence||"steady")}</span><button class="check ${x.done?"done":""}" onclick="toggleQuranDone('${x.id}')">${x.done?"✓":""}</button><button class="icon-btn small-btn" onclick="editQuran('${x.id}')">✎</button><button class="icon-btn small-btn" onclick="deleteQuran('${x.id}')">×</button></div>
    </div>`).join("")||`<div class="empty-state">No Quran sessions recorded yet.</div>`;
}
// Toggle a Quran session between Planned and Completed, with rollback on save failure.
function toggleQuranDone(id){
  const x=state.quran.find(x=>x.id===id);
  if(!x) return;
  x.done=!x.done;
  try{
    save();
  }catch(err){
    x.done=!x.done;   // rollback — no false success
    console.error("Failed to update Quran session:",err);
    try{ renderAll(); }catch(_d){}
    showToast("Couldn't update Quran session. Please try again.",true);
  }
}
function deleteQuran(id){if(confirm("Delete this Quran session?")){state.quran=state.quran.filter(x=>x.id!==id);save();showToast("Quran session deleted.")}}
function editQuran(id){openForm("quran",null,id)}

// ---- School Timetable ----
// Isolated, fixed reference schedule. Data lives in state.timetable
// { days:[], slots:[], cells:{"<slotIdx>|<dayIdx>":"subject"} } and is persisted
// through the existing save() single-source-of-truth (no other LifeOS data is touched).
function ttKey(si,di){ return si+"|"+di; }
function ttCell(si,di){ const t=state.timetable; return (t&&t.cells)?(t.cells[ttKey(si,di)]||""):""; }
function ttSave(){ try{ save(); }catch(e){ console.error("Failed to save timetable:",e); try{ renderAll(); }catch(_){} showToast("Couldn't save timetable. Please try again.",true); } }

function renderTimetable(){
  const box=document.getElementById("timetableBox");
  if(!box) return;
  const t=state.timetable;
  if(!t || !t.days || !t.days.length){
    box.innerHTML=`<div class="card empty-card"><div class="empty-state">No school timetable yet<br><span class="small">Create your school timetable to quickly see your weekly class schedule.</span></div><div class="timetable-actions"><button class="primary-btn" onclick="createTimetable()">＋ Create timetable</button></div></div>`;
    return;
  }
  let html=`<div class="card timetable-card"><table class="timetable"><thead><tr><th class="tt-time">Time</th>`;
  html+=t.days.map((d,di)=>`<th class="tt-day"><div class="tt-day-head"><input class="tt-day-input" value="${esc(d)}" data-i="${di}" aria-label="Day ${di+1}" /><button class="tt-x" onclick="deleteDay(${di})" title="Remove day">×</button></div></th>`).join("");
  html+=`</tr></thead><tbody>`;
  t.slots.forEach((slot,si)=>{
    html+=`<tr><td class="tt-time"><input class="tt-time-input" value="${esc(slot)}" data-i="${si}" aria-label="Time slot ${si+1}" /></td>`;
    html+=t.days.map((d,di)=>`<td class="tt-cell"><input class="tt-subj-input" value="${esc(ttCell(si,di))}" data-si="${si}" data-di="${di}" aria-label="Subject ${di+1}" /></td>`).join("");
    html+=`<td class="tt-ops"><button class="tt-x" onclick="deleteSlot(${si})" title="Delete time slot">×</button></td></tr>`;
  });
  html+=`</tbody></table></div><div class="timetable-actions"><button class="secondary-btn" onclick="addSlot()">＋ Time slot</button><button class="secondary-btn" onclick="addDay()">＋ Day</button></div>`;
  box.innerHTML=html;
}
function createTimetable(){ state.timetable={days:["Monday","Tuesday","Wednesday","Thursday","Friday"],slots:["08:00 - 09:00"],cells:{}}; ttSave(); }
function addSlot(){ const t=state.timetable; if(!t)return; t.slots.push(""); ttSave(); }
function addDay(){ const t=state.timetable; if(!t)return; t.days.push("Day "+(t.days.length+1)); ttSave(); }
function deleteSlot(si){
  const t=state.timetable; if(!t)return;
  if(!confirm("Delete this time slot? It only affects the timetable."))return;
  t.slots.splice(si,1);
  const nc={};
  t.days.forEach((_,di)=>t.slots.forEach((_,ni)=>{ const oi=ni<si?ni:ni+1; const v=t.cells[ttKey(oi,di)]; if(v!==undefined) nc[ttKey(ni,di)]=v; }));
  t.cells=nc; ttSave();
}
function deleteDay(di){
  const t=state.timetable; if(!t)return;
  if(!confirm("Remove this day column?"))return;
  t.days.splice(di,1);
  const nc={};
  t.slots.forEach((_,si)=>t.days.forEach((_,nd)=>{ const od=nd<di?nd:nd+1; const v=t.cells[ttKey(si,od)]; if(v!==undefined) nc[ttKey(si,nd)]=v; }));
  t.cells=nc; ttSave();
}
// Inline editing auto-persists on blur/Enter (change).
function onTimetableEdit(inp){
  const t=state.timetable; if(!t) return;
  if(inp.classList.contains("tt-day-input")){ const i=Number(inp.dataset.i); if(t.days[i]!==undefined) t.days[i]=inp.value.trim(); }
  else if(inp.classList.contains("tt-time-input")){ const i=Number(inp.dataset.i); if(t.slots[i]!==undefined) t.slots[i]=inp.value.trim(); }
  else if(inp.classList.contains("tt-subj-input")){ const si=Number(inp.dataset.si), di=Number(inp.dataset.di); const v=inp.value.trim(); const k=ttKey(si,di); if(v) t.cells[k]=v; else delete t.cells[k]; }
  ttSave();
}
document.addEventListener("change",e=>{ if(e.target && e.target.matches && e.target.matches(".tt-day-input,.tt-time-input,.tt-subj-input")) onTimetableEdit(e.target); });

function renderAll(){
  applyTheme();refreshProfile();renderDashboard();renderPlanner();renderWeek();renderStudy();renderHabits();renderMoney();renderWorkouts();renderMeals();renderSavings();renderTimetable();renderDikr();renderQuran();renderAnalytics();renderOutfits();renderMyDay();renderGoalsAndInspiration();renderReminders();renderNotifyMenu();updateBellBadge();
}

/* ============ OUTFITS & DIGITAL WARDROBE ============ */
const WARDROBE_CATEGORIES=["Tops","Bottoms","Dresses","Outerwear","Shoes","Bags","Accessories"];
const WARDROBE_SEASONS=["Any","Spring","Summer","Autumn","Winter"];
const OUTFIT_DAYNAMES=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

let outfitView="week";
let outfitCursor=new Date();
let closetCat="all";
let allFilterCat="all";
let allSeason="all";
let allSort="newest";
let modalClothingId=null, pendingPhoto="";
let modalOutfitId=null, pendingOutfitSet=new Set();

// --- Safe wardrobe init (never wipes other data). Wardrobe lives in the persisted single-source state.
if(!Array.isArray(state.clothing)) state.clothing=[];
if(!Array.isArray(state.outfits)) state.outfits=[];
if(!Array.isArray(state.plans)) state.plans=[];
state.clothing=state.clothing.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&typeof x.id==="string");
state.outfits=state.outfits.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&typeof x.id==="string"&&Array.isArray(x.pieces));
state.plans=state.plans.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&x.date&&x.outfitId&&state.outfits.some(o=>o.id===x.outfitId));

const getClothing=()=>state.clothing||[];
const getOutfits=()=>state.outfits||[];
const getPlans=()=>state.plans||[];
function getPlan(date){ return getPlans().find(p=>p.date===date); }
function getOutfit(id){ return getOutfits().find(o=>o.id===id); }
function wardrobeSave(){ try{ save(); }catch(e){ console.error("Wardrobe save failed:",e); showToast("Couldn't save — storage may be full. Try a smaller photo.",true); } }
function setModal(eyebrow,title){ document.getElementById("modalEyebrow").textContent=eyebrow; document.getElementById("modalTitle").textContent=title; }

// ---- Image read + resize so photos fit safely in the localStorage quota.
function readImage(file, cb){
  const reader=new FileReader();
  reader.onload=()=>{
    const img=new Image();
    img.onload=()=>{
      const max=620; let w=img.width,h=img.height;
      if(Math.max(w,h)>max){ const s=max/Math.max(w,h); w=Math.round(w*s); h=Math.round(h*s); }
      const canvas=document.createElement("canvas"); canvas.width=w; canvas.height=h;
      try{ canvas.getContext("2d").drawImage(img,0,0,w,h); cb(canvas.toDataURL("image/jpeg",0.82)); }
      catch(e){ cb(reader.result); }
    };
    img.onerror=()=>cb(reader.result);
    img.src=reader.result;
  };
  reader.readAsDataURL(file);
}

// ---- Thumbnails (closet + gallery)
function pieceThumbs(ids){
  if(!ids||!ids.length) return "";
  return ids.map(id=>{ const p=getClothing().find(x=>x.id===id); if(!p) return ""; return p.photo?`<img src="${p.photo}" alt="${esc(p.name||'')}" title="${esc(p.name||'')}">`:`<span class="thumb-ph" title="${esc(p.name||'')}">${esc((p.name||"?").charAt(0).toUpperCase())}</span>`; }).join("");
}
function clothingThumb(x){
  return `<button type="button" class="cloth-thumb" onclick="viewClothing('${x.id}')" title="${esc(x.name)}">
    ${x.photo?`<img src="${x.photo}" alt="${esc(x.name)}">`:`<span class="thumb-ph">👕</span>`}
    <span class="thumb-overlay">
      <span class="thumb-name">${esc(x.name)}</span>
      <span class="thumb-actions">
        <span class="thumb-edit" title="Edit" onclick="event.stopPropagation();openClothingForm('${x.id}')">✎</span>
        <span class="thumb-del" title="Delete" onclick="event.stopPropagation();deleteClothing('${x.id}')">×</span>
      </span>
    </span>
  </button>`;
}

// ---- My Closet
function renderCloset(){
  const catsEl=document.getElementById("closetCats"), grid=document.getElementById("closetGrid");
  const q=(document.getElementById("closetSearch").value||"").trim().toLowerCase();
  const total=getClothing().length;
  catsEl.innerHTML=`<button class="closet-cat ${closetCat==="all"?"active":""}" onclick="setClosetCat('all')"><span>All</span><em>${total}</em></button>`+
    WARDROBE_CATEGORIES.map(c=>{const n=getClothing().filter(x=>x.category===c).length;return `<button class="closet-cat ${closetCat===c?"active":""}" onclick="setClosetCat('${c}')"><span>${esc(c)}</span><em>${n}</em></button>`;}).join("");
  const items=getClothing().filter(x=>(closetCat==="all"||x.category===closetCat)&&(!q||(x.name||"").toLowerCase().includes(q)));
  if(!items.length){
    grid.innerHTML=`<div class="outfit-empty">${total===0?"Your closet is empty.<br>Add your first clothing item to get started.":`No items match ${q?`&quot;${esc(q)}&quot;`:"this category"}.`}</div>`;
    return;
  }
  grid.innerHTML=items.map(clothingThumb).join("");
}
function setClosetCat(c){ closetCat=c; renderCloset(); }

// ---- All My Clothing gallery
function buildAllFilters(){
  const sel=document.getElementById("allFilter"); if(!sel) return;
  sel.innerHTML=`<option value="all">All Categories</option>`+WARDROBE_CATEGORIES.map(c=>`<option value="${c}">${c}</option>`).join("");
  const sea=document.getElementById("allSeason"); if(!sea) return;
  sea.innerHTML=`<option value="all">All Seasons</option>`+WARDROBE_SEASONS.map(s=>`<option value="${s}">${s}</option>`).join("");
}
function renderAllClothing(){
  const grid=document.getElementById("allGrid");
  let items=getClothing().filter(x=>
    (allFilterCat==="all"||x.category===allFilterCat)&&
    (allSeason==="all"||(x.season||"Any")===allSeason));
  if(allSort==="name") items=[...items].sort((a,b)=>a.name.localeCompare(b.name));
  else if(allSort==="category") items=[...items].sort((a,b)=>a.category.localeCompare(b.category));
  else items=[...items].sort((a,b)=>b.id.localeCompare(a.id));
  grid.innerHTML=items.length?items.map(clothingThumb).join(""):`<div class="outfit-empty">${(allFilterCat!=="all"||allSeason!=="all")?"No clothing matches your filters.":"Your wardrobe is empty."}</div>`;
}

// ---- Clothing CRUD
function openClothingForm(id){
  const r=id?getClothing().find(x=>x.id===id):null;
  modalClothingId=id||null; pendingPhoto="";
  setModal(r?"EDIT CLOTHING":"ADD CLOTHING", r?"Edit clothing":"Add clothing");
  const form=document.getElementById("modalForm");
  const preview=r&&r.photo?`<img src="${r.photo}" alt="preview">`:`<span class="photo-add">＋ Upload photo</span>`;
  form.innerHTML=`<div class="form-grid">
    <div class="field full"><label>Photo</label>
      <label class="photo-upload" for="clothingPhotoInput">${preview}</label>
      <input type="file" id="clothingPhotoInput" accept="image/*" hidden>
    </div>
    ${field("Name","clothingName","text",r?r.name:"","required",true)}
    ${selectField("Category","clothingCategory",WARDROBE_CATEGORIES,r?r.category:WARDROBE_CATEGORIES[0])}
    ${field("Color (optional)","clothingColor","text",r?r.color:"")}
    ${selectField("Season (optional)","clothingSeason",WARDROBE_SEASONS,r?r.season:"Any")}
    ${field("Notes (optional)","clothingNotes","textarea",r?r.notes:"","",true)}
  </div>
  <div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">${r?"Save changes":"Save"}</button></div>`;
  form.onsubmit=e=>{e.preventDefault();saveClothing(form);};
  document.getElementById("clothingPhotoInput").onchange=ev=>{
    const f=ev.target.files[0]; if(!f) return;
    readImage(f,img=>{ pendingPhoto=img; const up=document.querySelector(".photo-upload"); if(up) up.innerHTML=`<img src="${img}" alt="preview">`; });
  };
  document.getElementById("modalBackdrop").classList.add("open");
}
function saveClothing(form){
  const fd=new FormData(form);
  const name=(fd.get("clothingName")||"").trim(); if(!name) return;
  const category=fd.get("clothingCategory"), color=(fd.get("clothingColor")||"").trim(),
        season=fd.get("clothingSeason"), notes=(fd.get("clothingNotes")||"").trim();
  if(modalClothingId){
    const item=getClothing().find(x=>x.id===modalClothingId);
    if(item){ item.name=name; item.category=category; item.color=color; item.season=season; item.notes=notes; if(pendingPhoto) item.photo=pendingPhoto; }
  }else{
    state.clothing.push({id:uid("cloth"),name,category,color,season,notes,photo:pendingPhoto||""});
  }
  pendingPhoto=""; modalClothingId=null;
  wardrobeSave(); closeModal(); showToast("Saved.");
}
function viewClothing(id){
  const x=getClothing().find(c=>c.id===id); if(!x) return;
  setModal("CLOTHING", x.name);
  const form=document.getElementById("modalForm"); form.onsubmit=null;
  form.innerHTML=`<div class="clothing-view">
    <div class="clothing-view-photo">${x.photo?`<img src="${x.photo}" alt="${esc(x.name)}">`:`<div class="empty-photo">No photo</div>`}</div>
    <div class="clothing-view-meta">
      <p><strong>CATEGORY</strong><span>${esc(x.category)}</span></p>
      ${x.color?`<p><strong>COLOR</strong><span>${esc(x.color)}</span></p>`:""}
      ${x.season&&x.season!=="Any"?`<p><strong>SEASON</strong><span>${esc(x.season)}</span></p>`:""}
      ${x.notes?`<p><strong>NOTES</strong><span>${esc(x.notes)}</span></p>`:""}
    </div>
  </div>
  <div class="form-actions outfit-view-actions">
    <button type="button" class="secondary-btn" onclick="closeModal();openClothingForm('${x.id}')">✎ Edit</button>
    <button type="button" class="danger-btn" onclick="deleteClothing('${x.id}')">Delete</button>
    <button type="button" class="secondary-btn" onclick="closeModal()">Close</button>
  </div>`;
  document.getElementById("modalBackdrop").classList.add("open");
}
function deleteClothing(id){
  const x=getClothing().find(c=>c.id===id); if(!x) return;
  if(!confirm(`Delete "${x.name}"? This also removes it from any outfits.`)) return;
  state.clothing=state.clothing.filter(c=>c.id!==id);
  state.outfits.forEach(o=>{ o.pieces=(o.pieces||[]).filter(p=>p!==id); });
  state.outfits=state.outfits.filter(o=>o.pieces.length>0);
  state.plans=state.plans.filter(p=>state.outfits.some(o=>o.id===p.outfitId));
  save(); showToast("Deleted.");
}

// ---- Outfit builder
function openOutfitForm(id, assignDate){
  const r=id?getOutfit(id):null;
  modalOutfitId=id||null; pendingOutfitSet=new Set(r?(r.pieces||[]):[]);
  setModal("PLAN OUTFIT", r?"Edit outfit":"Plan an outfit");
  const form=document.getElementById("modalForm");
  const items=getClothing();
  if(!items.length){
    form.innerHTML=`<div class="empty-state">Your closet is empty.<br>Add a few clothing items first, then plan outfits from them.</div>
    <div class="form-actions"><button type="button" class="primary-btn" onclick="closeModal();openClothingForm()">＋ Add clothing</button></div>`;
    form.onsubmit=null; document.getElementById("modalBackdrop").classList.add("open"); return;
  }
  const dateField = assignDate ? `<input type="hidden" name="assignDate" value="${assignDate}">` : field("Plan for date (optional)","assignDate","date","","",true);
  form.innerHTML=`<div class="form-grid">
    ${field("Outfit name (optional)","outfitName","text",r?r.name:"","",true)}
    <div class="field full"><label>Select clothing pieces</label>
      <div class="piece-picker">${items.map(it=>`<button type="button" class="piece ${pendingOutfitSet.has(it.id)?"selected":""}" data-id="${it.id}" onclick="togglePiece('${it.id}',this)">${it.photo?`<img src="${it.photo}" alt="">`:""}<span>${esc(it.name)}</span></button>`).join("")}</div>
    </div>
    ${dateField}
  </div>
  <div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">${r?"Save changes":"Plan outfit"}</button></div>`;
  form.onsubmit=e=>{e.preventDefault();saveOutfit(form);};
  document.getElementById("modalBackdrop").classList.add("open");
}
function togglePiece(id,btn){ if(pendingOutfitSet.has(id))pendingOutfitSet.delete(id); else pendingOutfitSet.add(id); btn.classList.toggle("selected",pendingOutfitSet.has(id)); }
function saveOutfit(form){
  const fd=new FormData(form);
  const name=(fd.get("outfitName")||"").trim();
  const pieces=[...pendingOutfitSet];
  if(!pieces.length){ showToast("Select at least one clothing piece.",true); return; }
  let outfitId=modalOutfitId;
  if(outfitId){ const o=getOutfit(outfitId); if(o){ o.name=name; o.pieces=pieces; } }
  else{ const o={id:uid("outfit"),name,pieces}; state.outfits.push(o); outfitId=o.id; }
  const date=fd.get("assignDate");
  if(date){ state.plans=state.plans.filter(p=>p.date!==date); state.plans.push({id:uid("plan"),date,outfitId}); }
  pendingOutfitSet=new Set(); modalOutfitId=null;
  wardrobeSave(); closeModal(); showToast("Saved.");
}
function deleteOutfit(id){
  const o=getOutfit(id); if(!o) return;
  if(!confirm("Delete this outfit?")) return;
  state.outfits=state.outfits.filter(x=>x.id!==id);
  state.plans=state.plans.filter(p=>p.outfitId!==id);
  save(); showToast("Deleted.");
}

// ---- Planning a day
function openOutfitForDate(date){
  setModal("OUTFIT PLANNER", new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(new Date(date+"T12:00:00")));
  const form=document.getElementById("modalForm"); form.onsubmit=null;
  const existing=getPlan(date); const existingOutfit=existing?getOutfit(existing.outfitId):null;
  let html="";
  if(existingOutfit){
    html+=`<div class="field full"><label>Planned outfit</label>
      <div class="outfit-thumbs" style="grid-template-columns:repeat(auto-fill,minmax(70px,1fr))">${pieceThumbs(existingOutfit.pieces)}</div>
      <div style="margin-top:6px"><strong>${esc(existingOutfit.name||"Outfit")}</strong></div></div>
      <div class="form-actions">
        <button type="button" class="secondary-btn" onclick="closeModal();openOutfitForm('${existingOutfit.id}','${date}')">✎ Edit outfit</button>
        <button type="button" class="danger-btn" onclick="unplanOutfit('${date}')">Remove from day</button>
        <button type="button" class="secondary-btn" onclick="closeModal()">Close</button>
      </div>`;
  }else if(getOutfits().length){
    html+=`<div class="field full"><label>Choose an outfit</label><div class="outfit-choice-list">`+
      getOutfits().map(o=>`<button type="button" class="outfit-choice" onclick="assignExisting('${date}','${o.id}')">${esc(o.name||"Outfit")}<span>${o.pieces.length} piece${o.pieces.length===1?"":"s"}</span></button>`).join("")+
      `</div></div>
      <div class="field full"><label>Or plan a new one</label><button type="button" class="secondary-btn" onclick="closeModal();openOutfitForm(null,'${date}')">＋ New outfit</button></div>
      <div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Close</button></div>`;
  }else{
    html=`<div class="empty-state">No outfit planned for this day.<br>Your closet is empty — add clothing to start planning.</div>
      <div class="form-actions"><button type="button" class="primary-btn" onclick="closeModal();openClothingForm()">＋ Add clothing</button></div>`;
  }
  form.innerHTML=html; document.getElementById("modalBackdrop").classList.add("open");
}
function assignExisting(date,outfitId){ state.plans=state.plans.filter(p=>p.date!==date); state.plans.push({id:uid("plan"),date,outfitId}); save(); closeModal(); showToast("Outfit planned."); }
function unplanOutfit(date){ if(confirm("Remove the outfit planned for this day?")){ state.plans=state.plans.filter(p=>p.date!==date); save(); showToast("Removed.");} }

// ---- Planner render (Sunday-first to match the wardrobe view)
function startOfSunWeek(d){ const x=new Date(d); x.setDate(x.getDate()-x.getDay()); x.setHours(0,0,0,0); return x; }
function renderOutfitPlanner(){
  const title=document.getElementById("outfitPeriodTitle");
  const start=startOfSunWeek(outfitCursor), end=new Date(start); end.setDate(end.getDate()+6);
  if(outfitView==="month"){
    title.textContent=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(outfitCursor);
    renderOutfitMonth();
  }else{
    title.textContent=`${start.getDate()} - ${end.getDate()} ${fmtDate(isoDate(end),{month:"short"})} ${end.getFullYear()}`;
    renderOutfitWeek(start);
  }
}
function renderOutfitWeek(start){
  const body=document.getElementById("outfitPlannerBody"); let html=`<div class="outfit-grid">`;
  for(let i=0;i<7;i++){
    const d=new Date(start); d.setDate(start.getDate()+i); const date=isoDate(d); const today=date===isoDate();
    const plan=getPlan(date), outfit=plan?getOutfit(plan.outfitId):null;
    const pieces=outfit?(outfit.pieces||[]).filter(id=>getClothing().some(c=>c.id===id)):[];
    const stack=pieces.map(id=>{const it=getClothing().find(c=>c.id===id);return it?`<span class="stack-item">${it.photo?`<img src="${it.photo}" alt="" title="${esc(it.name)}">`:`<span class="thumb-ph">👕</span>`}</span>`:"";}).join("");
    html+=`<article class="card outfit-day ${today?"today":""}">
      <header><strong>${OUTFIT_DAYNAMES[i]}</strong><span>${d.getDate()}</span></header>
      <div class="outfit-stack">${stack||`<div class="outfit-empty">No outfit planned</div>`}</div>
      <div class="day-actions">
        ${outfit?`<strong class="outfit-name">${esc(outfit.name||"Outfit")}</strong>
          <div class="item-actions"><button class="action-btn edit" title="Edit outfit" onclick="openOutfitForDate('${date}')">✎</button><button class="action-btn delete" title="Remove plan" onclick="unplanOutfit('${date}')">×</button></div>`:`<button class="add-day" onclick="openOutfitForDate('${date}')">＋ Add outfit</button>`}
      </div>
    </article>`;
  }
  html+=`</div>`; body.innerHTML=html;
}
function renderOutfitMonth(){
  const y=outfitCursor.getFullYear(), m=outfitCursor.getMonth();
  const body=document.getElementById("outfitPlannerBody");
  const first=new Date(y,m,1), offset=first.getDay(), days=new Date(y,m+1,0).getDate();
  let cells="";
  for(let i=0;i<offset;i++) cells+=`<div class="outfit-cell"></div>`;
  for(let day=1;day<=days;day++){
    const date=isoDate(new Date(y,m,day)), today=date===isoDate();
    const plan=getPlan(date), outfit=plan?getOutfit(plan.outfitId):null;
    cells+=`<div class="outfit-cell ${today?"today":""}" onclick="openOutfitForDate('${date}')">
      <span class="outfit-daynum">${day}</span>
      ${outfit?`<span class="outfit-indicator" title="${esc(outfit.name||"Outfit")}">${outfit.name?esc(outfit.name):"Outfit"}</span>`:""}
    </div>`;
  }
  const total=Math.ceil((offset+days)/7)*7;
  for(let i=offset+days;i<total;i++) cells+=`<div class="outfit-cell"></div>`;
  body.innerHTML=`<div class="outfit-cal-head">${OUTFIT_DAYNAMES.map(x=>`<div>${x}</div>`).join("")}</div><div class="outfit-cal-body">${cells}</div>`;
}

// ---- Controls + entry point
function renderOutfits(){
  buildAllFilters();
  renderCloset();
  renderOutfitPlanner();
  renderAllClothing();
}
function moveOutfitCursor(dir){ if(outfitView==="month"){outfitCursor=new Date(outfitCursor.getFullYear(),outfitCursor.getMonth()+dir,1);}else{const d=new Date(outfitCursor);d.setDate(d.getDate()+dir*7);outfitCursor=d;} renderOutfitPlanner(); }
document.getElementById("outfitPrev").addEventListener("click",()=>moveOutfitCursor(-1));
document.getElementById("outfitNext").addEventListener("click",()=>moveOutfitCursor(1));
document.getElementById("closetSearch").addEventListener("input",renderCloset);
document.getElementById("allFilter").addEventListener("change",e=>{allFilterCat=e.target.value;renderAllClothing();});
document.getElementById("allSeason").addEventListener("change",e=>{allSeason=e.target.value;renderAllClothing();});
document.getElementById("allSort").addEventListener("change",e=>{allSort=e.target.value;renderAllClothing();});
document.querySelectorAll("#outfitViewSwitch [data-outfitview]").forEach(b=>b.addEventListener("click",()=>{outfitView=b.dataset.outfitview;document.querySelectorAll("#outfitViewSwitch [data-outfitview]").forEach(x=>x.classList.toggle("active",x===b));renderOutfitPlanner();}));
// Tabs: switch active state and scroll the matching panel into view.
document.querySelectorAll(".outfit-tab").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".outfit-tab").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  const panel=document.querySelector("."+b.dataset.outfitTab+"-panel");
  if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
}));
document.querySelectorAll("[data-outfit-tab-jump]").forEach(b=>b.addEventListener("click",()=>{
  const panel=document.querySelector("."+b.dataset.outfitTabJump+"-panel");
  if(panel) panel.scrollIntoView({behavior:"smooth",block:"start"});
  document.getElementById("outfitMore").hidden=true;
}));
document.getElementById("outfitMoreBtn").addEventListener("click",e=>{e.stopPropagation();const m=document.getElementById("outfitMore");m.hidden=!m.hidden;});
document.addEventListener("click",e=>{const m=document.getElementById("outfitMore");if(m&&!m.hidden&&!e.target.closest(".outfit-more-wrap"))m.hidden=true;});

/* ============ MY DAY ============ */
// My Day is an aggregation layer: it reads and updates the SAME data as the
// existing LifeOS sections (tasks, study, workouts, meals, quran, dikr,
// expenses, events, outfits). No duplicate storage — every control here routes
// through the existing single source of truth (state.*) and existing helpers.
// NOTE: template literals here are kept SINGLE-LEVEL (never a backtick inside
// another backtick) to avoid fragile nested-template parsing.
let mydayCursor=new Date();
const MYDAY_ICON={study:"📚",task:"✅",workout:"🏋️",meal:"🍽️",quran:"📖",expense:"💰",event:"📅"};
const MYDAY_STATS=[
  {key:"task",label:"Tasks"},{key:"study",label:"Study"},{key:"workout",label:"Workout"},
  {key:"quran",label:"Quran"},{key:"dikr",label:"Dikr"},{key:"event",label:"Events"}
];

function mydayStatsFor(date){
  return {
    task:{done:state.tasks.filter(x=>x.date===date&&x.done).length,total:state.tasks.filter(x=>x.date===date).length},
    study:{done:state.study.filter(x=>x.date===date&&x.done).length,total:state.study.filter(x=>x.date===date).length},
    workout:{done:state.workouts.filter(x=>x.date===date&&x.done).length,total:state.workouts.filter(x=>x.date===date).length},
    quran:{done:state.quran.filter(x=>x.date===date&&x.done).length,total:state.quran.filter(x=>x.date===date).length},
    dikr:{done:state.dikr.filter(x=>dikrCompleted(x,date)).length,total:state.dikr.length},
    event:{done:0,total:state.events.filter(x=>x.date===date).length}
  };
}

// Daily progress: counts ONLY actionable items scheduled that day
// (tasks + study + workouts + quran + dikr). Empty categories do NOT reduce
// the total, so progress is never punished for a quiet day. No hardcoded %.
function mydayProgress(date){
  const tasks=state.tasks.filter(x=>x.date===date);
  const study=state.study.filter(x=>x.date===date);
  const workouts=state.workouts.filter(x=>x.date===date);
  const quran=state.quran.filter(x=>x.date===date);
  const total=tasks.length+study.length+workouts.length+quran.length+state.dikr.length;
  const done=tasks.filter(x=>x.done).length+study.filter(x=>x.done).length
    +workouts.filter(x=>x.done).length+quran.filter(x=>x.done).length
    +state.dikr.filter(x=>dikrCompleted(x,date)).length;
  return {done,total,pct:total?Math.round(done/total*100):0};
}

function mydayEmpty(msg,btnLabel,btnJs){
  let btn="";
  if(btnLabel&&btnJs) btn='<div style="margin-top:8px"><button class="secondary-btn block-action" onclick="'+btnJs+'">'+btnLabel+'</button></div>';
  return '<div class="empty-state">'+msg+btn+'</div>';
}

function renderMyDay(){
  const date=isoDate(mydayCursor), dt=new Date(date+"T12:00:00"), isToday=date===isoDate();
  document.getElementById("mydayEyebrow").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long"}).format(dt).toUpperCase();
  document.getElementById("mydayDate").textContent=new Intl.DateTimeFormat(undefined,{month:"long",day:"numeric",year:"numeric"}).format(dt);
  document.getElementById("mydayMsg").textContent=isToday?"Here's your day. Let's make it count.":"Looking at "+new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(dt)+".";
  const p=mydayProgress(date);
  document.getElementById("mydayProgress").textContent=p.pct+"%";
  document.getElementById("mydayProgressBar").style.width=p.pct+"%";
  document.getElementById("mydayProgressMeta").textContent=p.total?p.done+" of "+p.total+" planned items complete":"Nothing scheduled yet for this day.";
  const st=mydayStatsFor(date);
  document.getElementById("mydayStats").innerHTML=MYDAY_STATS.map(d=>{
    const s=st[d.key], cls=s.total>0&&s.done>=s.total?"done-ok":(s.total>0?"done-pending":"");
    return '<div class="myday-stat '+cls+'"><span class="stat-icon">'+(MYDAY_ICON[d.key]||"")+'</span><strong>'+s.done+' / '+s.total+'</strong><span>'+d.label+'</span></div>';
  }).join("");
  const qa=["task","event","study","workout","meal","expense"];
  const qaLab={task:"✅ Task",event:"📅 Event",study:"📚 Study",workout:"🏋️ Workout",meal:"🍽️ Meal",expense:"💰 Money"};
  document.getElementById("mydayQuickAdd").innerHTML=qa.map(t=>'<button class="secondary-btn" onclick="openForm(\''+t+'\',\''+date+'\')">'+qaLab[t]+'</button>').join("");
  // Timeline
  const items=dayItems(date).sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  if(items.length){
    let tl="";
    for(const x of items){
      const time=esc(x.time||"All day");
      const cat=CAT_LABEL[x.cat]||esc(x.cat);
      const title=esc(x.label);
      const doneCls=x.done?"completed":"";
      let sub="";
      if(x.sub) sub='<small>'+esc(x.sub)+'</small>';
      let ctrl="";
      if(x.completable) ctrl='<button class="mini-check '+(x.done?"done":"")+'" onclick="toggleRecordDone(\''+x.model+'\',\''+x.id+'\')">'+(x.done?"✓":"")+'</button>';
      tl+='<div class="list-item tl-item"><span class="tl-time">'+time+'</span><div class="tl-body"><span class="day-cat-label">'+cat+'</span><strong class="'+doneCls+'">'+x.icon+' '+title+'</strong>'+sub+'</div><div style="display:flex;gap:7px;align-items:center">'+ctrl+'<button class="action-btn edit" title="Edit" onclick="openForm(\''+x.model+'\',\''+date+'\',\''+x.id+'\')">✎</button><button class="action-btn delete" title="Delete" onclick="deleteRecord(\''+x.model+'\',\''+x.id+'\')">×</button></div></div>';
    }
    document.getElementById("mydayTimeline").innerHTML=tl;
  }else{
    document.getElementById("mydayTimeline").innerHTML='<div class="empty-state">Nothing on the timeline for this day.</div>';
  }
  renderMyDayBlocks(date);
}

function mdCheckList(rows,model,itemFields){
  // rows: array; model: 'task'|'study'|'workout'|'quran'; itemFields:{title,time,meta}
  let html="";
  for(const x of rows){
    const done=x.done;
    const fn = model==="workout"?"toggleWorkout":(model==="quran"?"toggleQuranDone":"toggleRecordDone('"+model+"','"+x.id+"')");
    const call = fn.indexOf("toggle")===0?fn+"('"+x.id+"')":fn;
    html+='<div class="list-item"><button class="mini-check '+(done?"done":"")+'" onclick="'+call+'">'+(done?"✓":"")+'</button><div><strong class="'+(done?"completed":"")+'">'+esc(itemFields.title(x))+'</strong><small>'+itemFields.time(x)+'</small></div>'+actionButtons(model,x.id)+'</div>';
  }
  return html;
}

function renderMyDayBlocks(date){
  const tasks=state.tasks.filter(x=>x.date===date);
  const study=state.study.filter(x=>x.date===date);
  const workouts=state.workouts.filter(x=>x.date===date);
  const meals=state.meals.filter(x=>x.date===date);
  const quran=state.quran.filter(x=>x.date===date);
  const expenses=state.expenses.filter(x=>x.date===date);
  const events=state.events.filter(x=>x.date===date);
  const plan=getPlan(date), outfit=plan?getOutfit(plan.outfitId):null;

  const tasksB=tasks.length?mdCheckList(tasks,"task",{
    title:x=>x.title,
    time:x=>esc(x.time?x.time+" · "+x.category:((x.category||"personal")))
  }):mydayEmpty("No tasks for this day.","＋ Add task","openForm('task','"+date+"')");
  const studyB=study.length?mdCheckList(study,"study",{
    title:x=>x.subject||"Study",
    time:x=>esc(x.time||"Anytime")+(x.duration?" · "+x.duration+" min":"")
  }):mydayEmpty("No study planned today.","＋ Add study","openForm('study','"+date+"')");
  const workB=workouts.length?mdCheckList(workouts,"workout",{
    title:x=>x.type||"Workout",
    time:x=>esc(x.time||"Anytime")+(x.duration?" · "+esc(x.duration):"")
  }):mydayEmpty("No workout planned today.","＋ Add workout","openForm('workout','"+date+"')");
  const quranB=quran.length?mdCheckList(quran,"quran",{
    title:x=>x.surah||"Quran",
    time:x=>(x.ayahRange?esc(x.ayahRange):"")+(x.time?" · "+esc(x.time):"")
  }):mydayEmpty("No Quran session today.","＋ Add Quran","openForm('quran','"+date+"')");

  const mealsB=meals.length?meals.map(x=>'<div class="list-item"><span class="event-week-icon">🍽️</span><div><strong>'+esc(x.slot||"Meal")+(x.name?" · "+esc(x.name):"")+'</strong>'+(x.ingredients?'<small>'+esc(x.ingredients)+'</small>':"")+'</div>'+actionButtons("meal",x.id)+'</div>').join(""):mydayEmpty("No meals planned today.","＋ Add meal","openForm('meal','"+date+"')");

  const dikrB=state.dikr.length?state.dikr.map(x=>{
    const c=dikrCount(x,date),t=Number(x.target||1),done=dikrCompleted(x,date);
    const status=done?"Completed today":c+" / "+t+" counts";
    const ctrl=done?'<span class="check done">✓</span>':'<button class="dikr-tap" onclick="tapDikr(\''+x.id+'\')" aria-label="Count">＋</button>';
    return '<div class="list-item '+(done?"done":"")+'"><span class="event-week-icon">🤲</span><div><strong>'+esc(x.name)+'</strong><small>'+status+'</small></div><div style="display:flex;align-items:center;gap:7px">'+ctrl+'<button class="action-btn edit" title="Edit" onclick="editDikr(\''+x.id+'\')">✎</button><button class="action-btn delete" title="Delete" onclick="deleteDikr(\''+x.id+'\')">×</button></div></div>';
  }).join(""):mydayEmpty("No Dikr added yet.","＋ Add Dikr","openForm('dikr','"+date+"')");

  const moneyB=expenses.length?expenses.map(x=>'<div class="list-item"><span class="event-week-icon">💰</span><div><strong>'+esc(x.title||x.category||"Expense")+'</strong><small>'+money(x.amount)+'</small></div>'+actionButtons("expense",x.id)+'</div>').join(""):mydayEmpty("No money activity today.","＋ Add expense","openForm('expense','"+date+"')");

  const eventB=events.length?events.map(x=>'<div class="list-item"><span class="event-week-icon">📅</span><div><strong>'+esc(x.title||"Event")+'</strong><small>'+esc(x.time||"Anytime")+(x.type?" · "+esc(x.type):"")+'</small></div>'+actionButtons("event",x.id)+'</div>').join(""):mydayEmpty("No events today.","＋ Add event","openForm('event','"+date+"')");

  let outfitB;
  if(outfit){
    const pieces=(outfit.pieces||[]).map(id=>getClothing().find(c=>c.id===id)).filter(Boolean);
    let thumbs="";
    for(const p of pieces){
      thumbs+=p.photo?'<img src="'+p.photo+'" alt="'+esc(p.name)+'" title="'+esc(p.name)+'">':'<span class="thumb-ph" title="'+esc(p.name)+'">'+esc(String(p.name||"?").charAt(0).toUpperCase())+'</span>';
    }
    const label=outfit.name?esc(outfit.name):((outfit.pieces||[]).length+" pieces");
    const titleThumbs=thumbs?'<div class="myday-outfit-thumbs">'+thumbs+'</div>':'<div class="muted small">This outfit has no pieces.</div>';
    outfitB=titleThumbs+'<strong>'+label+'</strong><div style="display:flex;gap:7px;margin-top:8px"><button class="secondary-btn block-action" onclick="openOutfitForDate(\''+date+'\')">✎ Change</button><button class="secondary-btn block-action" onclick="unplanOutfit(\''+date+'\')">Remove</button></div>';
  }else{
    outfitB=mydayEmpty("No outfit planned yet.","＋ Plan Outfit","openOutfitForDate('"+date+"')");
  }
  document.getElementById("mydayGrid").innerHTML=
    mydayBlock("✅","Tasks",tasksB)+mydayBlock("📚","Study",studyB)+mydayBlock("🏋️","Workout",workB)
    +mydayBlock("🍽️","Meals",mealsB)+mydayBlock("📖","Quran",quranB)+mydayBlock("🤲","Dikr",dikrB)
    +mydayBlock("💰","Money",moneyB)+mydayBlock("📅","Events",eventB)+mydayBlock("👗","Outfit",outfitB);
}
function mydayBlock(icon,title,body){
  return '<section class="card myday-block"><div class="block-head"><div><span class="eyebrow">'+icon+'</span><h3>'+title+'</h3></div></div>'+body+'</section>';
}
document.getElementById("mydayPrev").addEventListener("click",()=>{mydayCursor.setDate(mydayCursor.getDate()-1);renderMyDay()});
document.getElementById("mydayNext").addEventListener("click",()=>{mydayCursor.setDate(mydayCursor.getDate()+1);renderMyDay()});
document.getElementById("mydayToday").addEventListener("click",()=>{mydayCursor=new Date();renderMyDay()});

/* ============ GOALS & INSPIRATION ============ */
const GOAL_CATEGORIES=["📚 Study","💻 Coding","💰 Money","📖 Quran","🏋️ Fitness","🌱 Personal","💼 Projects","⭐ Other"];
const VISION_CATEGORIES=["🎓 Education","💻 Career","✈️ Travel","🏠 Lifestyle","💰 Financial","🌱 Personal Growth","🎨 Creativity","⭐ Dreams","Other"];
const WISH_CATEGORIES=["👗 Clothes","👟 Shoes","💻 Tech","📚 School","🏠 Room","🎨 Creative","🎁 Gifts","🧴 Personal","Other"];
const PRIO_LABEL={high:"🔴 High",medium:"🟡 Medium",low:"🟢 Low"};

let goalsTab="goals", goalsFilter="active";
let wishFilter="all", wishCat="all", wishQuery="";
let pendingGoalId=null, pendingGoalImage="";
let pendingVisionId=null, pendingVisionImage="";
let pendingWishId=null, pendingWishImage="", wishPrefill=null;

// Safe init (never wipes other data). These live inside the persisted single-source state.
if(!Array.isArray(state.goals)) state.goals=[];
if(!Array.isArray(state.vision)) state.vision=[];
if(!Array.isArray(state.wishlist)) state.wishlist=[];
state.goals=state.goals.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&typeof x.id==="string");
state.vision=state.vision.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&typeof x.id==="string");
state.wishlist=state.wishlist.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&typeof x.id==="string");

function goalSave(){ try{ save(); }catch(e){ console.error("Goals save failed:",e); showToast("Couldn't save — storage may be full. Try a smaller image.",true); } }

// ---- shared helpers
function catField(label,name,presets,value,customName){
  const opts=presets.map(o=>'<option '+(o===value?'selected':'')+'>'+esc(o)+'</option>');
  if(value && !presets.includes(value)) opts.push('<option selected>'+esc(value)+'</option>');
  return '<div class="field"><label>'+label+'</label><select name="'+name+'">'+opts.join('')+'</select><input name="'+customName+'" type="text" placeholder="Or type a custom category" value="" style="margin-top:6px" aria-label="Custom category"></div>';
}
function priorityBadge(p){ return PRIO_LABEL[p]||"🟡 Medium"; }
function daysUntil(dateStr){
  if(!dateStr) return null;
  const today=new Date(); today.setHours(0,0,0,0);
  const d=new Date(dateStr+"T12:00:00"); d.setHours(0,0,0,0);
  return Math.round((d - today)/86400000);
}
function goalProgress(g){
  const tasks=(g.taskIds||[]).map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean);
  if(tasks.length){ return Math.round(tasks.filter(t=>t.done).length/tasks.length*100); }
  return Math.max(0,Math.min(100,Number(g.progress)||0));
}
function goalStatus(g){
  if(g.status==="completed"||goalProgress(g)>=100) return "completed";
  if(g.deadline && daysUntil(g.deadline)<0) return "overdue";
  return "active";
}
function deadlineLabel(g){
  if(!g.deadline) return "";
  if(goalStatus(g)==="completed") return "";
  const diff=daysUntil(g.deadline);
  if(diff<0) return '<span class="g-deadline overdue">Overdue by '+(-diff)+' day'+(-diff===1?'':'s')+'</span>';
  if(diff===0) return '<span class="g-deadline due">Due today</span>';
  if(diff<=7) return '<span class="g-deadline soon">Due in '+diff+' day'+(diff===1?'':'s')+'</span>';
  return '<span class="g-deadline">Due '+fmtDate(g.deadline,{month:'short',day:'numeric'})+'</span>';
}

// ---- Goals
function setGoalsTab(t){ goalsTab=t; renderGoalsAndInspiration(); }
function setGoalsFilter(f){ goalsFilter=f; renderGoals(); }
function renderGoals(){
  const listEl=document.getElementById("goalsList"); if(!listEl) return;
  const bar=document.getElementById("goalsFilterBar");
  const active=state.goals.filter(g=>goalStatus(g)!=="completed").length;
  const done=state.goals.length-active;
  if(bar) bar.innerHTML=[["active","Active ("+active+")"],["completed","Completed ("+done+")"],["all","All ("+state.goals.length+")"]].map(x=>'<button class="'+(goalsFilter===x[0]?'active':'')+'" onclick="setGoalsFilter(\''+x[0]+'\')">'+x[1]+'</button>').join('');
  const items=state.goals.filter(g=>{
    const s=goalStatus(g);
    if(goalsFilter==="completed") return s==="completed";
    if(goalsFilter==="active") return s!=="completed";
    return true;
  });
  listEl.innerHTML=items.length?items.map(goalCard).join(''):'<div class="empty-state">'+(state.goals.length?"No goals in this view.":"No goals yet. Add your first long-term goal to get started.")+'</div>';
}
function goalCard(g){
  const p=goalProgress(g), s=goalStatus(g);
  const linked=(g.taskIds||[]);
  const tasks=linked.map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean);
  const useTasks=tasks.length>0;
  const doneTasks=tasks.filter(t=>t.done).length;
  const badge=s==="completed"?'<span class="g-status ok">Completed</span>':s==="overdue"?'<span class="g-status bad">Overdue</span>':'<span class="g-status">Active</span>';
  const img=g.image?'<div class="g-img"><img src="'+g.image+'" alt="'+esc(g.title)+'"></div>':'';
  const meta=deadlineLabel(g);
  const prio='<span class="g-prio '+g.priority+'">'+priorityBadge(g.priority)+'</span>';
  let tasksBlock='';
  if(useTasks){
    tasksBlock='<div class="g-tasks">'+tasks.map(t=>'<div class="g-task'+(t.done?' done':'')+'"><button class="mini-check'+(t.done?' done':'')+'" onclick="toggleRecordDone(\'task\',\''+t.id+'\')">'+(t.done?'✓':'')+'</button><span>'+esc(t.title)+'</span></div>').join('')+'</div>';
  }else if(linked.length){
    tasksBlock='<div class="muted small">A linked task no longer exists.</div>';
  }
  const countLine=useTasks?(doneTasks+' / '+tasks.length+' linked tasks'):(g.target?'Target: '+esc(g.target):'');
  const progControls=useTasks?'':'<button class="secondary-btn small-btn" onclick="setGoalProgress(\''+g.id+'\',10)" title="Increase progress">＋10%</button>';
  return '<article class="card goal-card">'+img+
    '<div class="goal-card-head"><div><span class="goal-cat">'+esc(g.category||'Goal')+'</span><h3>'+esc(g.title)+'</h3></div>'+badge+'</div>'+
    (g.description?'<p class="goal-desc">'+esc(g.description)+'</p>':'')+
    '<div class="goal-progress"><strong>'+p+'%</strong><div class="progress-track"><i style="width:'+p+'%"></i></div></div>'+
    (countLine?'<div class="goal-countline">'+countLine+'</div>':'')+
    '<div class="goal-meta">'+meta+prio+'</div>'+
    tasksBlock+
    '<div class="goal-actions">'+progControls+
      (s==="completed"?'<button class="secondary-btn small-btn" onclick="toggleGoalComplete(\''+g.id+'\')">↺ Reopen</button>':'<button class="primary-btn small-btn" onclick="toggleGoalComplete(\''+g.id+'\')">✓ Complete</button>')+
      '<button class="icon-btn small-btn" title="Edit" onclick="openGoalForm(\''+g.id+'\')">✎</button>'+
      '<button class="icon-btn small-btn" title="Delete" onclick="deleteGoal(\''+g.id+'\')">×</button>'+
    '</div></article>';
}
function openGoalForm(id){
  const g=id?state.goals.find(x=>x.id===id):null;
  pendingGoalId=id||null; pendingGoalImage="";
  setModal(g?"EDIT GOAL":"NEW GOAL", g?"Edit goal":"Add a goal");
  const form=document.getElementById("modalForm");
  const linked=g?(g.taskIds||[]):[];
  const taskOpts=state.tasks.map(t=>'<label class="link-task'+(linked.includes(t.id)?' checked':'')+'"><input type="checkbox" name="taskLink" value="'+t.id+'"'+(linked.includes(t.id)?' checked':'')+'><span>'+esc(t.title)+'</span><em>'+(t.date||'')+'</em></label>').join('')||'<span class="muted small">No tasks yet. Add tasks first, then link them here.</span>';
  const progressVal=g?goalProgress(g):0;
  const preview=g&&g.image?'<img src="'+g.image+'" alt="preview">':'<span class="photo-add">＋ Upload image</span>';
  form.innerHTML='<div class="form-grid">'+
    '<div class="field full"><label>Goal image (optional)</label><label class="photo-upload" for="goalImageInput">'+preview+'</label><input type="file" id="goalImageInput" accept="image/*" hidden></div>'+
    field("Title","gTitle","text",g?g.title:"","required",true)+
    field("Description (optional)","gDescription","textarea",g?g.description:"","",true)+
    catField("Category","gCategory",GOAL_CATEGORIES,g?g.category:"📚 Study","gCustomCat")+
    field("Deadline (optional)","gDeadline","date",g?g.deadline:"")+
    field("Target (optional)","gTarget","text",g?g.target:"")+
    selectField("Priority","gPriority",["low","medium","high"],g?g.priority:"medium")+
    field("Notes (optional)","gNotes","textarea",g?g.notes:"","",true)+
    '<div class="field full"><label>Progress <strong id="gProgressVal">'+progressVal+'%</strong></label><input type="range" id="gProgress" name="gProgress" min="0" max="100" step="5" value="'+progressVal+'" style="width:100%"></div>'+
    '<div class="field full"><label>Link existing tasks</label><div class="task-picker">'+taskOpts+'</div>'+(linked.length?'<div class="modal-note">Progress auto-calculates from linked tasks.</div>':'')+'</div>'+
  '</div><div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">'+(g?"Save changes":"Create goal")+'</button></div>';
  form.onsubmit=e=>{e.preventDefault();saveGoal(form);};
  document.getElementById("goalImageInput").onchange=ev=>{
    const f=ev.target.files[0]; if(!f) return;
    if(!f.type.startsWith("image/")){ showToast("Please choose an image file.",true); return; }
    readImage(f,img=>{ pendingGoalImage=img; const up=document.querySelector(".photo-upload"); if(up) up.innerHTML='<img src="'+img+'" alt="preview">'; });
  };
  const range=document.getElementById("gProgress");
  if(range) range.oninput=()=>{ const v=document.getElementById("gProgressVal"); if(v) v.textContent=range.value+"%"; };
  document.getElementById("modalBackdrop").classList.add("open");
}
function saveGoal(form){
  const fd=new FormData(form);
  const title=(fd.get("gTitle")||"").trim(); if(!title){ showToast("Title is required.",true); return; }
  const taskIds=(fd.getAll("taskLink")||[]);
  const cat=(fd.get("gCustomCat")||"").trim()||fd.get("gCategory")||"⭐ Other";
  const prog=Math.max(0,Math.min(100,Number(fd.get("gProgress"))||0));
  if(pendingGoalId){
    const g=state.goals.find(x=>x.id===pendingGoalId);
    if(g){
      g.title=title; g.description=fd.get("gDescription")||""; g.category=cat;
      g.deadline=fd.get("gDeadline")||""; g.target=fd.get("gTarget")||"";
      g.priority=fd.get("gPriority")||"medium"; g.notes=fd.get("gNotes")||"";
      g.progress=prog; g.taskIds=taskIds;
      if(pendingGoalImage) g.image=pendingGoalImage;
      if(goalProgress(g)>=100&&g.status!=="completed"){ g.status="completed"; g.completedAt=isoDate(); }
    }
  }else{
    state.goals.push({id:uid("goal"),title,description:fd.get("gDescription")||"",category:cat,
      deadline:fd.get("gDeadline")||"",target:fd.get("gTarget")||"",priority:fd.get("gPriority")||"medium",
      notes:fd.get("gNotes")||"",progress:prog,image:pendingGoalImage||"",status:"active",completedAt:"",taskIds});
  }
  pendingGoalId=null; pendingGoalImage="";
  goalSave(); closeModal(); showToast("Goal saved.");
}
function setGoalProgress(id,delta){
  const g=state.goals.find(x=>x.id===id); if(!g) return;
  const p=Math.max(0,Math.min(100,Number(g.progress||0)+delta));
  g.progress=p;
  if(p>=100&&g.status!=="completed"){ g.status="completed"; g.completedAt=isoDate(); }
  goalSave();
}
function toggleGoalComplete(id){
  const g=state.goals.find(x=>x.id===id); if(!g) return;
  if(g.status==="completed"){ g.status="active"; g.completedAt=""; }
  else { g.status="completed"; g.completedAt=isoDate(); g.progress=100; }
  goalSave(); showToast(g.status==="completed"?"Goal completed!":"Goal reopened.");
}
function deleteGoal(id){
  const g=state.goals.find(x=>x.id===id); if(!g) return;
  if(!confirm('Delete goal "'+g.title+'"? Its linked tasks will be kept.')) return;
  state.goals=state.goals.filter(x=>x.id!==id);
  goalSave(); showToast("Goal deleted.");
}

// ---- Vision Board
function renderVision(){
  const grid=document.getElementById("visionGrid"); if(!grid) return;
  grid.innerHTML=state.vision.length?state.vision.map((v,i)=>{
    const img=v.image?'<img src="'+v.image+'" alt="'+esc(v.title||'Vision')+'">':'<span class="vision-ph">✨</span>';
    return '<article class="card vision-card"><div class="vision-img">'+img+'</div><div class="vision-body">'+
      (v.category?'<span class="goal-cat">'+esc(v.category)+'</span>':'')+
      (v.title?'<h3>'+esc(v.title)+'</h3>':'')+
      (v.description?'<p>'+esc(v.description)+'</p>':'')+
      (v.note?'<small>'+esc(v.note)+'</small>':'')+
      '<div class="vision-actions">'+
        '<button class="icon-btn small-btn" title="Move up" onclick="moveVision(\''+v.id+'\',-1)"'+(i===0?' disabled':'')+'>↑</button>'+
        '<button class="icon-btn small-btn" title="Move down" onclick="moveVision(\''+v.id+'\',1)"'+(i===state.vision.length-1?' disabled':'')+'>↓</button>'+
        '<button class="secondary-btn small-btn" title="Add to Wishlist" onclick="visionToWishlist(\''+v.id+'\')">＋ Wishlist</button>'+
        '<button class="icon-btn small-btn" title="Edit" onclick="openVisionForm(\''+v.id+'\')">✎</button>'+
        '<button class="icon-btn small-btn" title="Delete" onclick="deleteVision(\''+v.id+'\')">×</button>'+
      '</div></div></article>';
  }).join(''):'<div class="card" style="padding:34px;text-align:center"><div style="font-size:40px">✨</div><h3 style="font:700 18px Manrope;margin:10px 0 6px">Your vision board is waiting.</h3><p class="muted small" style="margin:0 0 16px">Add images and ideas that inspire the life you are building.</p><button class="primary-btn" onclick="openVisionForm()">＋ Add First Vision</button></div>';
}
function openVisionForm(id){
  const v=id?state.vision.find(x=>x.id===id):null;
  pendingVisionId=id||null; pendingVisionImage="";
  setModal(v?"EDIT VISION":"VISION BOARD", v?"Edit vision item":"Add to Vision Board");
  const form=document.getElementById("modalForm");
  const preview=v&&v.image?'<img src="'+v.image+'" alt="preview">':'<span class="photo-add">＋ Upload image</span>';
  form.innerHTML='<div class="form-grid">'+
    '<div class="field full"><label>Image</label><label class="photo-upload" for="visionImageInput">'+preview+'</label><input type="file" id="visionImageInput" accept="image/*" hidden></div>'+
    field("Title","vTitle","text",v?v.title:"")+
    field("Short description","vDescription","textarea",v?v.description:"","",true)+
    catField("Category (optional)","vCategory",VISION_CATEGORIES,v?v.category:"","vCustomCat")+
    field("Note (optional)","vNote","textarea",v?v.note:"","",true)+
  '</div><div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">'+(v?"Save changes":"Save")+'</button></div>';
  form.onsubmit=e=>{e.preventDefault();saveVision(form);};
  document.getElementById("visionImageInput").onchange=ev=>{
    const f=ev.target.files[0]; if(!f) return;
    if(!f.type.startsWith("image/")){ showToast("Please choose an image file.",true); return; }
    readImage(f,img=>{ pendingVisionImage=img; const up=document.querySelector(".photo-upload"); if(up) up.innerHTML='<img src="'+img+'" alt="preview">'; });
  };
  document.getElementById("modalBackdrop").classList.add("open");
}
function saveVision(form){
  const fd=new FormData(form);
  const title=(fd.get("vTitle")||"").trim();
  const desc=(fd.get("vDescription")||"").trim();
  const cat=(fd.get("vCustomCat")||"").trim()||fd.get("vCategory")||"";
  const note=(fd.get("vNote")||"").trim();
  if(pendingVisionId){
    const v=state.vision.find(x=>x.id===pendingVisionId);
    if(v){ v.title=title; v.description=desc; v.category=cat; v.note=note; if(pendingVisionImage) v.image=pendingVisionImage; }
  }else{
    state.vision.push({id:uid("vision"),image:pendingVisionImage||"",title,description:desc,category:cat,note});
  }
  pendingVisionId=null; pendingVisionImage="";
  goalSave(); closeModal(); showToast("Saved.");
}
function moveVision(id,dir){
  const i=state.vision.findIndex(x=>x.id===id); if(i<0) return;
  const j=i+dir; if(j<0||j>=state.vision.length) return;
  const tmp=state.vision[i]; state.vision[i]=state.vision[j]; state.vision[j]=tmp;
  goalSave();
}
function deleteVision(id){
  const v=state.vision.find(x=>x.id===id); if(!v) return;
  if(!confirm('Remove this vision item?')) return;
  state.vision=state.vision.filter(x=>x.id!==id);
  goalSave(); showToast("Removed.");
}
function visionToWishlist(id){
  const v=state.vision.find(x=>x.id===id); if(!v) return;
  wishPrefill={name:v.title||"",image:v.image||"",category:v.category||""};
  openWishlistForm();
}

// ---- Wishlist
function setWishFilter(f){ wishFilter=f; renderWishlist(); }
function setWishCat(v){ wishCat=v; renderWishlist(); }
function onWishSearch(v){ wishQuery=v; renderWishlist(); }
function renderWishlist(){
  const grid=document.getElementById("wishGrid"); if(!grid) return;
  const stats=document.getElementById("wishStats");
  const unp=state.wishlist.filter(w=>!w.purchased);
  const est=unp.reduce((s,w)=>s+(Number(w.price)||0),0);
  const purchased=state.wishlist.filter(w=>w.purchased).length;
  if(stats) stats.innerHTML=
    '<div class="wish-stat"><strong>'+state.wishlist.length+'</strong><span>Items</span></div>'+
    '<div class="wish-stat"><strong>'+money(est)+'</strong><span>Estimated total</span></div>'+
    '<div class="wish-stat"><strong>'+purchased+'</strong><span>Purchased</span></div>'+
    '<div class="wish-stat"><strong>'+(state.wishlist.length-purchased)+'</strong><span>Remaining</span></div>';
  const bar=document.getElementById("wishFilterBar");
  if(bar) bar.innerHTML=[["all","All"],["high","High"],["medium","Medium"],["low","Low"],["purchased","Purchased"],["notpurchased","Not purchased"]].map(x=>'<button class="'+(wishFilter===x[0]?'active':'')+'" onclick="setWishFilter(\''+x[0]+'\')">'+x[1]+'</button>').join('');
  const sel=document.getElementById("wishCatSel");
  if(sel){
    const cats=[]; WISH_CATEGORIES.forEach(c=>{ if(!cats.includes(c)) cats.push(c); });
    state.wishlist.forEach(w=>{ if(w.category&&!cats.includes(w.category)) cats.push(w.category); });
    sel.innerHTML='<option value="all">All categories</option>'+cats.map(c=>'<option value="'+esc(c)+'"'+(wishCat===c?' selected':'')+'>'+esc(c)+'</option>').join('');
  }
  const items=state.wishlist.filter(w=>{
    if(wishFilter==="high"&&w.priority!=="high")return false;
    if(wishFilter==="medium"&&w.priority!=="medium")return false;
    if(wishFilter==="low"&&w.priority!=="low")return false;
    if(wishFilter==="purchased"&&!w.purchased)return false;
    if(wishFilter==="notpurchased"&&w.purchased)return false;
    if(wishCat!=="all"&&w.category!==wishCat)return false;
    if(wishQuery){ const q=wishQuery.toLowerCase(); if(!(w.name||"").toLowerCase().includes(q)&&!(w.store||"").toLowerCase().includes(q)&&!(w.category||"").toLowerCase().includes(q))return false; }
    return true;
  });
  grid.innerHTML=items.length?items.map(wishCard).join(''):'<div class="empty-state">'+(state.wishlist.length?"No wishlist items match your filters.":"Your wishlist is empty. Add things you'd love to buy.")+'</div>';
}
function wishCard(w){
  const img=w.image?'<img src="'+w.image+'" alt="'+esc(w.name)+'">':'<span class="wish-ph">🛍️</span>';
  const badge=w.purchased?'<span class="wish-badge">✓ Purchased</span>':'';
  const link=w.link?'<a href="'+esc(w.link)+'" target="_blank" rel="noopener" class="text-btn">View link ↗</a>':'';
  const price=w.price?money(w.price):'';
  return '<article class="card wish-card'+(w.purchased?' purchased':'')+'"><div class="wish-img">'+img+badge+'</div><div class="wish-body">'+
    (w.category?'<span class="goal-cat">'+esc(w.category)+'</span>':'')+
    '<h3>'+esc(w.name)+'</h3>'+
    (price?'<div class="wish-price">'+price+'</div>':'')+
    (w.store?'<div class="muted small">'+esc(w.store)+'</div>':'')+
    (w.priority?'<span class="g-prio '+w.priority+'">'+priorityBadge(w.priority)+'</span>':'')+
    link+
    '<div class="wish-status'+(w.purchased?' purchased':'')+'">'+(w.purchased?('Purchased'+(w.purchasedAmount?' for '+money(w.purchasedAmount):'')):'○ Not purchased')+'</div>'+
    '<div class="wish-actions">'+
      (w.purchased?'<button class="secondary-btn small-btn" onclick="toggleWishPurchased(\''+w.id+'\')">↺ Revert</button>':'<button class="primary-btn small-btn" onclick="markWishPurchased(\''+w.id+'\')">✓ Mark purchased</button>')+
      '<button class="icon-btn small-btn" title="Edit" onclick="openWishlistForm(\''+w.id+'\')">✎</button>'+
      '<button class="icon-btn small-btn" title="Delete" onclick="deleteWishlist(\''+w.id+'\')">×</button>'+
    '</div></div></article>';
}
function openWishlistForm(id){
  const w=id?state.wishlist.find(x=>x.id===id):null;
  const pf=wishPrefill;
  pendingWishId=id||null; pendingWishImage="";
  setModal(w?"EDIT WISHLIST":"WISHLIST", w?"Edit wishlist item":"Add to Wishlist");
  const form=document.getElementById("modalForm");
  const name=w?(w.name||""):(pf?(pf.name||""):"");
  const category=w?(w.category||""):(pf?(pf.category||""):"");
  const img=(w?w.image:"")||(pf?(pf.image||""):"");
  const preview=img?'<img src="'+img+'" alt="preview">':'<span class="photo-add">＋ Upload image</span>';
  form.innerHTML='<div class="form-grid">'+
    '<div class="field full"><label>Image</label><label class="photo-upload" for="wishImageInput">'+preview+'</label><input type="file" id="wishImageInput" accept="image/*" hidden></div>'+
    field("Item name","wName","text",name,"required",true)+
    field("Price (DH, optional)","wPrice","number",w?(w.price||""):"","min='0' step='0.01'")+
    field("Store","wStore","text",w?w.store:"")+
    catField("Category","wCategory",WISH_CATEGORIES,category,"wCustomCat")+
    selectField("Priority","wPriority",["low","medium","high"],w?w.priority:"medium")+
    field("Link (optional)","wLink","url",w?w.link:"")+
    field("Notes (optional)","wNotes","textarea",w?w.notes:"","",true)+
  '</div><div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">'+(w?"Save changes":"Save")+'</button></div>';
  form.onsubmit=e=>{e.preventDefault();saveWishlist(form);};
  document.getElementById("wishImageInput").onchange=ev=>{
    const f=ev.target.files[0]; if(!f) return;
    if(!f.type.startsWith("image/")){ showToast("Please choose an image file.",true); return; }
    readImage(f,img2=>{ pendingWishImage=img2; const up=document.querySelector(".photo-upload"); if(up) up.innerHTML='<img src="'+img2+'" alt="preview">'; });
  };
  document.getElementById("modalBackdrop").classList.add("open");
}
function saveWishlist(form){
  const fd=new FormData(form);
  const name=(fd.get("wName")||"").trim(); if(!name){ showToast("Item name is required.",true); return; }
  const cat=(fd.get("wCustomCat")||"").trim()||fd.get("wCategory")||"Other";
  const price=Math.max(0,Number(fd.get("wPrice"))||0);
  if(pendingWishId){
    const w=state.wishlist.find(x=>x.id===pendingWishId);
    if(w){
      w.name=name; w.price=price; w.store=fd.get("wStore")||""; w.category=cat;
      w.priority=fd.get("wPriority")||"medium"; w.link=fd.get("wLink")||""; w.notes=fd.get("wNotes")||"";
      if(pendingWishImage) w.image=pendingWishImage;
    }
  }else{
    state.wishlist.push({id:uid("wish"),name,image:pendingWishImage||"",price,store:fd.get("wStore")||"",category:cat,priority:fd.get("wPriority")||"medium",link:fd.get("wLink")||"",notes:fd.get("wNotes")||"",purchased:false,purchasedAmount:0,purchasedDate:""});
  }
  pendingWishId=null; pendingWishImage=""; wishPrefill=null;
  goalSave(); closeModal(); showToast("Saved.");
}
function markWishPurchased(id){
  const w=state.wishlist.find(x=>x.id===id); if(!w) return;
  w.purchased=true; w.purchasedDate=isoDate(); w.purchasedAmount=Number(w.price||0);
  goalSave();
  const addToMoney=confirm('Add "'+w.name+'" to Money?');
  if(addToMoney){
    const defaultAmt=Number(w.price||0);
    const input=prompt("Actual amount spent (DH):", defaultAmt?String(defaultAmt):"");
    if(input!==null){
      const amt=Number(input);
      if(!isNaN(amt)&&amt>=0){
        state.expenses.push({id:uid("expense"),title:w.name,amount:amt,date:isoDate(),category:(w.category==="Other"||!w.category)?"Personal":w.category});
        w.purchasedAmount=amt;
        goalSave(); showToast("Added "+money(amt)+" to Money.");
        return;
      }else{ showToast("Amount not added.",true); }
    }
  }
  showToast("Marked as purchased.");
}
function toggleWishPurchased(id){
  const w=state.wishlist.find(x=>x.id===id); if(!w) return;
  w.purchased=false; w.purchasedAmount=0; w.purchasedDate="";
  goalSave(); showToast("Marked as not purchased.");
}
function deleteWishlist(id){
  const w=state.wishlist.find(x=>x.id===id); if(!w) return;
  if(!confirm('Remove "'+w.name+'" from your wishlist?')) return;
  state.wishlist=state.wishlist.filter(x=>x.id!==id);
  goalSave(); showToast("Removed.");
}

// ---- main render
function renderGoalsAndInspiration(){
  document.querySelectorAll("#goalsTabs button").forEach(b=>b.classList.toggle("active",b.dataset.gtab===goalsTab));
  document.querySelectorAll(".g-panel").forEach(p=>p.classList.remove("active"));
  const p=document.getElementById(goalsTab==="goals"?"goalsPanel":goalsTab==="vision"?"visionPanel":"wishlistPanel");
  if(p) p.classList.add("active");
  const addBtn=document.getElementById("goalsPrimaryAdd");
  if(addBtn){
    if(goalsTab==="vision"){ addBtn.textContent="＋ Add to Vision Board"; addBtn.onclick=()=>openVisionForm(); }
    else if(goalsTab==="wishlist"){ addBtn.textContent="＋ Add to Wishlist"; addBtn.onclick=()=>openWishlistForm(); }
    else { addBtn.textContent="＋ Add Goal"; addBtn.onclick=()=>openGoalForm(); }
  }
  renderGoals(); renderVision(); renderWishlist();
}

/* ================= REMINDERS & NOTIFICATIONS ================= */

// ---- Notification helpers -------------------------------------------------
function notifyEnabled(){ return !!(state.settings.notify && state.settings.notify.enabled); }
function notifyBrowserGranted(){ return typeof Notification!=="undefined" && Notification.permission==="granted"; }
function remindSave(){ try{ save(); }catch(e){ console.error("Reminder save failed:",e); try{ renderAll(); }catch(_){ } showToast("Couldn't save reminder. Please try again.",true); } }

// Push a notification into the in-app log (and optionally the browser).
function fireNotification(title,body){
  if(!notifyEnabled()) return;
  const log=state.settings.notify.log;
  log.push({id:uid("ntf"),title,body,time:Date.now(),read:false});
  if(log.length>40) log.splice(0,log.length-40);
  if(state.settings.notify.browser && notifyBrowserGranted()){
    try{ new Notification(title,{body}); }catch(e){ /* optional */ }
  }
  try{ showToast(title+(body?" — "+body:"")); }catch(e){}
  remindSave();
  updateBellBadge();
}

// ---- Data-derived messages for smart reminders ------------------------------
function smartMessage(key){
  const today=isoDate();
  if(key==="prayer") return "Take a moment to pray and reconnect.";
  if(key==="dikr"){
    const pending=state.dikr.filter(x=>!dikrCompleted(x,today)).length;
    return pending?`${pending} Dikr target${pending>1?"s":""} left today.`:"You've completed today's Dikr.";
  }
  if(key==="habits"){
    const pending=state.habits.filter(h=>!h.history?.[today]).length;
    return state.habits.length?`${pending} of ${state.habits.length} habits left today.`:"";
  }
  if(key==="study"){
    const s=state.study.filter(x=>x.date===today);
    return s.length?`You have ${s.length} study session${s.length>1?"s":""} today.`:"";
  }
  if(key==="quran"){
    const done=state.quran.filter(x=>x.date===today&&x.done).length;
    const goal=state.settings.quranDailyGoal||1;
    const total=state.quran.filter(x=>x.date===today).length;
    return total?`${done}/${total} Quran session${total>1?"s":""} completed (goal ${goal}).`:"";
  }
  if(key==="tasks"){
    const pending=state.tasks.filter(x=>x.date===today&&!x.done).length;
    return pending?`${pending} task${pending>1?"s":""} still open today.`:"";
  }
  if(key==="events"){
    const ev=state.events.filter(x=>x.date===today);
    return ev.length?`${ev.length} event${ev.length>1?"s":""} today.`:"";
  }
  if(key==="savings"){
    const todayD=new Date(today+"T12:00:00");
    const near=state.savings.filter(g=>{ if(!g.date) return false; const d=new Date(g.date+"T12:00:00"); return (d-todayD)>=0 && (d-todayD)<=5*86400000; });
    return near.length?`${near.length} savings goal${near.length>1?"s":""} due within 5 days.`:"";
  }
  return "";
}

function smartShouldFire(key,time){
  const today=isoDate(), now=new Date(), hm=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  const cfg=state.settings.notify.smart[key];
  if(!cfg||!cfg.enabled||hm<time) return false;
  return cfg.last!==today; // fires once per day
}

function smartFire(key){
  const cfg=state.settings.notify.smart[key];
  const msg=smartMessage(key);
  if(msg) fireNotification(cfg.label,msg);
  cfg.last=isoDate(); // mark handled for today (whether or not there was data)
}

// ---- Manual reminders ------------------------------------------------------
function manualShouldFire(r){
  const today=isoDate(), now=new Date();
  const hm=String(now.getHours()).padStart(2,"0")+":"+String(now.getMinutes()).padStart(2,"0");
  if(r.lastFired===today) return false;
  if(hm<(r.time||"00:00")) return false;
  if(r.recur==="daily") return true;
  if(r.recur==="weekly"){
    const weekdays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return weekdays[now.getDay()]===r.weekday;
  }
  return r.date===today; // once
}

// ---- Engine: check all due reminders ----------------------------------------
function checkReminders(){
  if(!notifyEnabled()) return;
  const today=isoDate();
  // Smart reminders
  const smart=state.settings.notify.smart;
  for(const key in smart){
    const cfg=smart[key];
    if(cfg.enabled && smartShouldFire(key,cfg.time)) smartFire(key);
  }
  // Manual reminders
  state.reminders.forEach(r=>{ if(r.enabled!==false && manualShouldFire(r)){ fireNotification(r.title,r.message||"It's time for \""+r.title+"\"."); r.lastFired=today; } });
  updateBellBadge();
}

// ---- Rendering --------------------------------------------------------------
function renderSmartList(){
  const el=document.getElementById("smartRemindersList"); if(!el) return;
  const smart=state.settings.notify.smart;
  el.innerHTML=Object.keys(smart).map(key=>{
    const c=smart[key];
    return `<article class="card remind-row">
      <div><h3>${esc(c.label)}</h3><p>${esc(c.desc)}</p></div>
      <div class="remind-right">
        <label class="remind-time">🕘 <input type="time" value="${esc(c.time)}" onchange="setSmartTime('${key}',this.value)"></label>
        <label class="switch"><input type="checkbox" ${c.enabled?"checked":""} onchange="toggleSmart('${key}',this.checked)"><i></i></label>
      </div>
    </article>`;
  }).join("");
}
function setSmartTime(key,val){ if(state.settings.notify.smart[key]){ state.settings.notify.smart[key].time=val||"09:00"; remindSave(); } }
function toggleSmart(key,on){ if(state.settings.notify.smart[key]){ state.settings.notify.smart[key].enabled=on; remindSave(); } }

function renderManualList(){
  const el=document.getElementById("manualRemindersList"); if(!el) return;
  const list=state.reminders.slice().sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  el.innerHTML=list.length?list.map(r=>{
    const when=r.recur==="daily"?"Daily"+(r.time?" · "+r.time:""):r.recur==="weekly"?"Weekly "+(r.weekday||"")+(r.time?" · "+r.time:""):(r.date?fmtDate(r.date):"No date")+(r.time?" · "+r.time:"");
    return `<article class="card remind-row">
      <div><h3>${esc(r.title)}</h3><p>${esc(r.message||when)}</p></div>
      <div class="remind-right">
        <span class="remind-time">${esc(when)}</span>
        <label class="switch"><input type="checkbox" ${r.enabled!==false?"checked":""} onchange="toggleManual('${r.id}',this.checked)"><i></i></label>
        ${actionButtons("reminder",r.id)}
      </div>
    </article>`;
  }).join(""):`<div class="empty-state">No manual reminders yet. Tap “＋ Add reminder” to create one.</div>`;
}
function toggleManual(id,on){ const r=state.reminders.find(x=>x.id===id); if(r){ r.enabled=on; remindSave(); } }

function renderReminders(){
  const master=document.getElementById("remindMasterBtn"); if(master){ master.textContent=notifyEnabled()?"On":"Enable"; }
  const permText=document.getElementById("notifyPermText"), permBtn=document.getElementById("notifyPermBtn");
  if(permBtn){
    if(notifyBrowserGranted()){ permBtn.textContent="Granted ✓"; permBtn.disabled=true; if(permText) permText.textContent="Browser notifications are on."; }
    else{ permBtn.textContent=state.settings.notify.browser?"Retry":"Allow"; permBtn.disabled=false; if(permText) permText.textContent=state.settings.notify.browser?"You previously chose to allow — click Retry.":"Not granted — browser notifications will fall back to in-app toasts."; }
  }
  renderSmartList();
  renderManualList();
}
function toggleRemindMaster(){ state.settings.notify.enabled=!notifyEnabled(); remindSave(); }
function requestNotifyPerm(){
  if(typeof Notification==="undefined"){ showToast("Browser notifications aren't supported here.",true); return; }
  Notification.requestPermission().then(p=>{
    state.settings.notify.browser=(p==="granted");
    remindSave();
    if(p==="granted"){ showToast("Browser notifications enabled."); }
    else showToast("Browser notifications blocked.",true);
  }).catch(()=>showToast("Couldn't request notification permission.",true));
}

// ---- Bell menu --------------------------------------------------------------
function updateBellBadge(){
  const b=document.getElementById("bellBadge"); if(!b) return;
  const unread=(state.settings.notify.log||[]).filter(x=>!x.read).length;
  b.hidden=!unread;
  b.textContent=unread>99?"99+":String(unread);
}
function renderNotifyMenu(){
  const body=document.getElementById("notifyMenuBody"); if(!body) return;
  const log=(state.settings.notify.log||[]).slice().reverse();
  body.innerHTML=log.length?log.map(x=>{
    const t=x.time?new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date(x.time)):"";
    return `<div class="notify-item ${x.read?"":"unread"}"><strong>${esc(x.title)}<span class="notify-time">${esc(t)}</span></strong>${x.body?`<small>${esc(x.body)}</small>`:""}</div>`;
  }).join(""):`<div class="notify-empty">No notifications yet.</div>`;
}
function markAllRead(){ const log=state.settings.notify.log||[]; log.forEach(x=>x.read=true); remindSave(); updateBellBadge(); renderNotifyMenu(); }

// ---- Wire up UI --------------------------------------------------------------
const bell=document.getElementById("notifyBell"), menu=document.getElementById("notifyMenu");
if(bell){
  bell.onclick=e=>{ e.stopPropagation(); const open=menu.hidden; menu.hidden=!open; bell.setAttribute("aria-expanded",String(!open)); };
}
document.addEventListener("click",e=>{
  if(menu&&!menu.hidden&&!e.target.closest("#notifyWrap")){ menu.hidden=true; if(bell) bell.setAttribute("aria-expanded","false"); }
});
document.getElementById("notifyMarkAll")?.addEventListener("click",markAllRead);
document.getElementById("addReminderBtn")?.addEventListener("click",()=>openForm("reminder"));
document.getElementById("remindMasterBtn")?.addEventListener("click",toggleRemindMaster);
document.getElementById("notifyPermBtn")?.addEventListener("click",requestNotifyPerm);

// Check once shortly after load, then every 30s.
setTimeout(checkReminders,3000);
setInterval(checkReminders,30000);

renderAll();
