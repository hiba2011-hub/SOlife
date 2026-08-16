const STORAGE_KEY = "lifeos_phase1_v1";
const state = loadState();
ensurePhase2Data();
let currentPage = "dashboard";
let presetEditId = null;
let calendarCursor = new Date();
let weekCursor = new Date();

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
    settings:{theme:"light",quranDailyGoal:1},
    dikr:[
      {id:uid("dikr"),name:"Morning Dikr",target:1,history:{}},
      {id:uid("dikr"),name:"Evening Dikr",target:1,history:{}}
    ],
    quran:[]
  };
}
function loadState(){
  try{ const raw=localStorage.getItem(STORAGE_KEY); return raw?JSON.parse(raw):defaultState(); }
  catch(e){ return defaultState(); }
}
function ensurePhase2Data(){
  // Migrate older/localStorage versions safely. Every collection must exist
  // before any page renderer touches it.
  state.tasks ||= [];
  state.events ||= [];
  state.study ||= [];
  state.habits ||= [];
  state.expenses ||= [];
  state.workouts ||= [];
  state.meals ||= [];
  state.groceries ||= [];
  state.savings ||= [];
  state.dikr ||= [];
  state.quran ||= [];
  state.settings ||= {};
  state.settings.theme ||= "light";
  state.settings.quranDailyGoal ||= 1;
  state.settings.dikrCounter ||= 0;
}
function save(){ localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); renderAll(); }

function pageNav(page){
  currentPage=page;
  document.querySelectorAll(".page").forEach(p=>p.classList.remove("active"));
  document.getElementById("page-"+page)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  if(window.innerWidth<=760) document.getElementById("sidebar").classList.remove("open");
}
document.querySelectorAll("[data-page]").forEach(b=>b.addEventListener("click",()=>pageNav(b.dataset.page)));

// Planner navigation controls
document.getElementById("prevMonth")?.addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar()});
document.getElementById("nextMonth")?.addEventListener("click",()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar()});
document.getElementById("prevWeek")?.addEventListener("click",()=>{weekCursor.setDate(weekCursor.getDate()-7);renderWeek()});
document.getElementById("nextWeek")?.addEventListener("click",()=>{weekCursor.setDate(weekCursor.getDate()+7);renderWeek()});
document.getElementById("weeklyResetBtn")?.addEventListener("click",openWeeklyReset);
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
});
document.getElementById("menuBtn").onclick=()=>document.getElementById("sidebar").classList.toggle("open");
document.getElementById("floatingAdd").onclick=()=>openQuickAdd();
document.getElementById("quickAddBtn").onclick=()=>openQuickAdd();
document.getElementById("addTaskFromTimeline").onclick=()=>openForm("task");
document.getElementById("closeModal").onclick=closeModal;
document.getElementById("modalBackdrop").addEventListener("click",e=>{if(e.target.id==="modalBackdrop")closeModal()});
document.getElementById("themeBtn").onclick=toggleTheme;
document.getElementById("settingsTheme").onclick=toggleTheme;
document.addEventListener("click",e=>{
  const a=e.target.closest("[data-action]");
  if(!a)return;
  const action=a.dataset.action;
  if(action==="add-dikr")openForm("dikr");
  if(action==="add-quran")openForm("quran");
  if(action==="quran-goal")setQuranGoal();
});

function toggleTheme(){ state.settings.theme=state.settings.theme==="dark"?"light":"dark"; save(); }
function applyTheme(){ document.body.classList.toggle("dark",state.settings.theme==="dark"); }

function greeting(){
  const h=new Date().getHours();
  return h<12?"Good morning, Hiba.":h<18?"Good afternoon, Hiba.":"Good evening, Hiba.";
}
function renderDashboard(){
  const today=isoDate(), d=new Date();
  document.getElementById("todayLabel").textContent=new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(d).toUpperCase();
  document.getElementById("sideDate").textContent=fmtDate(today,{weekday:"long",month:"short",day:"numeric"});
  document.getElementById("greeting").textContent=greeting();
  const items=[
    ...state.tasks.filter(x=>x.date===today).map(x=>({...x,type:"task"})),
    ...state.study.filter(x=>x.date===today).map(x=>({...x,title:x.subject?`${x.subject} · ${x.topic||"Study session"}`:"Study session",type:"study"}))
  ];
  const done=items.filter(x=>x.done).length,total=items.length,pct=total?Math.round(done/total*100):0;
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
  const habits=state.habits.map(h=>h.history?.[today]).filter(Boolean).length;
  document.getElementById("areaHabits").textContent=(state.habits.length?Math.round(habits/state.habits.length*100):0)+"%";
  document.getElementById("areaMoney").textContent=money(spend);
  document.getElementById("areaTasks").textContent=state.tasks.filter(x=>x.date===today&&!x.done).length;
  const timeline=document.getElementById("todayTimeline"),sorted=items.sort((a,b)=>(a.time||"99:99").localeCompare(b.time||"99:99"));
  timeline.classList.toggle("empty-state",!sorted.length);
  timeline.innerHTML=sorted.length?sorted.map(x=>`
    <div class="timeline-item"><span class="timeline-time">${esc(x.time||"Anytime")}</span><span class="timeline-dot"></span>
      <div><strong>${esc(x.title||"Untitled")}</strong><small>${x.done?"Completed":"Planned"}</small></div>
      ${actionButtons(x.type,x.id)}
    </div>`).join(""):"Nothing planned yet. Add your first task.";
  document.getElementById("dashboardStudy").innerHTML=state.study.filter(x=>x.date>=today).slice(0,3).map(x=>`
    <div class="list-item"><div><strong>${esc(x.subject||"Study session")}</strong><small>${fmtDate(x.date)} · ${esc(x.topic||"No topic")}</small></div><span class="priority">${x.done?"Done":esc(x.priority)}</span>${actionButtons("study",x.id)}</div>`).join("") || `<div class="empty-state">No upcoming study sessions.</div>`;
  document.getElementById("dashboardHabits").innerHTML=state.habits.slice(0,5).map(h=>`
    <div class="list-item"><div><strong>${esc(h.name)}</strong><small>${h.history?.[today]?"Completed today":"Ready for today"}</small></div>
    <button class="check ${h.history?.[today]?"done":""}" onclick="toggleHabit('${h.id}')">${h.history?.[today]?"✓":""}</button>${actionButtons("habit",h.id)}</div>`).join("");
}

function money(n){ return `${Number(n||0).toLocaleString(undefined,{maximumFractionDigits:2})} DH`; }

function renderCalendar(){
  const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth();
  document.getElementById("monthTitle").textContent=new Intl.DateTimeFormat(undefined,{month:"long",year:"numeric"}).format(calendarCursor);
  const first=new Date(y,m,1), offset=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
  let cells="";
  for(let i=0;i<offset;i++) cells+=`<div class="day-cell"></div>`;
  for(let day=1;day<=days;day++){
    const date=isoDate(new Date(y,m,day)), today=date===isoDate();
    const events=[
      ...state.tasks.filter(x=>x.date===date).map(x=>({title:x.title,type:"task",id:x.id,model:"task",done:x.done})),
      ...state.study.filter(x=>x.date===date).map(x=>({title:x.subject||"Study",type:"study",id:x.id,model:"study",done:x.done})),
      ...state.events.filter(x=>x.date===date).map(x=>({title:x.title,type:x.type||"personal",id:x.id,model:"event"}))
    ];
    cells+=`<div class="day-cell"><div class="day-number ${today?"today":""}">${day}</div>${events.slice(0,4).map(e=>`<div class="event-pill event-${e.type}">${(e.model==="task"||e.model==="study")?`<button class="mini-check ${e.done?"done":""}" onclick="event.stopPropagation();toggleRecordDone('${e.model}','${e.id}')">${e.done?"✓":""}</button>`:""}<span class="event-label ${e.done?"completed":""}">${esc(e.title)}</span><span class="event-actions"><button class="action-btn edit" onclick="openForm('${e.model}',undefined,'${e.id}')">✎</button><button class="action-btn delete" onclick="deleteRecord('${e.model}','${e.id}')">×</button></span></div>`).join("")}</div>`;
  }
  const total=Math.ceil((offset+days)/7)*7;
  for(let i=offset+days;i<total;i++) cells+=`<div class="day-cell"></div>`;
  document.getElementById("calendar").innerHTML=`<div class="calendar-head">${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(x=>`<div>${x}</div>`).join("")}</div><div class="calendar-body">${cells}</div>`;
}

function renderWeek(){
  const start=startOfWeek(weekCursor), end=new Date(start);end.setDate(end.getDate()+6);
  document.getElementById("weekTitle").textContent=`${fmtDate(isoDate(start),{month:"short",day:"numeric"})} – ${fmtDate(isoDate(end),{month:"short",day:"numeric",year:"numeric"})}`;
  let html="";
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);const date=isoDate(d);
    const tasks=state.tasks.filter(x=>x.date===date);
    const study=state.study.filter(x=>x.date===date);
    html+=`<article class="card week-day ${date===isoDate()?"today":""}">
      <header><div><span class="eyebrow">${new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(d).toUpperCase()}</span><strong>${d.getDate()}</strong></div><button class="week-add" onclick="openForm('task','${date}')">＋</button></header>
      ${study.map(x=>`<div class="week-block"><div class="week-main"><button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('study','${x.id}')">${x.done?"✓":""}</button><div><strong class="${x.done?"completed":""}">◒ ${esc(x.subject||"Study")}</strong><small>${esc(x.time||"")} · ${esc(x.topic||"")}</small></div></div>${actionButtons("study",x.id)}</div>`).join("")}
      ${tasks.map(x=>`<div class="week-block"><div class="week-main"><button class="mini-check ${x.done?"done":""}" onclick="toggleRecordDone('task','${x.id}')">${x.done?"✓":""}</button><div><strong class="${x.done?"completed":""}">${esc(x.title)}</strong><small>${esc(x.time||"Anytime")}</small></div></div>${actionButtons("task",x.id)}</div>`).join("")}
      ${!tasks.length&&!study.length?`<div class="empty-state">Open space</div>`:""}
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
function toggleRecordDone(type,id){const map={task:"tasks",study:"study"};const item=state[map[type]]?.find(x=>x.id===id);if(!item)return;item.done=!item.done;save()}

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
  }).join("");
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

function toggleWorkout(id){const x=state.workouts.find(x=>x.id===id);if(x){x.done=!x.done;save()}}
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
  const studyPct=state.study.length?Math.round(state.study.filter(x=>x.done).length/state.study.length*100):0;
  const habitPct=state.habits.length?Math.round(state.habits.filter(x=>x.history?.[today]).length/state.habits.length*100):0;
  const start=startOfWeek(new Date()),end=new Date(start);end.setDate(end.getDate()+6);
  const week=state.workouts.filter(x=>x.date>=isoDate(start)&&x.date<=isoDate(end));
  const workoutPct=week.length?Math.round(week.filter(x=>x.done).length/week.length*100):0;
  const taskPct=state.tasks.length?Math.round(state.tasks.filter(x=>x.done).length/state.tasks.length*100):0;
  const dikrPct=state.dikr.length?Math.round(state.dikr.filter(x=>x.history?.[today]).length/state.dikr.length*100):0;
  const set=(id,value)=>{const el=document.getElementById(id);if(el)el.textContent=value};
  const bar=(id,value)=>{const el=document.getElementById(id);if(el)el.style.width=value+"%"};
  set("aStudy",studyPct+"%");bar("aStudyBar",studyPct);
  set("aHabits",habitPct+"%");bar("aHabitsBar",habitPct);
  set("aTasks",taskPct+"%");bar("aTasksBar",taskPct);
  set("aDikr",dikrPct+"%");bar("aDikrBar",dikrPct);
  const snapshot=document.getElementById("weeklySnapshot");
  if(snapshot){snapshot.innerHTML=[["Study",studyPct],["Habits",habitPct],["Workouts",workoutPct],["Dikr",dikrPct]].map(([name,val])=>`<div class="analytics-bar-row"><span>${name}</span><div class="analytics-bar"><i style="width:${val}%"></i></div><strong>${val}%</strong></div>`).join("")}
  const month=new Date().toISOString().slice(0,7);
  const spend=state.expenses.filter(x=>x.date?.startsWith(month)).reduce((a,x)=>a+Number(x.amount||0),0);
  const moneyEl=document.getElementById("aMoney");if(moneyEl)moneyEl.textContent=money(spend);
}


function openQuickAdd(){openForm("quick")}
let editingRecord=null;

function recordFor(type,id){
  const map={task:"tasks",study:"study",event:"events",expense:"expenses",habit:"habits",workout:"workouts",meal:"meals",grocery:"groceries",savings:"savings",dikr:"dikr",quran:"quran"};
  return id && map[type] ? state[map[type]].find(x=>x.id===id) : null;
}
function actionButtons(type,id){
  return `<div class="item-actions">
    <button class="action-btn edit" title="Edit" onclick="openForm('${type}',undefined,'${id}')">✎</button>
    <button class="action-btn delete" title="Delete" onclick="deleteRecord('${type}','${id}')">×</button>
  </div>`;
}
function deleteRecord(type,id){
  const map={task:"tasks",study:"study",event:"events",expense:"expenses",habit:"habits",workout:"workouts",meal:"meals",grocery:"groceries",savings:"savings",dikr:"dikr",quran:"quran"};
  const key=map[type]; if(!key)return;
  const item=state[key].find(x=>x.id===id); if(!item)return;
  const label=item.title||item.name||item.subject||item.type||"this item";
  if(!confirm(`Delete "${label}"?`))return;
  state[key]=state[key].filter(x=>x.id!==id);
  save();
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
    content=`<div class="form-grid">${field("Dikr name","name","text",val("name"),"required",true)}</div>`;
  }else if(type==="quran"){
    title.textContent=r?"Edit Quran session":"Quran session"; eyebrow.textContent="QURAN";
    content=`<div class="form-grid">${field("Surah","surah","text",val("surah"),"required")}${field("Ayah range","ayahRange","text",val("ayahRange"),"required")}${selectField("Session type","qType",["Memorisation","Revision"],val("type","Memorisation"))}${field("Date","date","date",val("date",presetDate),"required")}${field("Time","time","time",val("time"))}${selectField("Confidence","confidence",["steady","building","strong"],val("confidence","steady"))}${field("Notes","notes","textarea",val("notes"),"",true)}</div>`;
  }
  form.innerHTML=content+`<div class="form-actions">${type!=="quick"?`<button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">${r?"Save changes":"Save"}</button>`:""}</div>`;
  form.onsubmit=e=>{e.preventDefault();handleForm(type,new FormData(form),editId)};
  document.getElementById("modalBackdrop").classList.add("open");
}
function closeModal(){document.getElementById("modalBackdrop").classList.remove("open");editingRecord=null}
function handleForm(type,fd,editId=null){
  const d=Object.fromEntries(fd.entries());
  const map={task:"tasks",study:"study",event:"events",expense:"expenses",workout:"workouts",meal:"meals",grocery:"groceries",savings:"savings",habit:"habits",dikr:"dikr",quran:"quran"};
  const key=map[type];
  if(editId && key){
    const item=state[key]?.find(x=>x.id===editId);
    if(item){
      if(type==="study") Object.assign(item,d,{duration:Number(d.duration||60)});
      else if(type==="expense") Object.assign(item,d,{amount:Number(d.amount||0)});
      else if(type==="savings") Object.assign(item,d,{target:Number(d.target||0),saved:Number(d.saved||0)});
      else if(type==="habit"||type==="dikr") item.name=d.name;
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
    if(type==="dikr") state.dikr.push({id:uid("dikr"),name:d.name,target:1,history:{}});
    if(type==="quran"){d.type=d.qType;delete d.qType;state.quran.push({id:uid("quran"),...d})}
  }
  closeModal();save();
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
    <div class="form-actions"><button type="button" class="secondary-btn" onclick="closeModal()">Cancel</button><button class="primary-btn">Create weekly draft</button></div>`;
  document.getElementById("modalForm").onsubmit=e=>{e.preventDefault();alert("Weekly reset captured. In the next phase, these answers can automatically create calendar blocks.");closeModal()};
  document.getElementById("modalBackdrop").classList.add("open");
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


function renderDikr(){
  const today=isoDate();
  const done=state.dikr.filter(x=>x.history?.[today]).length;
  document.getElementById("dikrTodayCount").textContent=`${done} / ${state.dikr.length}`;
  document.getElementById("dikrTodayBar").style.width=(state.dikr.length?done/state.dikr.length*100:0)+"%";
  initDikrCounter();
  document.getElementById("dikrList").innerHTML=state.dikr.map(x=>`
    <div class="list-item">
      <div><strong>${esc(x.name)}</strong><small>${x.history?.[today]?"Completed today":"Ready for today"}</small></div>
      <div style="display:flex;gap:7px">
        <button class="check ${x.history?.[today]?"done":""}" onclick="toggleDikr('${x.id}')">${x.history?.[today]?"✓":""}</button>
        <button class="icon-btn small-btn" onclick="editDikr('${x.id}')">✎</button>
        <button class="icon-btn small-btn" onclick="deleteDikr('${x.id}')">×</button>
      </div>
    </div>`).join("")||`<div class="empty-state">No Dikr added yet.</div>`;
}
function initDikrCounter(){state.settings.dikrCounter=Number(state.settings.dikrCounter||0);const value=document.getElementById("dikrCounterValue"),btn=document.getElementById("dikrCounterBtn"),reset=document.getElementById("dikrResetCounter");if(value)value.textContent=state.settings.dikrCounter;if(btn)btn.onclick=()=>{state.settings.dikrCounter++;save()};if(reset)reset.onclick=()=>{state.settings.dikrCounter=0;save()}}
function toggleDikr(id){const x=state.dikr.find(x=>x.id===id);if(!x)return;x.history=x.history||{};const d=isoDate();x.history[d]=!x.history[d];save()}
function deleteDikr(id){if(confirm("Delete this Dikr?")){state.dikr=state.dikr.filter(x=>x.id!==id);save()}}
function editDikr(id){openForm("dikr",null,id)}

function renderQuran(){
  const today=isoDate(), start=startOfWeek(new Date()), end=new Date(start);end.setDate(end.getDate()+6);
  const week=state.quran.filter(x=>x.date>=isoDate(start)&&x.date<=isoDate(end));
  document.getElementById("quranWeekCount").textContent=week.length;
  document.getElementById("quranMemCount").textContent=state.quran.filter(x=>x.type==="Memorisation").length;
  document.getElementById("quranRevCount").textContent=state.quran.filter(x=>x.type==="Revision").length;
  const goal=Number(state.settings.quranDailyGoal||1);
  const todayCount=state.quran.filter(x=>x.date===today).length;
  document.getElementById("quranGoalValue").textContent=`${Math.min(todayCount,goal)} / ${goal}`;
  document.getElementById("quranGoalBar").style.width=Math.min(todayCount/Math.max(goal,1)*100,100)+"%";
  document.getElementById("quranList").innerHTML=state.quran.slice().sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time)).map(x=>`
    <div class="list-item">
      <div><strong>${esc(x.surah)} · ${esc(x.ayahRange)}</strong><small>${fmtDate(x.date)} · ${esc(x.type)}${x.notes?" · "+esc(x.notes):""}</small></div>
      <div style="display:flex;gap:7px;align-items:center"><span class="quran-type">${esc(x.confidence||"steady")}</span><button class="icon-btn small-btn" onclick="editQuran('${x.id}')">✎</button><button class="icon-btn small-btn" onclick="deleteQuran('${x.id}')">×</button></div>
    </div>`).join("")||`<div class="empty-state">No Quran sessions recorded yet.</div>`;
}
function deleteQuran(id){if(confirm("Delete this Quran session?")){state.quran=state.quran.filter(x=>x.id!==id);save()}}
function editQuran(id){openForm("quran",null,id)}

function setQuranGoal(){
  const v=prompt("How many Quran sessions would you like as your daily goal?",String(state.settings.quranDailyGoal||1));
  if(v!==null && Number(v)>0){state.settings.quranDailyGoal=Math.round(Number(v));save()}
}

function renderAll(){
  applyTheme();renderDashboard();renderCalendar();renderWeek();renderStudy();renderHabits();renderMoney();renderWorkouts();renderMeals();renderSavings();renderDikr();renderQuran();renderAnalytics();
}
renderAll();
