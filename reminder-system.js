import "./functions-correct/task-core.js";
import "./task-options.js?v=2026-09-17-time-zones";
import "./search-ui.js?v=2026-09-17-search-theme";
import "./calendar-view.js?v=2026-09-17-calendar";
const TaskCore=globalThis.TaskCore,TaskOptions=globalThis.TaskOptions;
import{initializeApp}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import{initializeAppCheck,ReCaptchaEnterpriseProvider}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import{getAuth,GoogleAuthProvider,FacebookAuthProvider,onAuthStateChanged,signInWithPopup,signOut}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import{getFirestore,collection,doc,getDoc,getDocs,setDoc,deleteDoc}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const c={apiKey:"AIzaSyCe3qaOFx6ey5LAghth8l2cQ9VonSY7hnQ",authDomain:"easy-reminder-system.firebaseapp.com",projectId:"easy-reminder-system",storageBucket:"easy-reminder-system.firebasestorage.app",messagingSenderId:"502381230653",appId:"1:502381230653:web:8a0162b42b25d5356e4854"};
const a=initializeApp(c);
let appCheck=null;
try{appCheck=initializeAppCheck(a,{provider:new ReCaptchaEnterpriseProvider("6LfccbstAAAAAACjUCUaBSbXPPAD0-un914Et1O6"),isTokenAutoRefreshEnabled:true})}catch(e){console.error("Firebase App Check initialization failed:",e)}const auth=getAuth(a),db=getFirestore(a),provider=new GoogleAuthProvider(),fbProvider=new FacebookAuthProvider(),$=i=>document.getElementById(i);
let user=null,reminders=[],notificationsEnabled=false,view="inbox",query="",labelFilter="",priorityFilter="",idleTimer=null,idleLogoutTimer=null,idleWarningOpen=false,editingId=null,activeLoginAttempt=null;
const notifiedOccurrences=new Map();
let notificationAttempt=0,notificationPending=false,nativeNotificationsFailed=false,notificationStorageAvailable=true;
let recentAlerts=[];
let authGeneration=0;
let searchUi=null;
let calendarUi=null;
const openNotifications=new Set();
const IDLE_LIMIT=60000,IDLE_GRACE=30000,now=new Date(),units={once:"one time",minutes:"minute(s)",hours:"hour(s)",days:"day(s)",weeks:"week(s)"};
$("date").value=now.toISOString().slice(0,10);
$("startTime").value="09:00";
$("endTime").value="10:00";

function hideIdleWarning(){idleWarningOpen=false;
if(idleLogoutTimer)clearTimeout(idleLogoutTimer);
idleLogoutTimer=null;
$("idleWarning").classList.add("hidden")}async function signOutForInactivity(){hideIdleWarning();
await signOut(auth);
$("authError").textContent="You were signed out after 1 minute and 30 seconds of inactivity."}function showIdleWarning(){if(!user||idleWarningOpen)return;
idleWarningOpen=true;
$("idleWarning").classList.remove("hidden");
$("idleStayBtn").focus();
idleLogoutTimer=setTimeout(signOutForInactivity,IDLE_GRACE)}function resetIdleTimer(){if(idleTimer)clearTimeout(idleTimer);
idleTimer=null;
if(!user||idleWarningOpen||(notificationsEnabled&&$("keepReminderSession").checked))return;
idleTimer=setTimeout(showIdleWarning,IDLE_LIMIT)}["click","keydown","mousemove","touchstart","scroll"].forEach(type=>window.addEventListener(type,resetIdleTimer,{passive:true}));
$("idleStayBtn").onclick=()=>{hideIdleWarning();
resetIdleTimer()};
$("idleSignOutBtn").onclick=signOutForInactivity;
// Spark/free mode: the open page is the scheduler. No FCM tokens, Cloud Functions,
// service worker, or Firestore polling is involved in delivering these alerts.
function notificationPreferenceKey(){return "easy-reminder:page-notifications:"+user.uid}
function receiptKey(){return "easy-reminder:page-receipts:"+user.uid}
function readLocal(key){try{return localStorage.getItem(key)}catch(_){notificationStorageAvailable=false;return null}}
function writeLocal(key,value){try{localStorage.setItem(key,value)}catch(_){notificationStorageAvailable=false}}
function closeNativeNotifications(){for(const item of openNotifications){try{item.close()}catch(_){}}openNotifications.clear()}
function clearPageAlerts(){recentAlerts=[];$("pageAlertList").innerHTML="";$("pageAlerts").classList.add("hidden");closeNativeNotifications()}
function showPageAlert(title,body){
  recentAlerts.unshift({title,body});recentAlerts=recentAlerts.slice(0,10);
  $("pageAlertList").innerHTML=recentAlerts.map(item=>'<li><strong>'+esc(item.title)+'</strong><p>'+esc(item.body)+'</p></li>').join("");
  $("pageAlerts").classList.remove("hidden");
}
function updateNotificationUi(){
  const statusEl=$("notificationStatus"),button=$("notificationBtn");if(!statusEl||!button)return;
  const nativeReady="Notification" in window&&Notification.permission==="granted"&&!nativeNotificationsFailed;
  const session=notificationsEnabled&&$("keepReminderSession").checked;
  statusEl.classList.toggle("enabled",notificationsEnabled);
  statusEl.textContent=notificationsEnabled
    ?(nativeReady?"Page reminders on; browser notifications allowed.":"Page reminders on; alerts appear inside this page only.")
      +(session?" This tab will stay signed in.":" Auto sign-out after 90 seconds of inactivity pauses reminders.")
    :"Page reminders are off for this account in this browser.";
  if(!notificationStorageAvailable)statusEl.textContent+=" Browser storage is unavailable; settings and duplicate protection last only for this session.";
  button.textContent=notificationsEnabled?"Disable page reminders":"Enable page reminders";
  button.disabled=!user||notificationPending;
  $("keepReminderSession").disabled=!notificationsEnabled;
}
function loadNotificationSetting(){
  notificationsEnabled=false;notificationStorageAvailable=true;
  if(user)notificationsEnabled=readLocal(notificationPreferenceKey())==="enabled";
  updateNotificationUi();
}
function checkDueNotifications(){
  if(!user||!notificationsEnabled)return;
  const nowMs=Date.now(),cutoff=nowMs-TaskCore.DAY;
  for(const [key,stamp] of notifiedOccurrences)if(stamp<cutoff)notifiedOccurrences.delete(key);
  // Shared receipts suppress repeats after a reload and across sequential tab checks.
  // Without cross-tab locking, simultaneous checks in two tabs remain best effort.
  try{
    const saved=JSON.parse(readLocal(receiptKey())||"[]");
    if(Array.isArray(saved))for(const entry of saved){
      if(Array.isArray(entry)&&typeof entry[0]==="string"&&Number.isFinite(entry[1])&&entry[1]>=cutoff&&entry[1]<=nowMs)notifiedOccurrences.set(entry[0],entry[1]);
    }
  }catch(_){}
  let changed=false;
  for(const r of reminders){
    try{
      for(const delivery of TaskCore.dueNotifications(r,nowMs)){
        const key=user.uid+":"+r.id+":"+delivery.id;
        if(notifiedOccurrences.has(key))continue;
        const body=TaskCore.summary(r,delivery.start);
        showPageAlert(r.title,body);
        if("Notification" in window&&Notification.permission==="granted"&&!nativeNotificationsFailed){
          try{
            const item=new Notification(r.title,{body,tag:"easy-reminder-"+key});
            openNotifications.add(item);
            item.onclose=()=>openNotifications.delete(item);
            // Bound retained browser notifications in a long-running tab.
            if(openNotifications.size>10){const oldest=openNotifications.values().next().value;oldest.close();openNotifications.delete(oldest)}
          }catch(_){nativeNotificationsFailed=true;}
        }
        notifiedOccurrences.set(key,delivery.scheduled);changed=true;
      }
    }catch(error){console.warn("Invalid reminder schedule",r.id,error);}
  }
  if(changed)writeLocal(receiptKey(),JSON.stringify([...notifiedOccurrences].slice(-2000)));
  updateNotificationUi();
}
async function toggleNotifications(){
  if(!user||notificationPending)return;
  const uid=user.uid,attempt=++notificationAttempt;
  if(notificationsEnabled){
    notificationsEnabled=false;$("keepReminderSession").checked=false;
    writeLocal(notificationPreferenceKey(),"disabled");clearPageAlerts();updateNotificationUi();resetIdleTimer();return;
  }
  notificationPending=true;updateNotificationUi();
  // Permission is requested only from this click, never on sign-in or task save.
  if("Notification" in window&&Notification.permission==="default"){
    try{await Notification.requestPermission()}catch(_){}
  }
  if(!user||user.uid!==uid||attempt!==notificationAttempt)return;
  notificationPending=false;notificationsEnabled=true;nativeNotificationsFailed=false;
  writeLocal(notificationPreferenceKey(),"enabled");updateNotificationUi();resetIdleTimer();
  status("Page reminders enabled. Keep this page open, signed in, and your device awake.");
  checkDueNotifications();
}
$("keepReminderSession").onchange=()=>{if(notificationsEnabled&&$("keepReminderSession").checked)hideIdleWarning();resetIdleTimer();updateNotificationUi()};
$("clearPageAlerts").onclick=clearPageAlerts;
window.addEventListener("focus",()=>{updateNotificationUi();checkDueNotifications()});
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")checkDueNotifications()});
window.addEventListener("storage",event=>{
  if(!user)return;
  if(event.key===notificationPreferenceKey()||event.key===null){
    loadNotificationSetting();
    if(!notificationsEnabled){notificationAttempt++;notificationPending=false;$("keepReminderSession").checked=false;clearPageAlerts()}
    resetIdleTimer();updateNotificationUi();
  }
});
setInterval(checkDueNotifications,15000);function esc(s){return String(s).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]))}function key(d){let x=new Date(d);
return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")}function clock(d){return Number.isNaN(d.getTime())?"":String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}function taskEnd(r){return new Date(TaskCore.endInstant(r))}
function normalizeReminder(r){
  if(r.schemaVersion===2)return TaskCore.normalize(r);
  // Keep legacy schedule arithmetic until it is explicitly edited and upgraded.
  const start=new Date(r.next),end=taskEnd(r);
  return {...r,startTime:r.startTime||clock(start),endTime:r.endTime||clock(end)};
}
function priorityName(value){return value.charAt(0).toUpperCase()+value.slice(1)+" Priority"}function startLabel(r){
  if(r.done)return "Completed";
  const next=displayStart(r);
  if(next===null)return "Repeat schedule finished";
  if(r.allDay)return TaskCore.parts(next,r.timeZone).date+" · All day ("+r.timeZone+")";
  return "Start "+new Date(next).toLocaleString([],{dateStyle:"medium",timeStyle:"short",timeZone:r.timeZone})+(r.timeZone?" ("+r.timeZone+")":"");
}
function endLabel(r){const start=displayStart(r);if(start===null)return "No more dates";const end=TaskCore.endInstant(r,start);return r.allDay?"Through "+TaskCore.parts(end-1,r.timeZone).date:"End "+new Date(end).toLocaleString([],{dateStyle:"medium",timeStyle:"short",timeZone:r.timeZone})}
function reminderRef(id){return doc(db,"users",user.uid,"reminders",id)}function notSignedInError(){let error=new Error("You must be signed in to save reminders.");
error.code="auth/user-not-signed-in";
return error}function saveReminder(r){return user?setDoc(reminderRef(r.id),r):Promise.reject(notSignedInError())}function deleteReminder(id){return user?deleteDoc(reminderRef(id)):Promise.reject(notSignedInError())}function saveErrorMessage(error){let code=error&&error.code?error.code:"unknown",hints={"permission-denied":"Firebase denied the write. Sign in again or publish the current Firestore rules.","unauthenticated":"Your sign-in has expired. Sign in again and retry.","auth/user-not-signed-in":"Your sign-in has expired. Sign in again and retry.","failed-precondition":"Firebase App Check or the deployed rules rejected the write.","resource-exhausted":"Firebase is temporarily unavailable. Please try again."};
return "Could not save task"+(code!=="unknown"?" ["+code+"]":"")+". "+(hints[code]||"Please try again.")}function status(t){$("status").textContent=t;
setTimeout(()=>$("status").textContent="",3500)}function displayStart(r){
  if(r.repeat==="once"||r.done)return Date.parse(r.next);
  const tz=r.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
  const midnight=TaskCore.toInstant(TaskCore.parts(Date.now(),tz).date,"00:00",tz);
  return TaskCore.nextStart(r,midnight);
}
function calendarOccurrence(r){
  const normalized=TaskCore.normalize(r,Intl.DateTimeFormat().resolvedOptions().timeZone);
  const next=displayStart(r);
  if(next===null)return normalized;
  const date=TaskCore.parts(next,normalized.timeZone).date;
  return {...normalized,next:new Date(next).toISOString(),date,endDate:TaskCore.addDays(date,TaskCore.dayDiff(normalized.endDate,normalized.date))};
}
function cal(r){return TaskCore.calendarUrl(calendarOccurrence(r))}
function filtered(){const today=key(new Date());
return reminders.filter(r=>{
  if(query.trim())return TaskSearch.matchesTask(r,query);
  const start=displayStart(r),d=start===null?"":key(start),lab=!labelFilter||((r.labels||[]).includes(labelFilter)||r.category===labelFilter),prio=!priorityFilter||(r.priority||"medium")===priorityFilter;
  return view==="inbox"?!r.done:view==="today"?!r.done&&d===today:view==="upcoming"?!r.done&&d>today:view==="filters"?!r.done&&lab&&prio:view==="archived"?r.done:true;
}).sort((x,y)=>(displayStart(x)??Infinity)-(displayStart(y)??Infinity))}
function render(){
  let titles={inbox:["Inbox","Your active reminders in one place."],today:["Today","Tasks due today."],upcoming:["Upcoming","See what is coming next."],filters:["Filters & Labels","Filter active tasks by label."],reporting:["Reporting","A simple view of your progress."],archived:["Archived","Completed tasks are kept here for 30 days. Uncheck one to reopen it."]};
  titles.calendar=["Calendar","Current and upcoming tasks, with overdue tasks at the top."];
  const searching=Boolean(query.trim());

  $("pageTitle").textContent=searching?"Search results":titles[view][0];

  $("pageSubtitle").textContent=searching?'All tasks matching “'+query.trim()+'”, including archived tasks.':titles[view][1];

  $("reporting").classList.toggle("hidden",searching||view!=="reporting");

  $("taskSection").classList.toggle("hidden",!searching&&["reporting","calendar"].includes(view));
  $("calendarView").classList.toggle("hidden",searching||view!=="calendar");
  if(!searching&&view==="calendar")calendarUi?.render();

  $("listHeading").textContent=searching?"Matching tasks":view==="archived"?"Archived tasks":priorityFilter?priorityName(priorityFilter):labelFilter?"# "+labelFilter:"Tasks";
  document.querySelectorAll('[data-view]').forEach(button=>button.classList.toggle('active',!searching&&button.dataset.view===view));

  let ls=[...new Set(reminders.flatMap(r=>[...(r.labels||[]),...(r.category?[r.category]:[])]))].sort();

  $("labelList").innerHTML=ls.map(l=>'<button class="label-link" data-label="'+esc(l)+'"><span class="label-dot"></span>'+esc(l)+'</button>').join("");

  let priorities=["low","medium","high"];

  $("priorityList").innerHTML=priorities.map(p=>'<button class="priority-link '+(priorityFilter===p?"active":"")+'" data-priority="'+p+'"><span class="priority-dot priority-'+p+'"></span>'+priorityName(p)+'</button>').join("");

  let total=reminders.length,done=reminders.filter(r=>r.done).length,pct=total?Math.round(done/total*100):0;

  $("totalStat").textContent=total;

  $("doneStat").textContent=done;

  $("activeStat").textContent=total-done;

  $("progressBar").style.width=pct+"%";

  $("progressText").textContent=pct+"% complete";

  let data=filtered();

  $("empty").style.display=data.length?"none":"block";
  $("empty").textContent=searching?'No tasks match your search. Check the suggestions above for app actions.':"No tasks here.";

  $("list").innerHTML=data.map(r=>'<article class="task"><input class="task-check" type="checkbox" data-done="'+esc(r.id)+'" '+(r.done?"checked":"")+' aria-label="'+(r.done?"Reopen ":"Complete ")+esc(r.title)+'"><div class="task-body"><div class="task-title '+(r.done?"done":"")+'">'+esc(r.title)+'</div>'+(r.note?'<div class="task-note">'+esc(r.note)+'</div>':'')+'<div class="task-meta"><span class="chip due">'+esc(r.done?'Completed '+archiveStamp(r):startLabel(r))+'</span><span class="chip end">'+esc(endLabel(r))+'</span><span class="chip priority-'+(r.priority||"medium")+'">'+esc(priorityName(r.priority||"medium"))+'</span>'+(r.repeat!=="once"?'<span class="chip repeat">↻ '+esc(TaskCore.repeatLabel(r))+'</span>':"")+(r.labels||[]).map(l=>'<span class="chip label">#'+esc(l)+'</span>').join("")+'</div>'+TaskOptions.taskDetails(r)+'</div><div class="task-actions"><button data-edit="'+esc(r.id)+'">Edit</button>'+(!r.done?'<button data-calendar="'+esc(r.id)+'">Google Calendar draft</button>'+(r.guests?.length?'<button data-invite="'+esc(r.id)+'">Draft invitation email</button>':'')+'<button data-snooze="'+esc(r.id)+'">Snooze 10m</button>':"")+'<button class="danger" data-delete="'+esc(r.id)+'">Delete</button></div></article>').join("");

  searchUi?.refresh(true);
}
async function load(){
  const uid=user.uid,generation=authGeneration;
  const stillCurrent=()=>user?.uid===uid&&generation===authGeneration;
  const qs=await getDocs(collection(db,"users",uid,"reminders"));
  if(!stillCurrent())return;
  let loaded=qs.docs.map(snapshot=>normalizeReminder({...snapshot.data(),id:snapshot.id}));
  if(!loaded.length){
    const legacy=await getDoc(doc(db,"users/"+uid));
    if(!stillCurrent())return;
    const old=legacy.exists()&&Array.isArray(legacy.data().reminders)?legacy.data().reminders:[];
    loaded=old.map(normalizeReminder);
    for(const r of loaded){if(!stillCurrent())return;await setDoc(doc(db,"users",uid,"reminders",r.id),r)}
  }
  if(!stillCurrent())return;
  reminders=loaded;render();
}function updateRepeatFields(){TaskOptions.sync()}
function resetTaskForm(){editingId=null;
$("form").reset();
let current=new Date();
$("date").value=current.toISOString().slice(0,10);
$("startTime").value="09:00";
$("endTime").value="10:00";
$("formTitle").textContent="Add a task";
$("saveTaskBtn").textContent="Save task";
TaskOptions.fill();updateRepeatFields()}function openTaskForm(reminder=null){resetTaskForm();
if(reminder){editingId=reminder.id;
let due=new Date(reminder.next);
if(isNaN(due)){editingId=null;
status("Could not edit task. Its due date is invalid.");
return}let local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString();
$("title").value=reminder.title;
$("date").value=local.slice(0,10);
$("startTime").value=reminder.startTime||clock(due);
$("endTime").value=reminder.endTime||clock(new Date(due.getTime()+3600000));
$("repeat").value=reminder.repeat;
$("amount").value=reminder.amount;
$("priority").value=reminder.priority||"medium";
$("labels").value=(reminder.labels||[]).join(", ");
$("note").value=reminder.note||"";
$("formTitle").textContent="Edit task";
$("saveTaskBtn").textContent="Save changes";TaskOptions.fill(reminder)}updateRepeatFields();
$("quickAdd").classList.remove("hidden");
$("title").focus();
window.scrollTo({top:0,behavior:"smooth"})}function add(){openTaskForm()}
// Keep both providers on the same popup flow, started directly by the user's click.
const loginButtons = ["signInBtn", "facebookSignInBtn"].map(id => ({
  element: $(id),
  label: $(id).innerHTML
}));


function authMessage(providerName, error) {
  const code = error?.code || "unknown";

  const hints = {
    "auth/popup-blocked": "Allow popups for this site, then click Continue again.",
    "auth/popup-closed-by-user": "The sign-in window was closed. Please try again.",
    "auth/cancelled-popup-request": "The sign-in attempt was cancelled. Please try again.",
    "auth/operation-not-supported-in-this-environment": "Open this page in a regular browser window, then try again."
  };

  return providerName + " login failed [" + code + "]: " +
    (hints[code] || error?.message || "Please try again.");

}

async function loginWithPopup(buttonId, providerName, oauthProvider) {
  if (activeLoginAttempt?.buttonId === buttonId) return;

  const attempt = { buttonId };

  activeLoginAttempt = attempt;

  loginButtons.forEach(({ element, label }) => {
    element.disabled = element === $(buttonId);

    element.innerHTML = label;

  });

  $(buttonId).textContent = "Opening " + providerName + "...";

  $("authError").textContent = "";

  $("loginHint").textContent = "Changed your mind? Choose the other sign-in button to switch.";

  $("loginHint").classList.remove("hidden");


  try {
    // Do not await other work here: the popup needs the original click gesture.
    // Firebase cancels its previous popup when another provider is selected.
    await signInWithPopup(auth, oauthProvider);

  } catch (error) {
    // Firebase detects real popup closure. Window focus alone is not cancellation.
    if (activeLoginAttempt === attempt) {
      $("authError").textContent = authMessage(providerName, error);

    }
  } finally {
    // An older popup can settle after a switch; only the latest owns the UI.
    if (activeLoginAttempt === attempt) {
      activeLoginAttempt = null;

      $("loginHint").textContent = "";

      $("loginHint").classList.add("hidden");

      loginButtons.forEach(({ element, label }) => {
        element.disabled = false;

        element.innerHTML = label;

      });

    }
  }
}

$("facebookSignInBtn").onclick = () =>
  loginWithPopup("facebookSignInBtn", "Facebook", fbProvider);

$("signInBtn").onclick = () =>
  loginWithPopup("signInBtn", "Google", provider);

if($("notificationBtn"))$("notificationBtn").onclick=toggleNotifications;

$("signOutBtn").onclick=()=>signOut(auth);
$("sidebarAdd").onclick=add;
$("headAdd").onclick=add;
$("cancelAdd").onclick=()=>{resetTaskForm();
$("quickAdd").classList.add("hidden")};
function clearSearch(){query="";searchUi?.reset()}
function changeView(next){clearSearch();view=next;labelFilter="";priorityFilter="";render()}
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>changeView(b.dataset.view));
$("calendarNav").onclick=()=>changeView("calendar");
$("labelList").onclick=e=>{let b=e.target.closest("[data-label]");
if(b){clearSearch();view="filters";
labelFilter=b.dataset.label;
priorityFilter="";
render()}};
$("priorityList").onclick=e=>{let b=e.target.closest("[data-priority]");
if(b){clearSearch();view="filters";
labelFilter="";
priorityFilter=b.dataset.priority;
render()}};
$("repeat").onchange=updateRepeatFields;

$("form").onsubmit=async e=>{
  e.preventDefault();
  TaskOptions.error();
  const existing=editingId?reminders.find(r=>r.id===editingId):null;
  if(editingId&&!existing){TaskOptions.error("This task is no longer available. Refresh and try again.");return;}
  let reminder;
  try{
    const options=TaskOptions.read();
    const title=$("title").value.trim(),note=$("note").value.trim(),labels=$("labels").value.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
    if(!title||title.length>200||note.length>2000||labels.length>20||labels.some(x=>x.length>50))throw new Error("Please shorten the task, description, or labels. Use up to 20 labels.");
    const scheduleFields=["next","endDate","allDay","timeZone","repeat","amount","customMode","customDates","rangeEnd","notifications"];
    const changed=!existing||scheduleFields.some(k=>JSON.stringify(existing[k])!==JSON.stringify(options[k]));
    reminder={...(existing||{}),...options,id:existing?existing.id:crypto.randomUUID(),title,note,labels,priority:$("priority").value,done:existing?existing.done:false,
      scheduleVersion:changed?crypto.randomUUID():existing.scheduleVersion||"legacy",
      scheduleUpdatedAt:changed?new Date().toISOString():existing.scheduleUpdatedAt||new Date().toISOString()};
  }catch(error){TaskOptions.error(error.message);return;}
  $("saveTaskBtn").disabled=true;
  try{await saveReminder(reminder);}
  catch(error){TaskOptions.error(saveErrorMessage(error));return;}
  finally{$("saveTaskBtn").disabled=false;}
  if(existing)reminders=reminders.map(r=>r.id===existing.id?reminder:r);else reminders.push(reminder);
  resetTaskForm();
  $("quickAdd").classList.add("hidden");
  render();
  status(existing?"Task updated.":"Task saved. No invitations have been sent.");
};

document.addEventListener("click",async e=>{
  const target=e.target;
  if(target.dataset.priority){clearSearch();view="filters";labelFilter="";priorityFilter=target.dataset.priority;render();return;}
  const id=target.dataset.edit||target.dataset.invite||target.dataset.calendar||target.dataset.snooze||target.dataset.delete||target.dataset.done;
  const original=reminders.find(x=>x.id===id);
  if(!original)return;
  if(target.dataset.edit){openTaskForm(original);return;}
  if(target.dataset.calendar){window.open(cal(original),"_blank","noopener,noreferrer");return;}
  if(target.dataset.invite){
    try{window.location.href=TaskCore.invitationUrl(calendarOccurrence(original));status("Invitation draft opened. Review and send it in your email app.");}
    catch(error){status(error.message);}return;
  }
  try{
    if(target.dataset.delete){
      await deleteReminder(id);
      reminders=reminders.filter(x=>x.id!==id);
      if(editingId===id){resetTaskForm();$("quickAdd").classList.add("hidden");}
    }else{
      const r={...original};
      if(target.dataset.snooze){
        if(r.repeat!=="once"){status("Edit the schedule to reschedule a repeating task.");return;}
        const duration=Math.max(60000,taskEnd(r)-new Date(r.next));
        const start=new Date(Math.ceil((Date.now()+600000)/60000)*60000),end=new Date(start.getTime()+duration),tz=r.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
        r.next=start.toISOString();r.startTime=TaskCore.parts(start,tz).time;r.endTime=TaskCore.parts(end,tz).time;
        if(r.schemaVersion===2){r.date=TaskCore.parts(start,tz).date;r.endDate=TaskCore.parts(end,tz).date;r.allDay=false;r.notifications=[0];r.scheduleVersion=crypto.randomUUID();r.scheduleUpdatedAt=new Date().toISOString();}
      }
      if(target.dataset.done){r.done=target.checked;if(r.done)r.completedAt=new Date().toISOString();else delete r.completedAt;}
      await saveReminder(r);
      reminders=reminders.map(x=>x.id===id?r:x);
    }
    render();
  }catch(error){status(saveErrorMessage(error));render();}
});
onAuthStateChanged(auth,async u=>{user=u;
const generation=++authGeneration;
if(idleTimer)clearTimeout(idleTimer);idleTimer=null;hideIdleWarning();
notificationAttempt++;notificationPending=false;notificationsEnabled=false;nativeNotificationsFailed=false;
notifiedOccurrences.clear();reminders=[];clearPageAlerts();clearSearch();calendarUi?.reset();
$("list").innerHTML="";
$("keepReminderSession").checked=false;
if(u){$("loginGate").classList.add("hidden");
$("app").classList.remove("hidden");
$("notificationControl")?.classList.remove("hidden");
$("quickAdd").classList.add("hidden");
$("userEmail").textContent=u.email||"Signed in";
$("sidebarUser").textContent=u.email||"Signed in";
try{loadNotificationSetting();await load();if(generation!==authGeneration)return;updateNotificationUi();checkDueNotifications();
requestAnimationFrame(()=>$("taskSection").scrollIntoView({behavior:"smooth",block:"start"}))}catch(e){if(generation!==authGeneration)return;status("Could not load reminders. Check Firestore rules.")}}else{if(idleTimer)clearTimeout(idleTimer);
idleTimer=null;
hideIdleWarning();
$("loginGate").classList.remove("hidden");
$("app").classList.add("hidden");
$("notificationControl")?.classList.add("hidden");
updateNotificationUi()}resetIdleTimer()});


// Completed-task archive: completed reminders remain recoverable for 30 days.
const archiveExpiryMs=30*24*60*60*1000;
function archiveStamp(r){return r.completedAt?new Date(r.completedAt).toLocaleDateString():"Recently"}
function cleanupArchived(){if(!user)return Promise.resolve();let cutoff=Date.now()-archiveExpiryMs;return Promise.all(reminders.filter(r=>r.done&&r.completedAt&&Date.parse(r.completedAt)<cutoff).map(r=>deleteReminder(r.id))).then(()=>{reminders=reminders.filter(r=>!(r.done&&r.completedAt&&Date.parse(r.completedAt)<cutoff))})}
const archiveNav=document.createElement('button');archiveNav.type='button';archiveNav.dataset.view='archived';archiveNav.innerHTML='<span class="nav-icon">✓</span>Archived';document.querySelector('.nav').appendChild(archiveNav);archiveNav.onclick=()=>changeView('archived');
setInterval(()=>cleanupArchived().then(()=>{if(view==='archived')render()}),3600000);

TaskOptions.init();

function focusTaskField(id){
  if($("quickAdd").classList.contains("hidden"))openTaskForm();
  const field=id==="location"&&$("locationType").value==="online"?$("locationType"):$(id);
  field.focus();field.scrollIntoView({behavior:"smooth",block:"center"});
}
function searchActions(){
  const actions=[{title:"Add task",keywords:"new create reminder task",detail:"Open the task form",run:add}];
  for(const [id,title,keywords] of [
    ["inbox","Inbox","all active tasks reminders"],["today","Today","due today tasks reminders"],
    ["upcoming","Upcoming","future scheduled tasks reminders"],["calendar","Calendar","calendar month dates current upcoming overdue tasks"],["archived","Archived tasks","completed done history"],
    ["filters","Filters & Labels","filter categories labels priorities"],["reporting","Reporting","reports statistics progress completed"]
  ])actions.push({title,keywords,detail:"Open this view",run:()=>{changeView(id);$("pageTitle").focus();$("pageTitle").scrollIntoView({behavior:"smooth",block:"start"})}});
  actions.push({title:"Notification settings",keywords:"notifications alerts reminders enable disable settings",detail:"Review page reminder settings",run:()=>{$("notificationBtn").focus();$("notificationControl").scrollIntoView({behavior:"smooth",block:"center"})}});
  for(const [id,title,keywords] of [
    ["timeZone","Time zone","timezone time zone region clock"],
    ["date","Task dates and times","schedule start end date time"],
    ["allDay","All-day task","all day event time schedule"],
    ["repeat","Repeat a task","recurring recurrence repeat daily weekly monthly annually custom dates range"],
    ["location","Location or online","where address venue place location online"],
    ["conferenceType","Google Meet or Zoom link","video conference conferencing google meet zoom meeting link"],
    ["guests","Invite guests by email","invite invitation share others guests email"],
    ["note","Task description","description notes details instructions"],
    ["driveUrl","Google Drive attachment","google drive docs attachment document file link"],
    ["category","Task category","category categories home work personal family religion health finances errands shopping travel learning fitness social admin planning someday maybe custom"],
    ["labels","Task labels","labels tags organize"],["priority","Task priority","priority high medium low"],
    ["addNotification","Task notification timings","notifications alerts multiple custom 5 10 15 30 minutes hour day before"]
  ])actions.push({title,keywords,detail:"Go to this option in the task form",run:()=>focusTaskField(id)});
  for(const mode of ["dark","light"])actions.push({title:mode==="dark"?"Use dark theme":"Use light theme",keywords:mode+" theme appearance mode settings "+(mode==="dark"?"night black":"day bright"),detail:"Change this browser’s appearance",run:()=>{globalThis.AppTheme?.set(mode);$("themeToggle").focus()}});
  actions.push({title:"Google Calendar draft",keywords:"google calendar export event",detail:"Choose a task to add to Google Calendar",run:()=>{changeView("inbox");status("Choose Google Calendar draft beside the task you want to add.");$("pageTitle").focus();$("pageTitle").scrollIntoView({behavior:"smooth",block:"start"})}});
  return actions;
}
searchUi=TaskSearch.init({getTasks:()=>reminders,getActions:searchActions,isSignedIn:()=>Boolean(user),
  openTask:id=>{const task=reminders.find(r=>r.id===id);if(task)openTaskForm(task)},
  onQuery:value=>{query=value;render()}});
calendarUi=TaskCalendar.init({getTasks:()=>reminders,onOpen:id=>{const task=reminders.find(r=>r.id===id);if(task)openTaskForm(task)}});
function refreshCalendar(){if(user&&view==="calendar"&&!query.trim())calendarUi.render()}
setInterval(refreshCalendar,60000);
window.addEventListener("focus",refreshCalendar);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible")refreshCalendar()});
