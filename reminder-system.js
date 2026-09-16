import{initializeApp}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import{initializeAppCheck,ReCaptchaEnterpriseProvider}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";
import{getAuth,GoogleAuthProvider,FacebookAuthProvider,onAuthStateChanged,signInWithPopup,signOut}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import{getFirestore,collection,doc,getDoc,getDocs,setDoc,deleteDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const c={apiKey:"AIzaSyCe3qaOFx6ey5LAghth8l2cQ9VonSY7hnQ",authDomain:"easy-reminder-system.firebaseapp.com",projectId:"easy-reminder-system",storageBucket:"easy-reminder-system.firebasestorage.app",messagingSenderId:"502381230653",appId:"1:502381230653:web:8a0162b42b25d5356e4854"};
const a=initializeApp(c);
let appCheck=null;
try{appCheck=initializeAppCheck(a,{provider:new ReCaptchaEnterpriseProvider("6LfccbstAAAAAACjUCUaBSbXPPAD0-un914Et1O6"),isTokenAutoRefreshEnabled:true})}catch(e){console.error("Firebase App Check initialization failed:",e)}const auth=getAuth(a),db=getFirestore(a),provider=new GoogleAuthProvider(),fbProvider=new FacebookAuthProvider(),$=i=>document.getElementById(i);
let user=null,reminders=[],notificationsEnabled=false,view="inbox",query="",labelFilter="",priorityFilter="",idleTimer=null,idleLogoutTimer=null,idleWarningOpen=false,editingId=null,activeLoginAttempt=null;
const notifiedOccurrences=new Set();
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
if(!user||idleWarningOpen)return;
idleTimer=setTimeout(showIdleWarning,IDLE_LIMIT)}["click","keydown","mousemove","touchstart","scroll"].forEach(type=>window.addEventListener(type,resetIdleTimer,{passive:true}));
$("idleStayBtn").onclick=()=>{hideIdleWarning();
resetIdleTimer()};
$("idleSignOutBtn").onclick=signOutForInactivity;
function notificationRef(){return doc(db,"users",user.uid,"settings","notifications")}function updateNotificationUi(){let statusEl=$("notificationStatus"),button=$("notificationBtn");if(!statusEl||!button)return;let supported="Notification" in window;statusEl.classList.toggle("enabled",notificationsEnabled);statusEl.textContent=notificationsEnabled?"Notifications are enabled for this account on this browser.":supported?"Notifications are off for this account.":"This browser does not support notifications.";button.textContent=notificationsEnabled?"Disable notifications":"Enable notifications";button.disabled=!supported&&!notificationsEnabled}async function loadNotificationSetting(){notificationsEnabled=false;if(!user)return;try{let snapshot=await getDoc(notificationRef());notificationsEnabled=Boolean(snapshot.exists()&&snapshot.data().enabled)&&"Notification" in window&&Notification.permission==="granted"}catch(error){console.warn("Could not load notification preference",error)}updateNotificationUi()}function checkDueNotifications(){if(!notificationsEnabled||!("Notification" in window)||Notification.permission!=="granted")return;let nowMs=Date.now();reminders.forEach(r=>{if(r.done)return;let dueMs=new Date(r.next).getTime();if(!Number.isFinite(dueMs)||dueMs>nowMs)return;let interval={minutes:60000,hours:3600000,days:86400000,weeks:604800000}[r.repeat],occurrence=r.repeat==="once"?0:Math.floor((nowMs-dueMs)/((Number(r.amount)||1)*interval)),key=r.id+":"+occurrence;if(notifiedOccurrences.has(key))return;try{new Notification(r.title,{body:"Your reminder is due now."+(r.note?" "+r.note:""),tag:"easy-reminder-"+key,requireInteraction:true});notifiedOccurrences.add(key)}catch(error){console.warn("Could not show notification",error)}})}async function toggleNotifications(){if(!user)return;if(notificationsEnabled){notificationsEnabled=false;await setDoc(notificationRef(),{enabled:false,updatedAt:serverTimestamp()});updateNotificationUi();return}if(!("Notification" in window)){updateNotificationUi();return}let permission=Notification.permission;if(permission!=="granted")permission=await Notification.requestPermission();if(permission!=="granted"){status("Notifications were not enabled. You can allow them in your browser settings.");return}try{await setDoc(notificationRef(),{enabled:true,updatedAt:serverTimestamp()});notificationsEnabled=true;updateNotificationUi();status("Notifications enabled for this account on this browser.");checkDueNotifications()}catch(error){status("Could not save notification preference. Please try again.")}}
setInterval(checkDueNotifications,15000);function esc(s){return String(s).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]))}function key(d){let x=new Date(d);
return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")}function clock(d){return Number.isNaN(d.getTime())?"":String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0")}function taskEnd(r){let start=new Date(r.next);if(!r.endTime||Number.isNaN(start.getTime()))return new Date(start.getTime()+3600000);let [hours,minutes]=r.endTime.split(":").map(Number),end=new Date(start);end.setHours(hours,minutes,0,0);if(end<=start)end.setDate(end.getDate()+1);return end}function normalizeReminder(r){let start=new Date(r.next),end=taskEnd(r);return {...r,startTime:r.startTime||clock(start),endTime:r.endTime||clock(end)}}function priorityName(value){return value.charAt(0).toUpperCase()+value.slice(1)+" Priority"}function startLabel(r){let start=new Date(r.next);return r.done?"Completed":"Start "+start.toLocaleString([],{dateStyle:"medium",timeStyle:"short"})}function endLabel(r){return"End "+taskEnd(r).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})}function reminderRef(id){return doc(db,"users",user.uid,"reminders",id)}function notSignedInError(){let error=new Error("You must be signed in to save reminders.");
error.code="auth/user-not-signed-in";
return error}function saveReminder(r){return user?setDoc(reminderRef(r.id),r):Promise.reject(notSignedInError())}function deleteReminder(id){return user?deleteDoc(reminderRef(id)):Promise.reject(notSignedInError())}function saveErrorMessage(error){let code=error&&error.code?error.code:"unknown",hints={"permission-denied":"Firebase denied the write. Sign in again or publish the current Firestore rules.","unauthenticated":"Your sign-in has expired. Sign in again and retry.","auth/user-not-signed-in":"Your sign-in has expired. Sign in again and retry.","failed-precondition":"Firebase App Check or the deployed rules rejected the write.","resource-exhausted":"Firebase is temporarily unavailable. Please try again."};
return "Could not save task"+(code!=="unknown"?" ["+code+"]":"")+". "+(hints[code]||"Please try again.")}function status(t){$("status").textContent=t;
setTimeout(()=>$("status").textContent="",3500)}function cal(r){let s=new Date(r.next),e=taskEnd(r),f=d=>d.toISOString().replace(/[-:]/g,"").replace(/.d{3}Z$/,"Z");
return"https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(r.title)+"&dates="+f(s)+"/"+f(e)+"&details="+encodeURIComponent((r.repeat==="once"?"":"Repeats every "+r.amount+" "+units[r.repeat]+"."))}
function filtered(){let q=query.toLowerCase().trim(),today=key(new Date());
return reminders.filter(r=>{let text=(r.title+" "+(r.note||"")+" "+(r.labels||[]).join(" ")).toLowerCase(),d=key(r.next),match=!q||text.includes(q),lab=!labelFilter||(r.labels||[]).includes(labelFilter),prio=!priorityFilter||(r.priority||"medium")===priorityFilter,v=view==="inbox"?!r.done:view==="today"?!r.done&&d===today:view==="upcoming"?!r.done&&d>today:view==="filters"?!r.done&&lab&&prio:true;
return match&&v}).sort((x,y)=>new Date(x.next)-new Date(y.next))}
function render(){
  let titles={inbox:["Inbox","Your active reminders in one place."],today:["Today","Tasks due today."],upcoming:["Upcoming","See what is coming next."],filters:["Filters & Labels","Filter active tasks by label."],reporting:["Reporting","A simple view of your progress."]};

  $("pageTitle").textContent=titles[view][0];

  $("pageSubtitle").textContent=titles[view][1];

  $("reporting").classList.toggle("hidden",view!=="reporting");

  $("taskSection").classList.toggle("hidden",view==="reporting");

  $("listHeading").textContent=priorityFilter?priorityName(priorityFilter):labelFilter?"# "+labelFilter:"Tasks";

  let ls=[...new Set(reminders.flatMap(r=>r.labels||[]))].sort();

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

  $("list").innerHTML=data.map(r=>'<article class="task"><input class="task-check" type="checkbox" data-done="'+esc(r.id)+'" '+(r.done?"checked":"")+' aria-label="Complete '+esc(r.title)+'"><div class="task-body"><div class="task-title '+(r.done?"done":"")+'">'+esc(r.title)+'</div>'+(r.note?'<div class="task-note">'+esc(r.note)+'</div>':'')+'<div class="task-meta"><span class="chip due">'+esc(startLabel(r))+'</span><span class="chip end">'+esc(endLabel(r))+'</span><span class="chip priority-'+(r.priority||"medium")+'">'+esc(priorityName(r.priority||"medium"))+'</span>'+(r.repeat!=="once"?'<span class="chip repeat">↻ every '+r.amount+" "+esc(units[r.repeat])+'</span>':"")+(r.labels||[]).map(l=>'<span class="chip label">#'+esc(l)+'</span>').join("")+'</div></div><div class="task-actions"><button data-edit="'+esc(r.id)+'">Edit</button>'+(!r.done?'<button data-calendar="'+esc(r.id)+'">Google Calendar</button><button data-snooze="'+esc(r.id)+'">Snooze 10m</button>':"")+'<button class="danger" data-delete="'+esc(r.id)+'">Delete</button></div></article>').join("");

}
async function load(){let qs=await getDocs(collection(db,"users",user.uid,"reminders"));
reminders=qs.docs.map(snapshot=>normalizeReminder({...snapshot.data(),id:snapshot.id}));
if(!reminders.length){let legacy=await getDoc(doc(db,"users/"+user.uid));
let old=legacy.exists()&&Array.isArray(legacy.data().reminders)?legacy.data().reminders:[],migrated=old.map(normalizeReminder);
for(const r of migrated)await saveReminder(r);
reminders=migrated}render()}function updateRepeatFields(){let show=$("repeat").value!=="once";
$("amountWrap").style.display=show?"flex":"none";
$("unitWrap").style.display=show?"flex":"none";
$("amount").min=show?"1":"0";
$("unitText").textContent="Every "+units[$("repeat").value]}function resetTaskForm(){editingId=null;
$("form").reset();
let current=new Date();
$("date").value=current.toISOString().slice(0,10);
$("startTime").value="09:00";
$("endTime").value="10:00";
$("formTitle").textContent="Add a task";
$("saveTaskBtn").textContent="Save task";
updateRepeatFields()}function openTaskForm(reminder=null){resetTaskForm();
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
$("saveTaskBtn").textContent="Save changes"}updateRepeatFields();
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
$("search").oninput=e=>{query=e.target.value;
render()};
$("sidebarAdd").onclick=add;
$("headAdd").onclick=add;
$("cancelAdd").onclick=()=>{resetTaskForm();
$("quickAdd").classList.add("hidden")};
document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;
labelFilter="";
priorityFilter="";
document.querySelectorAll("[data-view]").forEach(x=>x.classList.toggle("active",x===b));
render()});
$("labelList").onclick=e=>{let b=e.target.closest("[data-label]");
if(b){view="filters";
labelFilter=b.dataset.label;
priorityFilter="";
render()}};
$("priorityList").onclick=e=>{let b=e.target.closest("[data-priority]");
if(b){view="filters";
labelFilter="";
priorityFilter=b.dataset.priority;
render()}};
$("repeat").onchange=updateRepeatFields;

$("form").onsubmit=async e=>{e.preventDefault();
let repeat=$("repeat").value,startTime=$("startTime").value,endTime=$("endTime").value,d=new Date($("date").value+"T"+startTime),end=new Date($("date").value+"T"+endTime),title=$("title").value.trim(),note=$("note").value.trim(),labels=$("labels").value.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);
if(isNaN(d)||isNaN(end)){status("Please choose a valid date and time.");
return}if(!title||title.length>200||note.length>2000||labels.length>20||labels.some(x=>x.length>50)){status("Please shorten the task, note, or labels. You can use up to 20 labels.");
return}if(end<=d){status("Ending time must be after starting time.");
return}let existing=editingId?reminders.find(r=>r.id===editingId):null;
if(editingId&&!existing){status("This task is no longer available. Refresh the page and try again.");
return}let reminder={id:existing?existing.id:crypto.randomUUID(),title,note,labels,repeat,amount:repeat==="once"?0:Math.max(1,Number($("amount").value)||1),priority:$("priority").value,next:d.toISOString(),startTime,endTime,done:existing?existing.done:false};
try{await saveReminder(reminder)}catch(error){status(saveErrorMessage(error));
return}if(existing)reminders=reminders.map(r=>r.id===existing.id?reminder:r);
else reminders.push(reminder);
let updated=Boolean(existing);
resetTaskForm();
$("quickAdd").classList.add("hidden");
render();
status(updated?"Task updated.":"Task saved.")};

document.addEventListener("click",async e=>{let priority=e.target.dataset.priority;
if(priority){view="filters";labelFilter="";priorityFilter=priority;render();return}let id=e.target.dataset.edit||e.target.dataset.calendar||e.target.dataset.snooze||e.target.dataset.delete||e.target.dataset.done;
if(!id)return;
let r=reminders.find(x=>x.id===id);
if(!r)return;
if(e.target.dataset.edit){openTaskForm(r);
return}if(e.target.dataset.calendar){window.open(cal(r),"_blank","noopener,noreferrer");
return}if(e.target.dataset.delete){reminders=reminders.filter(x=>x.id!==id);
if(editingId===id){resetTaskForm();
$("quickAdd").classList.add("hidden")}await deleteReminder(id)}else{if(e.target.dataset.snooze){let duration=Math.max(60000,taskEnd(r)-new Date(r.next)),start=new Date(Date.now()+600000),end=new Date(start.getTime()+duration);r.next=start.toISOString();r.startTime=clock(start);r.endTime=clock(end)}
if(e.target.dataset.done)r.done=e.target.checked;
await saveReminder(r)}render()});
onAuthStateChanged(auth,async u=>{user=u;
if(u){$("loginGate").classList.add("hidden");
$("app").classList.remove("hidden");
$("notificationControl")?.classList.remove("hidden");
$("quickAdd").classList.add("hidden");
$("userEmail").textContent=u.email||"Signed in";
$("sidebarUser").textContent=u.email||"Signed in";
try{await loadNotificationSetting();await load();
requestAnimationFrame(()=>$("taskSection").scrollIntoView({behavior:"smooth",block:"start"}))}catch(e){status("Could not load reminders. Check Firestore rules.")}}else{if(idleTimer)clearTimeout(idleTimer);
idleTimer=null;
hideIdleWarning();
$("loginGate").classList.remove("hidden");
$("app").classList.add("hidden");
$("notificationControl")?.classList.add("hidden");
reminders=[];notificationsEnabled=false;updateNotificationUi()}resetIdleTimer()});
