import { setupAccountLinking } from "./account-linking.js";
import{initializeApp}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";import{initializeAppCheck,ReCaptchaEnterpriseProvider}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js";import{getAuth,GoogleAuthProvider,FacebookAuthProvider,onAuthStateChanged,signInWithPopup,signOut}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";import{getFirestore,collection,doc,getDoc,getDocs,setDoc,deleteDoc,serverTimestamp}from"https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
const c={apiKey:"AIzaSyCe3qaOFx6ey5LAghth8l2cQ9VonSY7hnQ",authDomain:"easy-reminder-system.firebaseapp.com",projectId:"easy-reminder-system",storageBucket:"easy-reminder-system.firebasestorage.app",messagingSenderId:"502381230653",appId:"1:502381230653:web:8a0162b42b25d5356e4854"};const a=initializeApp(c);let appCheck=null;try{appCheck=initializeAppCheck(a,{provider:new ReCaptchaEnterpriseProvider("6LfccbstAAAAAACjUCUaBSbXPPAD0-un914Et1O6"),isTokenAutoRefreshEnabled:true})}catch(e){console.error("Firebase App Check initialization failed:",e)}const auth=getAuth(a),db=getFirestore(a),provider=new GoogleAuthProvider(),fbProvider=new FacebookAuthProvider(),$=i=>document.getElementById(i);let user=null,reminders=[],view="inbox",query="",labelFilter="",idleTimer=null,activeLoginAttempt=null;const IDLE_LIMIT=60000,now=new Date(),units={once:"one time",minutes:"minute(s)",hours:"hour(s)",days:"day(s)",weeks:"week(s)"};$("date").value=now.toISOString().slice(0,10);$("time").value="09:00";
function resetIdleTimer(){if(idleTimer)clearTimeout(idleTimer);if(!user)return;idleTimer=setTimeout(async()=>{await signOut(auth);$("authError").textContent="You were signed out after 1 minute of inactivity.";},IDLE_LIMIT)}["click","keydown","mousemove","touchstart","scroll"].forEach(type=>window.addEventListener(type,resetIdleTimer,{passive:true}));function esc(s){return String(s).replace(/[&<>"']/g,x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]))}function key(d){let x=new Date(d);return x.getFullYear()+"-"+String(x.getMonth()+1).padStart(2,"0")+"-"+String(x.getDate()).padStart(2,"0")}function reminderRef(id){return doc(db,"users",user.uid,"reminders",id)}function saveReminder(r){return user?setDoc(reminderRef(r.id),r):Promise.resolve()}function deleteReminder(id){return user?deleteDoc(reminderRef(id)):Promise.resolve()}function status(t){$("status").textContent=t;setTimeout(()=>$("status").textContent="",3500)}function cal(r){let s=new Date(r.next),e=new Date(s.getTime()+3600000),f=d=>d.toISOString().replace(/[-:]/g,"").replace(/.d{3}Z$/,"Z");return"https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(r.title)+"&dates="+f(s)+"/"+f(e)+"&details="+encodeURIComponent((r.repeat==="once"?"":"Repeats every "+r.amount+" "+units[r.repeat]+"."))}
function filtered(){let q=query.toLowerCase().trim(),today=key(new Date());return reminders.filter(r=>{let text=(r.title+" "+(r.note||"")+" "+(r.labels||[]).join(" ")).toLowerCase(),d=key(r.next),match=!q||text.includes(q),lab=!labelFilter||(r.labels||[]).includes(labelFilter),v=view==="inbox"?!r.done:view==="today"?!r.done&&d===today:view==="upcoming"?!r.done&&d>today:view==="filters"?!r.done&&lab:true;return match&&v}).sort((x,y)=>new Date(x.next)-new Date(y.next))}
function render(){
  let titles={inbox:["Inbox","Your active reminders in one place."],today:["Today","Tasks due today."],upcoming:["Upcoming","See what is coming next."],filters:["Filters & Labels","Filter active tasks by label."],reporting:["Reporting","A simple view of your progress."]};
  $("pageTitle").textContent=titles[view][0];
  $("pageSubtitle").textContent=titles[view][1];
  $("reporting").classList.toggle("hidden",view!=="reporting");
  $("taskSection").classList.toggle("hidden",view==="reporting");
  $("listHeading").textContent=labelFilter?"# "+labelFilter:"Tasks";
  let ls=[...new Set(reminders.flatMap(r=>r.labels||[]))].sort();
  $("labelList").innerHTML=ls.map(l=>'<button class="label-link" data-label="'+esc(l)+'"><span class="label-dot"></span>'+esc(l)+'</button>').join("");
  let total=reminders.length,done=reminders.filter(r=>r.done).length,pct=total?Math.round(done/total*100):0;
  $("totalStat").textContent=total;
  $("doneStat").textContent=done;
  $("activeStat").textContent=total-done;
  $("progressBar").style.width=pct+"%";
  $("progressText").textContent=pct+"% complete";
  let data=filtered();
  $("empty").style.display=data.length?"none":"block";
  $("list").innerHTML=data.map(r=>'<article class="task"><input class="task-check" type="checkbox" data-done="'+r.id+'" '+(r.done?"checked":"")+' aria-label="Complete '+esc(r.title)+'"><div class="task-body"><div class="task-title '+(r.done?"done":"")+'">'+esc(r.title)+'</div>'+(r.note?'<div class="task-note">'+esc(r.note)+'</div>':'')+'<div class="task-meta"><span class="chip due">'+esc(r.done?"Completed":new Date(r.next).toLocaleString([],{dateStyle:"medium",timeStyle:"short"}))+'</span><span class="chip priority-'+(r.priority||"medium")+'">'+esc((r.priority||"medium").charAt(0).toUpperCase()+(r.priority||"medium").slice(1))+" Priority</span>"+(r.repeat!=="once"?'<span class="chip repeat">↻ every '+r.amount+" "+esc(units[r.repeat])+'</span>':"")+(r.labels||[]).map(l=>'<span class="chip label">#'+esc(l)+'</span>').join("")+'</div></div><div class="task-actions">'+(!r.done?'<button data-calendar="'+r.id+'">Google Calendar</button><button data-snooze="'+r.id+'">Snooze 10m</button>':"")+'<button class="danger" data-delete="'+r.id+'">Delete</button></div></article>').join("");
}
async function load(){let qs=await getDocs(collection(db,"users",user.uid,"reminders"));reminders=qs.docs.map(d=>d.data());if(!reminders.length){let legacy=await getDoc(doc(db,"users/"+user.uid));let old=legacy.exists()&&Array.isArray(legacy.data().reminders)?legacy.data().reminders:[];for(const r of old)await saveReminder(r);reminders=old}render()}function add(){ $("quickAdd").classList.remove("hidden");$("title").focus();window.scrollTo({top:0,behavior:"smooth"})}
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
$("signOutBtn").onclick=()=>signOut(auth);$("search").oninput=e=>{query=e.target.value;render()};$("sidebarAdd").onclick=add;$("headAdd").onclick=add;$("cancelAdd").onclick=()=>{$("form").reset();$("quickAdd").classList.add("hidden")};document.querySelectorAll("[data-view]").forEach(b=>b.onclick=()=>{view=b.dataset.view;labelFilter="";document.querySelectorAll("[data-view]").forEach(x=>x.classList.toggle("active",x===b));render()});$("labelList").onclick=e=>{let b=e.target.closest("[data-label]");if(b){view="filters";labelFilter=b.dataset.label;render()}};$("repeat").onchange=()=>{let show=$("repeat").value!=="once";$("amountWrap").style.display=show?"flex":"none";$("unitWrap").style.display=show?"flex":"none";$("unitText").textContent="Every "+units[$("repeat").value]};
$("form").onsubmit=async e=>{e.preventDefault();let repeat=$("repeat").value,d=new Date($("date").value+"T"+$("time").value),title=$("title").value.trim(),note=$("note").value.trim(),labels=$("labels").value.split(",").map(x=>x.trim().toLowerCase()).filter(Boolean);if(isNaN(d)){status("Please choose a valid date and time.");return}if(!title||title.length>200||note.length>2000||labels.some(x=>x.length>50)){status("Please shorten the task, note, or labels.");return}let reminder={id:crypto.randomUUID(),title,note,labels,repeat,amount:repeat==="once"?0:Math.max(1,Number($("amount").value)||1),priority:$("priority").value,next:d.toISOString(),done:false};reminders.push(reminder);await saveReminder(reminder);e.target.reset();$("date").value=now.toISOString().slice(0,10);$("time").value="09:00";$("quickAdd").classList.add("hidden");render();status("Task saved.")};
document.addEventListener("click",async e=>{let id=e.target.dataset.calendar||e.target.dataset.snooze||e.target.dataset.delete||e.target.dataset.done;if(!id)return;if(e.target.dataset.calendar){window.open(cal(reminders.find(r=>r.id===id)),"_blank","noopener,noreferrer");return}let r=reminders.find(x=>x.id===id);if(e.target.dataset.delete){reminders=reminders.filter(x=>x.id!==id);await deleteReminder(id)}else{if(e.target.dataset.snooze)r.next=new Date(Date.now()+600000).toISOString();if(e.target.dataset.done)r.done=e.target.checked;await saveReminder(r)}render()});onAuthStateChanged(auth,async u=>{user=u;if(u){$("loginGate").classList.add("hidden");$("app").classList.remove("hidden");$("quickAdd").classList.add("hidden");$("userEmail").textContent=u.email||"Signed in";$("sidebarUser").textContent=u.email||"Signed in";try{await load();requestAnimationFrame(()=>$("taskSection").scrollIntoView({behavior:"smooth",block:"start"}))}catch(e){status("Could not load reminders. Check Firestore rules.")}}else{if(idleTimer)clearTimeout(idleTimer);idleTimer=null;$("loginGate").classList.remove("hidden");$("app").classList.add("hidden");reminders=[]}resetIdleTimer()});
setupAccountLinking(auth);
