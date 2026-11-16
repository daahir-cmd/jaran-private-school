import './styles.css';
import './attendance.css';
import { downloadXlsx } from './xlsx';
import { loginEmail, supabase } from './backend';

type AttendanceStatus='Present'|'Absent'|'Late';
type UserRole='admin'|'teacher'|'finance'|'student';
type UserProfile={loginId:string;displayName:string;role:UserRole;classId:string|null;studentId:string|null;mustChangePassword:boolean};
type Student = { id:string; name:string; gender:string; phone:string; reg:string; guardianName?:string; guardianPhone?:string; admissionDate?:string; paid:boolean };
type SchoolClass = { id:string; name:string; teacher:string; start:string; end:string; students:Student[] };
type Attendance = { id:string; date:string; lecture:number; description:string; type?:string; marks:Record<string,AttendanceStatus> };
type Store = { classes:SchoolClass[]; attendance:Record<string,Attendance[]>; profile:{name:string;school:string}; timetable:string[] };
const blank:Store={classes:[],attendance:{},profile:{name:'Faculty Administrator',school:'JARAN PRIVATE SCHOOL'},timetable:[]};
const isRecord=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const isPlainObject=(value:unknown):value is Record<string,unknown>=>{
 if(!isRecord(value))return false;
 const prototype=Object.getPrototypeOf(value);
 return prototype===Object.prototype||prototype===null;
};
const isSafeKey=(key:string)=>key!=='__proto__'&&key!=='constructor'&&key!=='prototype';
const isUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const isDate=(value:unknown):value is string=>typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}$/.test(value));
const isBoundedString=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length<=max;
const attendanceStatuses:AttendanceStatus[]=['Present','Absent','Late'];
const isAttendanceStatus=(value:unknown):value is AttendanceStatus=>attendanceStatuses.some(status=>status===value);
function sanitizeStore(input:unknown):Store|null{
 if(!isPlainObject(input)||!Array.isArray(input.classes)||!isPlainObject(input.attendance)||!isPlainObject(input.profile)||!Array.isArray(input.timetable))return null;
 if(!isBoundedString(input.profile.name,100)||!isBoundedString(input.profile.school,100))return null;
 if(Object.keys(input.attendance).some(key=>!isSafeKey(key)))return null;
 const classes:SchoolClass[]=input.classes.flatMap((entry):SchoolClass[]=>{
  if(!isPlainObject(entry)||!isUuid(entry.id)||!isBoundedString(entry.name,100)||!isBoundedString(entry.teacher,100)||!isDate(entry.start)||!isDate(entry.end)||!Array.isArray(entry.students))return [];
  const students:Student[]=entry.students.flatMap((value):Student[]=>{
   if(!isPlainObject(value))return [];
   const guardianName=value.guardianName===undefined?'':value.guardianName;
   const guardianPhone=value.guardianPhone===undefined?'':value.guardianPhone;
   const admissionDate=value.admissionDate===undefined?'':value.admissionDate;
   if(!isUuid(value.id)||!isBoundedString(value.name,100)||!isBoundedString(value.gender,30)||!isBoundedString(value.phone,40)||!isBoundedString(value.reg,100)||!isBoundedString(guardianName,100)||!isBoundedString(guardianPhone,40)||!isDate(admissionDate)||typeof value.paid!=='boolean')return [];
   return [{
    id:value.id,name:value.name,gender:value.gender,phone:value.phone,reg:value.reg,
    guardianName,guardianPhone,admissionDate,paid:value.paid
   }];
  });
  return [{id:entry.id,name:entry.name,teacher:entry.teacher,start:entry.start,end:entry.end,students}];
 });
 const attendance:Record<string,Attendance[]>=Object.create(null);
 const classIds=new Set(classes.map(entry=>entry.id));
 for(const [classId,value] of Object.entries(input.attendance)){
  if(!isSafeKey(classId)||!isUuid(classId)||!classIds.has(classId)||!Array.isArray(value))continue;
  attendance[classId]=value.flatMap((session):Attendance[]=>{
   if(!isPlainObject(session)||!isUuid(session.id)||!isDate(session.date)||!session.date||typeof session.lecture!=='number'||!Number.isInteger(session.lecture)||session.lecture<1||!isBoundedString(session.description,2000)||!isPlainObject(session.marks))return [];
   if(Object.keys(session.marks).some(key=>!isSafeKey(key)))return [];
   const marks:Record<string,AttendanceStatus>=Object.create(null);
   for(const [studentId,status] of Object.entries(session.marks)){
    if(!isUuid(studentId)||!isAttendanceStatus(status))return [];
    marks[studentId]=status;
   }
   const type=session.type;
   if(type!==undefined&&!isBoundedString(type,40))return [];
   return [{id:session.id,date:session.date,lecture:session.lecture,description:session.description,type,marks}];
  });
 }
 return {
  classes,attendance,profile:{name:input.profile.name,school:input.profile.school},
  timetable:input.timetable.filter((value):value is string=>isBoundedString(value,500))
 };
}
let data:Store={...blank,classes:[],attendance:{},profile:{...blank.profile},timetable:[]};
let currentProfile:UserProfile|null=null;
let appReady=false;
let active=location.hash.slice(1)||'dashboard', selectedClass='', menuClass='', reportClass='';
let filterText='', attendanceDate=new Date().toISOString().slice(0,10), reportFrom='', reportTo='', reportMin=0, reportMax=100, reportOrder='Name', reportDirection='Ascending';
let attendanceMode:'list'|'take'='list', attendanceEditingId='', attendanceDraftDate=attendanceDate, attendanceDraftLecture=1, attendanceDraftRemarks='', attendanceDraftMarks:Record<string,AttendanceStatus>={}, attendanceDirection='DESC', attendanceStudentSort='Name';
const app=document.querySelector<HTMLDivElement>('#app')!;
function renderLogin(message=''){
 app.innerHTML='<main class="auth-shell"><form class="auth-card" id="login-form"><img src="./jaran-logo.jpeg" alt="Jaran School logo"><h1>JARAN PRIVATE SCHOOL</h1><p>Sign in with your school account ID.</p><label>Account ID<input name="loginId" autocomplete="username" required maxlength="32"></label><label>Password<span class="password-input-wrap"><input name="password" type="password" autocomplete="current-password" required><button class="password-toggle" type="button" aria-label="Show password" aria-pressed="false" data-password-toggle><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label><p class="auth-error" id="auth-error" role="alert">'+esc(message)+'</p><button class="teal-btn" type="submit">Sign in</button><p class="hint">Forgot your password? Contact the school administrator.</p></form></main>';
 bindPasswordVisibility(app);
 if(!supabase){
  app.innerHTML='<main class="auth-shell"><section class="auth-card"><img src="./jaran-logo.jpeg" alt="Jaran School logo"><h1>Login setup required</h1><p>Supabase has not been configured for this deployment. Follow the setup guide, then rebuild the app.</p></section></main>';
  return;
 }
 app.querySelector<HTMLFormElement>('#login-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const form=event.currentTarget as HTMLFormElement;
  const values=new FormData(form);
  const id=String(values.get('loginId')||'').trim().toUpperCase();
  const password=String(values.get('password')||'');
  const button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled=true;
  const {error}=await supabase.auth.signInWithPassword({email:loginEmail(id),password});
  if(error){
   console.error('School account sign-in failed.',error);
   button.disabled=false;
   const errorElement=app.querySelector<HTMLElement>('#auth-error');
   if(errorElement)errorElement.textContent='Sign-in failed. Check your account ID and password.';
   return;
  }
  await initializeSession();
 });
}
async function loadSchoolData(){
 if(!supabase)throw new Error('Supabase is not configured.');
 const {data:store,error}=await supabase.rpc('load_school_store');
 if(error)throw error;
 const next=sanitizeStore(store);
 if(!next)throw new Error('The server returned invalid school data.');
 data=next;
}
async function initializeSession(){
 if(!supabase){renderLogin();return}
 const {data:sessionData,error:sessionError}=await supabase.auth.getSession();
 if(sessionError){
  console.error('Unable to check the school login session.',sessionError);
  renderLogin('Unable to check your sign-in. Please reload and try again.');
  return;
 }
 if(!sessionData.session){currentProfile=null;appReady=false;renderLogin();return}
 const {data:profile,error:profileError}=await supabase.rpc('get_my_profile');
 if(profileError||!isPlainObject(profile)||!['admin','teacher','finance','student'].includes(String(profile.role))){
  console.error('Unable to load the school account profile.',profileError);
  await supabase.auth.signOut();
  currentProfile=null;
  renderLogin('This account is not configured for the school app. Contact the administrator.');
  return;
 }
 currentProfile={
  loginId:String(profile.loginId),
  displayName:String(profile.displayName),
  role:profile.role as UserRole,
  classId:typeof profile.classId==='string'?profile.classId:null,
  studentId:typeof profile.studentId==='string'?profile.studentId:null,
  mustChangePassword:profile.mustChangePassword===true
 };
 if(currentProfile.mustChangePassword){renderPasswordChange();return}
 try{
  await loadSchoolData();
 }catch(error){
  console.error('Unable to load school data.',error);
  renderLogin('Unable to load school data. Check your connection or contact the administrator.');
  return;
 }
 appReady=true;
 if(!canOpen(active))active='dashboard';
 render();
}
function renderPasswordChange(){
 app.innerHTML='<main class="auth-shell"><form class="auth-card" id="password-form"><h1>Set a new password</h1><p>This temporary password must be replaced before you can use the school app. Choose a password you can remember; Supabase will enforce the project password rules.</p><label>New password<span class="password-input-wrap"><input name="newPassword" type="password" autocomplete="new-password" required><button class="password-toggle" type="button" aria-label="Show password" aria-pressed="false" data-password-toggle><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label><label>Confirm new password<span class="password-input-wrap"><input name="confirmPassword" type="password" autocomplete="new-password" required><button class="password-toggle" type="button" aria-label="Show password" aria-pressed="false" data-password-toggle><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label><p class="auth-error" id="auth-error" role="alert"></p><button class="teal-btn" type="submit">Save password</button></form></main>';
 bindPasswordVisibility(app);
 app.querySelector<HTMLFormElement>('#password-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!supabase)return;
  const form=event.currentTarget as HTMLFormElement;
  const values=new FormData(form);
  const password=String(values.get('newPassword')||'');
  if(!password){
   app.querySelector<HTMLElement>('#auth-error')!.textContent='Enter a new password.';
   return;
  }
  if(password!==String(values.get('confirmPassword')||'')){
   app.querySelector<HTMLElement>('#auth-error')!.textContent='The passwords do not match.';
   return;
  }
  const button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled=true;
  const {error:updateError}=await supabase.auth.updateUser({password});
  if(updateError){
   console.error('Unable to change the temporary password.',updateError);
   button.disabled=false;
   app.querySelector<HTMLElement>('#auth-error')!.textContent='Supabase rejected that password under the project security rules. Try another password.';
   return;
  }
  // The database trigger clears must_change_password only after Supabase Auth
  // actually changes encrypted_password; a client RPC cannot waive this gate.
  await initializeSession();
 });
}
function bindPasswordVisibility(root:ParentNode){
 root.querySelectorAll<HTMLButtonElement>('[data-password-toggle]').forEach(toggle=>toggle.addEventListener('click',()=>{
  const input=toggle.parentElement?.querySelector<HTMLInputElement>('input[type="password"], input[type="text"]');
  if(!input)return;
  const visible=input.type==='text';
  input.type=visible?'password':'text';
  toggle.setAttribute('aria-pressed',String(!visible));
  toggle.setAttribute('aria-label',visible?'Show password':'Hide password');
 }));
}
function studentPortalPage(){
 const student=currentProfile?.studentId?data.classes.flatMap(c=>c.students.map(s=>({student:s,className:c.name,classId:c.id}))).find(entry=>entry.student.id===currentProfile?.studentId):undefined;
 if(!student){layout('<h1>Student account</h1><p class="hint">Your student record is not available. Contact the administrator.</p>','Student Portal');return}
 const sessions=(data.attendance[student.classId]||[]).filter(session=>session.marks[student.student.id]).sort((a,b)=>b.date.localeCompare(a.date)||b.lecture-a.lecture);
 const rows=sessions.map(session=>'<article class="attendance-session-card"><div class="attendance-session-date"><b>'+formatAttendanceDate(session.date)+'</b><small>Lecture '+esc(session.lecture)+'</small></div><span class="status-badge status-'+safeAttendanceStatus(session.marks[student.student.id]).toLowerCase()+'">'+esc(safeAttendanceStatus(session.marks[student.student.id]))+'</span></article>').join('');
 layout('<h1>My School Portal</h1><article class="student-card"><div class="student-info"><h2>'+esc(student.student.name)+'</h2><div class="student-meta">Class: '+esc(student.className)+'　Registration: '+esc(student.student.reg||'—')+'</div><div class="student-meta">Fees: <b>'+ (student.student.paid?'PAID':'UNPAID')+'</b></div></div></article><h2>My Attendance</h2><div class="attendance-history">'+(rows||'<div class="empty-state">No attendance records yet.</div>')+'</div>','Student Portal');
}
function accountsPage(){
 if(currentProfile?.role!=='admin'){go('dashboard');return}
 const classOptions=data.classes.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('');
 const studentOptions=data.classes.flatMap(c=>c.students.map(s=>'<option value="'+esc(s.id)+'" data-class="'+esc(c.id)+'">'+esc(c.name+' — '+s.name)+'</option>')).join('');
 layout('<h1>School Accounts</h1><p class="hint">Temporary passwords are random, shown once, and must be changed on first sign-in.</p><form class="form-panel account-form" id="create-account-form"><label>Account ID<input name="loginId" required maxlength="32" pattern="[A-Za-z][A-Za-z0-9_-]{2,31}"></label><label>Full name<input name="displayName" required maxlength="100"></label><label>Role<select name="role"><option value="teacher">Teacher</option><option value="finance">Finance</option><option value="student">Student</option></select></label><label>Assigned class<select name="classId"><option value="">Select class</option>'+classOptions+'</select></label><label class="student-account-field">Student record<select name="studentId"><option value="">Select student</option>'+studentOptions+'</select></label><button class="teal-btn" type="submit">Create account</button><p class="auth-error" id="account-error" role="alert"></p><div class="temporary-password" id="temporary-password" hidden></div></form><h2>Existing accounts</h2><div class="cards" id="account-list"><p class="hint">Loading accounts…</p></div>','Accounts');
 const roleSelect=app.querySelector<HTMLSelectElement>('[name="role"]')!;
 const classSelect=app.querySelector<HTMLSelectElement>('[name="classId"]')!;
 const studentField=app.querySelector<HTMLElement>('.student-account-field')!;
 const studentSelect=app.querySelector<HTMLSelectElement>('[name="studentId"]')!;
 const syncAccountFields=()=>{
  const isStudent=roleSelect.value==='student';
  const needsClass=isStudent||roleSelect.value==='teacher';
  classSelect.closest('label')!.hidden=!needsClass;
  studentField.hidden=!isStudent;
  Array.from(studentSelect.options).forEach(option=>{option.hidden=!!option.dataset.class&&option.dataset.class!==classSelect.value});
 };
 roleSelect.addEventListener('change',syncAccountFields);
 classSelect.addEventListener('change',syncAccountFields);
 syncAccountFields();
 app.querySelector<HTMLFormElement>('#create-account-form')?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!supabase)return;
  const form=event.currentTarget as HTMLFormElement;
  const values=new FormData(form);
  const role=String(values.get('role'));
  const classId=String(values.get('classId')||'')||null;
  const studentId=String(values.get('studentId')||'')||null;
  const result=await supabase.functions.invoke('admin-create-account',{
   body:{loginId:String(values.get('loginId')||''),displayName:String(values.get('displayName')||''),role,classId,studentId}
  });
  const errorElement=app.querySelector<HTMLElement>('#account-error')!;
  if(result.error||result.data?.error){
   console.error('Unable to create school account.',result.error||result.data?.error);
   errorElement.textContent=result.data?.error||'Unable to create this account.';
   return;
  }
  errorElement.textContent='';
  const passwordBox=app.querySelector<HTMLElement>('#temporary-password')!;
  passwordBox.hidden=false;
  passwordBox.textContent='Account '+result.data.loginId+' created. Temporary password (shown once): '+result.data.temporaryPassword;
  form.reset();
  syncAccountFields();
  void loadAccountList();
 });
 void loadAccountList();
}
async function loadAccountList(){
 if(!supabase)return;
 const list=app.querySelector<HTMLElement>('#account-list');
 if(!list)return;
 const {data:accounts,error}=await supabase.from('profiles').select('login_id,display_name,role,class_id').order('login_id');
 if(error){
  console.error('Unable to load school accounts.',error);
  list.textContent='Unable to load accounts. Try again.';
  return;
 }
 list.innerHTML=(accounts||[]).map(account=>'<article class="class-card"><b>'+esc(account.login_id)+'</b><div>'+esc(account.display_name)+' · '+esc(account.role)+'</div>'+(account.role==='admin'?'':'<button class="teal-btn" data-reset-account="'+esc(account.login_id)+'">Issue temporary password</button>')+'</article>').join('')||'<p class="hint">No additional accounts yet.</p>';
 list.querySelectorAll<HTMLButtonElement>('[data-reset-account]').forEach(button=>button.addEventListener('click',async()=>{
  if(!supabase)return;
  button.disabled=true;
  const result=await supabase.functions.invoke('admin-reset-account',{body:{loginId:button.dataset.resetAccount}});
  if(result.error||result.data?.error){
   console.error('Unable to reset school account.',result.error||result.data?.error);
   button.disabled=false;
   toast(result.data?.error||'Unable to reset this account.');
   return;
  }
  const passwordBox=app.querySelector<HTMLElement>('#temporary-password');
  if(passwordBox){passwordBox.hidden=false;passwordBox.textContent='Account '+result.data.loginId+' reset. Temporary password (shown once): '+result.data.temporaryPassword;}
  toast('Temporary password issued. Copy it now; it will not be shown again.');
  void loadAccountList();
 }));
}
app.addEventListener('click',event=>{
 if(!menuClass)return;
 const target=event.target;
 if(!(target instanceof Element)||target.closest('[data-more]'))return;
 menuClass='';
 render();
});
const menus=[['dashboard','Faculty Dashboard','⌂'],['classes','Classes','♧'],['timetable','Time Table','▦'],['attendance','Attendance Reports','◷'],['reports','Class Reports','▤'],['financial','Financial','＄'],['accounts','Accounts','♙'],['profile','Profile','●'],['backup','Backup / Restore','⇅']];
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const safeDateValue=(value:unknown)=>isDate(value)?value:'';
const safeLectureValue=(value:unknown)=>typeof value==='number'&&Number.isInteger(value)&&value>0?value:1;
const safeAttendanceStatus=(value:unknown):AttendanceStatus=>isAttendanceStatus(value)?value:'Absent';
let saveQueue:Promise<void>=Promise.resolve();
const persist=():Promise<boolean>=>{
 if(!supabase||!currentProfile)return Promise.resolve(false);
 let payload:unknown=data;
 if(currentProfile.role==='teacher'){
  payload={attendance:{[currentProfile.classId!]:data.attendance[currentProfile.classId!]||[]}};
 }else if(currentProfile.role==='finance'){
  payload={payments:data.classes.flatMap(c=>c.students.filter(s=>s.paid).map(s=>({id:s.id,paid:true})))};
 }
 payload=structuredClone(payload);
 let saved=true;
 saveQueue=saveQueue.then(async()=>{
  const {error}=await supabase.rpc('save_school_store',{payload});
  if(error)throw error;
 }).catch(async error=>{
  saved=false;
  console.error('Unable to save school data.',error);
  toast('Unable to save changes. Reloading saved data.');
  try{
   await loadSchoolData();
   render();
  }catch(loadError){
   console.error('Unable to reload saved school data.',loadError);
   appReady=false;
   renderLogin('Unable to reload school data. Please sign in again.');
  }
 });
 return saveQueue.then(()=>saved);
};
const cls=(id:string)=>data.classes.find(c=>c.id===id);
const pagesByRole:Record<UserRole,string[]>={admin:['dashboard','classes','students','attendance','reports','financial','accounts','profile','backup','timetable'],teacher:['dashboard','classes','students','attendance','reports','timetable'],finance:['dashboard','financial'],student:['dashboard']};
const canOpen=(page:string)=>!!currentProfile&&pagesByRole[currentProfile.role].some(allowed=>page===allowed||page.startsWith(allowed+':'));
const go=(page:string)=>{if(!canOpen(page)){toast('This page is not available for your account.');return}active=page;location.hash=page;render()};
const top=(crumb:string)=>'<header class="top"><button class="back" data-back>‹</button><span>'+esc(crumb)+'</span><span class="account-name">'+esc(currentProfile?.displayName||'')+'</span><button class="top-logout" data-logout>Sign out</button></header>';
function menu(){return '<aside class="menu"><img class="school-logo" src="./jaran-logo.jpeg" alt="Jaran School logo"><b class="menu-brand">JARAN PRIVATE SCHOOL</b></aside>'}
function layout(body:string,crumb:string){app.innerHTML=menu()+'<main>'+top(crumb)+'<section class="screen">'+body+'</section></main><div id="toast" role="status"></div>';bindCommon()}
function dashboard(){layout('<h1>JARAN PRIVATE SCHOOL</h1><div class="dash-menu">'+menus.filter(m=>m[0]!=='dashboard'&&canOpen(m[0])).map(m=>'<button data-page="'+m[0]+'"><i>'+m[2]+'</i>'+m[1]+'<span>›</span></button>').join('')+'</div>','Dashboard')}
function classesPage(){
 const cards=data.classes.map(c=>'<article class="class-card"><div class="class-top"><div><h2>'+esc(c.name.toUpperCase())+'</h2><small>'+esc(c.start||'—')+' to '+esc(c.end||'—')+'　 Incharge: '+esc(c.teacher||'—')+'</small></div><div class="counts"><b>♟ '+esc(c.students.length)+'</b></div></div><div class="class-actions"><button data-students="'+esc(c.id)+'"><i>♟</i>Students</button><button data-attendance="'+esc(c.id)+'"><i>◒</i>Attendance</button><button data-class-report="'+esc(c.id)+'"><i>▥</i>Reports</button>'+(currentProfile?.role==='admin'?'<button data-more="'+esc(c.id)+'"><i>⋮</i>More...</button>':'')+'</div>'+(currentProfile?.role==='admin'&&menuClass===c.id?'<div class="more-menu"><button data-copy="'+esc(c.id)+'">▢　Copy</button><button data-edit-class="'+esc(c.id)+'">✎　Edit</button><button data-delete-class="'+esc(c.id)+'">▣　Delete</button></div>':'')+'</article>').join('');
 layout('<div class="toolbar"><span class="count-chip">▣　'+esc(data.classes.length)+'</span>'+(currentProfile?.role==='admin'?'<button class="teal-btn" data-export-students>Download Students (.xlsx)</button><button class="teal-btn" data-add-class>＋ Add New Class</button>':'')+'</div><div class="cards">'+(cards||'<div class="empty-state">No classes have been created yet.'+(currentProfile?.role==='admin'?'<br><button class="teal-btn" data-add-class>＋ Add New Class</button>':'')+'</div>')+'</div>','Dashboard : Classes');
}
function studentsPage(id:string){
 const c=cls(id);if(!c){go('classes');return}
 const rows=c.students.filter(s=>s.name.toLowerCase().includes(filterText.toLowerCase())).map((s,i)=>'<article class="student-card"><div class="portrait">'+esc(s.name.slice(0,1).toUpperCase())+'</div><div class="student-info"><h2>'+esc(s.name.toUpperCase())+'</h2><div class="student-meta">SN: '+esc(i+1)+'　 Gender: '+esc(s.gender||'—')+'　 Reg: '+esc(s.reg||'—')+'<br>DOA: '+formatAttendanceDate(s.admissionDate)+(currentProfile?.role==='admin'?'　Guardian: '+esc(s.guardianName||'—')+'　 Phone: '+esc(s.guardianPhone||'—'):'')+'</div><div class="student-actions"><button data-student-action="report" data-student="'+esc(s.id)+'">▥<small>Report</small></button><button data-student-action="marks" data-student="'+esc(s.id)+'">Ⓜ<small>Marks</small></button>'+(currentProfile?.role==='admin'?'<a href="tel:'+esc(s.phone)+'">☎<small>Call</small></a><button data-edit-student="'+esc(s.id)+'">✎<small>Edit</small></button><button data-delete-student="'+esc(s.id)+'">▣<small>Delete</small></button>':'')+'</div></div></article>').join('');
 layout('<div class="toolbar"><button class="count-chip">'+esc(c.students.length)+'　Students</button><input class="filter-input" id="student-filter" placeholder="⌕ Search students" value="'+esc(filterText)+'">'+(currentProfile?.role==='admin'?'<button class="teal-btn" data-export-students="'+esc(id)+'">Download Excel</button><button class="teal-btn" data-add-student="'+esc(id)+'">＋ Add Student</button>':'')+'</div><div class="cards">'+(rows||'<div class="empty-state">No students in '+esc(c.name)+' yet.'+(currentProfile?.role==='admin'?'<br><button class="teal-btn" data-add-student="'+esc(id)+'">＋ Add Student</button>':'')+'</div>')+'</div>','Class '+c.name+' : Students');
}
function financial(){
 const c=cls(selectedClass);
 if(!c){layout('<h1>Financial</h1><p class="hint">Select a class to view its students and mark fee payments.</p><div class="cards">'+(data.classes.length?data.classes.map(x=>'<button class="financial-class" data-fin-class="'+esc(x.id)+'"><b>'+esc(x.name.toUpperCase())+'</b><span>'+esc(x.students.length)+' students　›</span></button>').join(''):'<div class="empty-state">No classes have been created yet.<br><button class="teal-btn" data-page="classes">Go to Classes</button></div>')+'</div>','Dashboard : Financial');return}
 const rows=c.students.map(s=>'<article class="paid-row"><span class="student-avatar">'+esc(s.name.slice(0,1).toUpperCase())+'</span><div class="paid-name"><b>'+esc(s.name)+'</b><small>'+esc(s.gender||c.name)+'</small></div>'+(s.paid?'<span class="paid-badge">PAID</span>':'<button class="teal-btn mark-paid" data-paid="'+esc(s.id)+'">＋ Mark Paid</button>')+'</article>').join('');
 layout('<button class="link-back" data-fin-back>‹ All classes</button><div class="fin-heading"><h1>'+esc(c.name.toUpperCase())+'</h1>'+(currentProfile?.role==='admin'?'<button class="teal-btn" data-add-student="'+esc(c.id)+'">＋ Add member</button>':'')+'</div><p class="hint">Class members · '+esc(c.students.length)+' students</p><div class="cards">'+(rows||'<div class="empty-state">No students in this class yet.'+(currentProfile?.role==='admin'?'<br><button class="teal-btn" data-add-student="'+esc(c.id)+'">＋ Add member</button>':'')+'</div>')+'</div>','Dashboard : Financial : '+c.name);
}
function formatAttendanceDate(value?:string){
 if(!value||!isDate(value)||!value)return '—';
 const [year,month,day]=value.split('-');
 return esc(day+'-'+month+'-'+year);
}
function openAttendance(classId:string,session?:Attendance,copy=false){
 const c=cls(classId);if(!c)return;
 if(!session&&!copy)session=(data.attendance[classId]||[]).find(x=>x.date===new Date().toISOString().slice(0,10)&&x.lecture===1);
 attendanceMode='take';
 attendanceEditingId=copy?'':session?.id||'';
 attendanceDraftDate=copy&&session?nextDay(session.date):session?.date||new Date().toISOString().slice(0,10);
 attendanceDraftLecture=session?.lecture||1;
 attendanceDraftRemarks=copy?'':session?.description||'';
 attendanceDraftMarks=Object.fromEntries(c.students.map(s=>[s.id,session?.marks[s.id]||'Absent']));
 render();
}
function nextDay(value:string){
 const date=new Date(value+'T00:00:00Z');
 date.setUTCDate(date.getUTCDate()+1);
 return date.toISOString().slice(0,10);
}
function syncAttendanceDraft(){
 const dateInput=app.querySelector<HTMLInputElement>('#attendance-date');
 const lectureInput=app.querySelector<HTMLInputElement>('#attendance-lecture');
 const remarksInput=app.querySelector<HTMLInputElement>('#attendance-remarks');
 if(dateInput)attendanceDraftDate=dateInput.value;
 if(lectureInput)attendanceDraftLecture=Number(lectureInput.value);
 if(remarksInput)attendanceDraftRemarks=remarksInput.value;
 attendanceStudentSort=app.querySelector<HTMLSelectElement>('#attendance-student-sort')?.value||attendanceStudentSort;
}
function attendancePage(id:string){
 const c=cls(id); if(!c){layout('<h1>Attendance Reports</h1><div class="cards">'+data.classes.map(x=>'<button class="financial-class" data-attendance="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><span>'+esc(x.students.length)+' students　›</span></button>').join('')+'</div>','Dashboard : Attendance');return}
 const sessions=[...(data.attendance[id]||[])].sort((a,b)=>attendanceDirection==='DESC'?b.date.localeCompare(a.date)||b.lecture-a.lecture:a.date.localeCompare(b.date)||a.lecture-b.lecture);
 const cards=sessions.map(s=>{
  const attended=c.students.filter(student=>s.marks[student.id]==='Present'||s.marks[student.id]==='Late').length;
  return '<article class="attendance-session-card"><div class="attendance-session-date"><b>'+formatAttendanceDate(s.date)+'</b><small>Lec: '+esc(safeLectureValue(s.lecture))+'　 Att: '+esc(attended)+' / '+esc(c.students.length)+'</small></div><div class="attendance-session-actions"><button data-session-report="'+esc(s.id)+'"><i>▥</i><small>Report</small></button><button data-session-copy="'+esc(s.id)+'"><i>▢</i><small>Copy</small></button><button data-session-edit="'+esc(s.id)+'"><i>✎</i><small>Edit</small></button><button data-session-delete="'+esc(s.id)+'"><i>▣</i><small>Delete</small></button></div></article>';
 }).join('');
 layout('<div class="attendance-list-toolbar"><span class="count-chip">♟　'+esc(sessions.length)+'</span><select id="attendance-direction"><option value="DESC" '+(attendanceDirection==='DESC'?'selected':'')+'>DESC</option><option value="ASC" '+(attendanceDirection==='ASC'?'selected':'')+'>ASC</option></select><button class="teal-btn" data-add-attendance="'+esc(id)+'">＋ Add Att</button></div><div class="attendance-history">'+(cards||'<div class="empty-state">No attendance records yet.<br><button class="teal-btn" data-add-attendance="'+esc(id)+'">＋ Add Att</button></div>')+'</div>','Class '+c.name+' : Attendance');
}
function takeAttendancePage(id:string){
 const c=cls(id);if(!c){attendanceMode='list';go('classes');return}
 const students=[...c.students].sort((a,b)=>attendanceStudentSort==='Registration Number'?a.reg.localeCompare(b.reg,undefined,{numeric:true}):a.name.localeCompare(b.name));
 const rows=students.map(s=>{
  const status=safeAttendanceStatus(attendanceDraftMarks[s.id]);
  const letter=status==='Present'?'P':status==='Late'?'L':'A';
  return '<article class="attendance-entry-row status-'+status.toLowerCase()+'"><span class="student-avatar">'+esc(s.name.slice(0,1).toUpperCase())+'</span><div class="attendance-student-info"><b>'+esc(s.name)+'</b><small>SN: '+esc(c.students.indexOf(s)+1)+'　 REG: '+esc(s.reg||'—')+'<br>GEN: '+esc(s.gender||'—')+'　 DOA: '+formatAttendanceDate(s.admissionDate)+'</small></div><button class="attendance-entry-status" data-cycle-mark="'+esc(s.id)+'" aria-label="Change '+esc(s.name)+' attendance from '+status+'"><b>'+letter+'</b><small>'+status.toUpperCase()+'</small></button></article>';
 }).join('');
 layout('<div class="attendance-entry-controls"><label>Date<input id="attendance-date" type="date" value="'+esc(safeDateValue(attendanceDraftDate))+'"></label><label>LEC<input id="attendance-lecture" type="number" min="1" value="'+esc(safeLectureValue(attendanceDraftLecture))+'"></label><button class="attendance-mark-all" data-mark-all="Absent" title="Mark all absent">A</button><label>Sort<select id="attendance-student-sort"><option '+(attendanceStudentSort==='Name'?'selected':'')+'>Name</option><option '+(attendanceStudentSort==='Registration Number'?'selected':'')+'>Registration Number</option></select></label><button class="teal-btn" data-save-att>▣ Save</button><label>LTYPE<select disabled><option>REGULAR</option></select></label><input id="attendance-remarks" class="attendance-remarks" placeholder="Enter Remarks if any..." value="'+esc(attendanceDraftRemarks)+'"></div><div class="attendance-entry-list">'+(rows||'<div class="empty-state">Add students to this class first.</div>')+'</div>','Class '+c.name+' : Attendance : Take Attendance');
}
function reportsPage(){
 const c=cls(reportClass);
 if(!c){layout('<h1>Class Reports</h1><div class="cards">'+(data.classes.map(x=>'<button class="financial-class" data-report-class="'+esc(x.id)+'"><b>'+esc(x.name)+'</b><span>Generate report　›</span></button>').join('')||'<div class="empty-state">Create a class before generating reports.</div>')+'</div>','Dashboard : Class Reports');return}
 const sessions=attendanceDays(c.id,reportFrom,reportTo);
 const filtered=sortReportStudents(c.students.filter(s=>{
  const percent=attendancePercent(s,sessions);
  return percent===null?reportMin===0:percent>=reportMin&&percent<=reportMax
 }),sessions);
 layout('<button class="link-back" data-report-back>‹ Classes</button><h1>Generate Reports</h1><div class="form-panel report-form"><label>Class Name<input disabled value="'+esc(c.name)+'"></label><label>From Date<input id="report-from" type="date" value="'+esc(safeDateValue(reportFrom))+'" required></label><label>To Date<input id="report-to" type="date" value="'+esc(safeDateValue(reportTo))+'" required></label><label>From Att %<input id="report-min" type="number" min="0" max="100" value="'+esc(reportMin)+'"></label><label>To Att %<input id="report-max" type="number" min="0" max="100" value="'+esc(reportMax)+'"></label><fieldset style="border:0;margin:12px 0;padding:0"><legend>Sort students by</legend><label style="display:inline-flex;justify-content:flex-start;gap:6px;margin-right:12px"><input style="width:auto" type="checkbox" name="report-order" value="Name" '+(reportOrder==='Name'?'checked':'')+'> Name</label><label style="display:inline-flex;justify-content:flex-start;gap:6px;margin-right:12px"><input style="width:auto" type="checkbox" name="report-order" value="Registration Number" '+(reportOrder==='Registration Number'?'checked':'')+'> Registration Number</label><label style="display:inline-flex;justify-content:flex-start;gap:6px"><input style="width:auto" type="checkbox" name="report-order" value="Attendance %" '+(reportOrder==='Attendance %'?'checked':'')+'> Attendance %</label></fieldset><label>Order<select id="report-direction"><option '+(reportDirection==='Ascending'?'selected':'')+'>Ascending</option><option '+(reportDirection==='Descending'?'selected':'')+'>Descending</option></select></label><div class="report-buttons"><button class="teal-btn" data-generate="register">DOWNLOAD ATTENDANCE REGISTER (.XLSX)</button><button class="teal-btn" data-generate="report">DOWNLOAD SUMMARY (.XLSX)</button></div><small class="warning">Late counts as half a day. Days without a saved attendance register are excluded.</small></div><div id="report-results">'+reportResults(c,filtered,sessions)+'</div>','Class '+c.name+' : Generate Report');
}
function reportResults(c:SchoolClass,students:Student[],sessions:Attendance[]){
 if(!document.querySelector('#report-results')&&!location.hash.includes('reports'))return '';
 return '<div class="report-result"><h2>'+esc(c.name)+' — Attendance report</h2><p>'+esc(students.length)+' students · '+esc(sessions.length)+' recorded days</p><div class="cards">'+students.map(s=>'<div class="att-row"><b>'+esc(s.reg||'—')+'　'+esc(s.name)+'</b><span>'+ (attendancePercent(s,sessions)===null?'No data':esc(attendancePercent(s,sessions))+'%')+'</span></div>').join('')+'</div></div>';
}
function attendanceDays(classId:string,from:string,to:string){
 const byDate=new Map<string,Attendance>();
 (data.attendance[classId]||[]).filter(s=>(!from||s.date>=from)&&(!to||s.date<=to)).sort((a,b)=>a.date.localeCompare(b.date)||a.lecture-b.lecture).forEach(s=>{if(!byDate.has(s.date))byDate.set(s.date,s)});
 return [...byDate.values()];
}
function attendancePercent(s:Student,sessions:Attendance[]):number|null{
 if(!sessions.length)return null;
 const score=sessions.reduce((total,session)=>total+(session.marks[s.id]==='Present'?1:session.marks[s.id]==='Late'?0.5:0),0);
 return Math.round(score/sessions.length*100);
}
function sortReportStudents(students:Student[],sessions:Attendance[]){
 const sorted=[...students].sort((a,b)=>{
  if(reportOrder==='Registration Number')return a.reg.localeCompare(b.reg,undefined,{numeric:true});
  if(reportOrder==='Attendance %'){
   const aPercent=attendancePercent(a,sessions),bPercent=attendancePercent(b,sessions);
   if(aPercent!==bPercent)return aPercent===null?-1:bPercent===null?1:aPercent-bPercent;
  }
  return a.name.localeCompare(b.name);
 });
 return reportDirection==='Ascending'?sorted:sorted.reverse();
}
function backup(){if(currentProfile?.role!=='admin'){go('dashboard');return}layout('<h1>Backup / Restore Database</h1><div class="backup-box"><h2>To Backup the Database:</h2><ol><li>Click on Backup Database Button</li><li>Choose a location on your device to save the database.</li><li>Keep the backup file somewhere safe.</li></ol><h2>To Restore the Database:</h2><ol><li>Click on Restore Database Button</li><li>Select a valid backup file.</li></ol><strong class="danger-text">Be careful, restoring will overwrite your existing database.</strong><p>This file contains student and guardian data in plain text. Keep it private and never upload it to GitHub or public groups.</p></div><div class="toolbar backup-tools"><button class="teal-btn" data-export>BACKUP DATABASE</button><button class="teal-btn" data-restore>RESTORE DATABASE</button><input type="file" id="restore-file" accept="application/json" hidden></div>','Backup / Restore Database')}
function profile(){if(currentProfile?.role!=='admin'){go('dashboard');return}layout('<h1>Profile</h1><div class="form-panel"><label>Faculty name<input id="profile-name" value="'+esc(data.profile.name)+'"></label><label>School name<input id="profile-school" value="'+esc(data.profile.school)+'"></label><button class="teal-btn" data-save-profile>Save</button></div>','Profile')}
function timetable(){const readOnly=currentProfile?.role!=='admin';layout('<h1>Time Table</h1><p class="hint">Weekly teaching schedule</p><div class="table-scroll"><table class="timetable"><tr><th>Day</th><th>Lecture 1</th><th>Lecture 2</th><th>Lecture 3</th></tr>'+['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=>'<tr><th>'+d+'</th>'+[1,2,3].map(n=>'<td><input data-timetable="'+d+'-'+n+'" '+(readOnly?'readonly ':'')+'value="'+esc(data.timetable.find(x=>x.startsWith(d+'-'+n+'|'))?.split('|')[1]||'')+'" placeholder="Class / subject"></td>').join('')+'</tr>').join('')+'</table>'+(readOnly?'':'<button class="teal-btn" data-save-timetable>Save Time Table</button>')+'</div>','Time Table')}
function render(){
 if(!appReady||!currentProfile){renderLogin();return}
 if(currentProfile.role==='student'){studentPortalPage();return}
 if(!canOpen(active))active='dashboard';
 if(active.startsWith('students:')){selectedClass=active.split(':')[1];return studentsPage(selectedClass)}
 if(active.startsWith('attendance:')){selectedClass=active.split(':')[1];return attendanceMode==='take'?takeAttendancePage(selectedClass):attendancePage(selectedClass)}
 if(active==='dashboard')return dashboard();
 if(active==='classes')return classesPage();
 if(active==='financial')return financial();
 if(active==='attendance')return attendancePage('');
 if(active==='reports')return reportsPage();
 if(active==='backup')return backup();
 if(active==='profile')return profile();
 if(active==='timetable')return timetable();
 if(active==='accounts')return accountsPage();
 return dashboard();
}
function toast(s:string){const t=document.querySelector('#toast');if(t){t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}}
function formDialog(title:string,fields:{name:string;label:string;value?:string;type?:string;options?:string[];required?:boolean;readOnly?:boolean;uppercase?:boolean}[],submit:(v:Record<string,string>)=>void){
 const dlg=document.createElement('dialog');dlg.className='editor-dialog';dlg.innerHTML='<form method="dialog" class="editor-form"><div class="dialog-head"><h2>'+esc(title)+'</h2><button class="close" type="button" aria-label="Cancel">×</button></div>'+fields.map(f=>'<label>'+esc(f.label)+(f.options?'<select name="'+esc(f.name)+'">'+f.options.map(o=>'<option '+(o===f.value?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select>':'<input style="'+(f.uppercase?'text-transform:uppercase':'')+'" name="'+esc(f.name)+'" type="'+esc(f.type||'text')+'" value="'+esc(f.value||'')+'" '+(f.required===false?'':'required')+' '+(f.readOnly?'readonly':'')+'>')+'</label>').join('')+'<button class="teal-btn" value="save">SAVE</button></form>';
 document.body.append(dlg);dlg.showModal();dlg.querySelector<HTMLButtonElement>('.close')!.addEventListener('click',()=>dlg.close());dlg.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(dlg.querySelector('form')!);const v:Record<string,string>={};fd.forEach((x,k)=>v[k]=String(x));submit(v);dlg.close()});dlg.addEventListener('close',()=>dlg.remove());
}
function addClass(existing?:SchoolClass,duplicate=false){formDialog(existing&&!duplicate?'Edit Class':'Add New Class',[{name:'name',label:'New Class Name',value:duplicate?'':existing?.name},{name:'teacher',label:'Class Teacher',value:existing?.teacher,required:false},{name:'start',label:'Start Date',value:existing?.start,type:'date'},{name:'end',label:'End Date',value:existing?.end,type:'date'}],async v=>{if(existing&&!duplicate)Object.assign(existing,{name:v.name,teacher:v.teacher,start:v.start,end:v.end});else data.classes.push({id:crypto.randomUUID(),name:v.name,teacher:v.teacher,start:v.start,end:v.end,students:[]});if(await persist()){render();toast('Class saved.')}})}
function nextRegistrationNumber(c:SchoolClass){const highest=c.students.reduce((max,s)=>Math.max(max,Number(s.reg?.match(/(\d+)$/)?.[1]||0)),c.students.length);return 'REG-'+String(highest+1).padStart(3,'0')}
function addStudent(classId:string,s?:Student){const c=cls(classId);if(!c)return;formDialog(s?'Edit Student':'Add Student',[{name:'name',label:'Student Name',value:s?.name,uppercase:true},{name:'gender',label:'Gender',value:s?.gender||'Female',options:['Female','Male','Other']},{name:'reg',label:'Registration Number',value:s?.reg||nextRegistrationNumber(c),readOnly:true,required:false},{name:'admissionDate',label:'Date of Admission',value:s?.admissionDate||(s?'':attendanceDate),type:'date',required:false},{name:'guardianName',label:'Parent / Guardian Name',value:s?.guardianName,uppercase:true,required:false},{name:'guardianPhone',label:'Parent / Guardian Phone',value:s?.guardianPhone,type:'tel',required:false},{name:'phone',label:'Student Phone',value:s?.phone,type:'tel',required:false}],async v=>{v.name=v.name.trim().toUpperCase();v.guardianName=v.guardianName.trim().toUpperCase();if(s)Object.assign(s,v);else c.students.push({id:crypto.randomUUID(),name:v.name,gender:v.gender,phone:v.phone,reg:v.reg,guardianName:v.guardianName,guardianPhone:v.guardianPhone,admissionDate:v.admissionDate,paid:false});if(await persist()){render();toast('Student saved.')}})}
function exportStudents(classId?:string){
 const classes=classId?[cls(classId)].filter((c):c is SchoolClass=>!!c):data.classes;
 const rows:(string|number|null)[][]=[['CLASS','REGISTRATION NUMBER','STUDENT NAME','GENDER','DATE OF ADMISSION','PARENT / GUARDIAN NAME','PARENT PHONE','STUDENT PHONE','FEE PAID']];
 classes.forEach(c=>c.students.forEach(s=>rows.push([c.name,s.reg,s.name,s.gender,s.admissionDate||'',s.guardianName||'',s.guardianPhone||'',s.phone||'',s.paid?'PAID':'UNPAID'])));
 const filename=classId?((cls(classId)?.name||'class').replace(/[^\w-]+/g,'-')+'-students.xlsx'):'school-students.xlsx';
 downloadXlsx(filename,[{name:'Students',rows}]);
}
function downloadAttendanceReport(c:SchoolClass,students:Student[],sessions:Attendance[],type:string){
 const range=reportFrom+'-to-'+reportTo;
 const className=c.name.replace(/[^\w-]+/g,'-');
 if(type==='register'){
  const rows:(string|number|null)[][]=[['CLASS',c.name],['DATE RANGE',formatAttendanceDate(reportFrom)+' to '+formatAttendanceDate(reportTo)],[],['REGISTRATION NUMBER','STUDENT NAME','GENDER','DATE OF ADMISSION',...sessions.map(s=>formatAttendanceDate(s.date)),'ATTENDANCE %']];
  students.forEach(s=>{const percent=attendancePercent(s,sessions);rows.push([s.reg,s.name,s.gender,s.admissionDate||'',...sessions.map(day=>day.marks[s.id]||'Absent'),percent===null?'No data':percent+'%'])});
  downloadXlsx(className+'-attendance-register-'+range+'.xlsx',[{name:'Daily Register',rows}]);
  return;
 }
 const rows:(string|number|null)[][]=[['STUDENT NAME','ATTENDANCE %'],...students.map(s=>[s.name,attendancePercent(s,sessions)===null?'No data':attendancePercent(s,sessions)+'%'])];
 downloadXlsx(className+'-attendance-summary-'+range+'.xlsx',[{name:'Attendance Summary',rows}]);
}
function bindCommon(){
 app.querySelectorAll<HTMLElement>('[data-page]').forEach(b=>b.onclick=()=>{filterText='';go(b.dataset.page!)});
 app.querySelector('[data-logout]')?.addEventListener('click',async()=>{
  if(!supabase)return;
  const {error}=await supabase.auth.signOut();
  if(error){console.error('Unable to sign out.',error);toast('Unable to sign out. Try again.');return}
  currentProfile=null;
  appReady=false;
  data={...blank,classes:[],attendance:{},profile:{...blank.profile},timetable:[]};
  renderLogin();
 });
 app.querySelector('[data-back]')?.addEventListener('click',()=>{if(active.startsWith('attendance:')&&attendanceMode==='take'){attendanceMode='list';render()}else if(active.startsWith('students:')||active.startsWith('attendance:'))go('classes');else go('dashboard')});
 app.querySelectorAll<HTMLElement>('[data-add-class]').forEach(b=>b.onclick=()=>addClass());
 app.querySelectorAll<HTMLElement>('[data-edit-class]').forEach(b=>b.onclick=()=>addClass(cls(b.dataset.editClass!)!));
 app.querySelectorAll<HTMLElement>('[data-copy]').forEach(b=>b.onclick=()=>addClass(cls(b.dataset.copy!)!,true));
 app.querySelectorAll<HTMLElement>('[data-more]').forEach(b=>b.onclick=()=>{menuClass=menuClass===b.dataset.more?'':b.dataset.more!;render()});
 app.querySelectorAll<HTMLElement>('[data-delete-class]').forEach(b=>b.onclick=async()=>{const c=cls(b.dataset.deleteClass!);if(c&&confirm('Delete '+c.name+' and its students and attendance?')){data.classes=data.classes.filter(x=>x.id!==c.id);delete data.attendance[c.id];if(await persist()){menuClass='';render()}}});
 app.querySelectorAll<HTMLElement>('[data-edit-student]').forEach(b=>b.onclick=()=>{const c=cls(selectedClass)!;addStudent(c.id,c.students.find(s=>s.id===b.dataset.editStudent))});
 app.querySelectorAll<HTMLElement>('[data-add-student]').forEach(b=>b.onclick=()=>addStudent(b.dataset.addStudent!));
 app.querySelectorAll<HTMLElement>('[data-delete-student]').forEach(b=>b.onclick=async()=>{const c=cls(selectedClass)!;const s=c.students.find(x=>x.id===b.dataset.deleteStudent);if(s&&confirm('Delete '+s.name+'?')){c.students=c.students.filter(x=>x.id!==s.id);if(await persist())render()}});
 app.querySelectorAll<HTMLElement>('[data-export-students]').forEach(b=>b.onclick=()=>exportStudents(b.dataset.exportStudents||undefined));
 app.querySelectorAll<HTMLElement>('[data-students]').forEach(b=>b.onclick=()=>{filterText='';go('students:'+b.dataset.students)});
 app.querySelectorAll<HTMLElement>('[data-attendance]').forEach(b=>b.onclick=()=>{attendanceMode='list';go('attendance:'+b.dataset.attendance)});
 app.querySelectorAll<HTMLElement>('[data-class-report]').forEach(b=>b.onclick=()=>{reportClass=b.dataset.classReport!;go('reports')});
 app.querySelectorAll<HTMLElement>('[data-fin-class]').forEach(b=>b.onclick=()=>{selectedClass=b.dataset.finClass!;renderFinancialKeep()});
 app.querySelectorAll<HTMLElement>('[data-paid]').forEach(b=>b.onclick=async()=>{const s=cls(selectedClass)?.students.find(x=>x.id===b.dataset.paid);if(s){s.paid=true;if(await persist()){render();toast('Marked as PAID.')}}});
 app.querySelector('[data-fin-back]')?.addEventListener('click',()=>{selectedClass='';render()});
 app.querySelector('#student-filter')?.addEventListener('input',e=>{filterText=(e.target as HTMLInputElement).value;const pos=(e.target as HTMLInputElement).selectionStart;render();const q=app.querySelector<HTMLInputElement>('#student-filter');q?.focus();q?.setSelectionRange(pos,pos)});
 app.querySelector('[data-add-attendance]')?.addEventListener('click',()=>openAttendance(selectedClass));
 app.querySelector('#attendance-direction')?.addEventListener('change',e=>{attendanceDirection=(e.target as HTMLSelectElement).value;render()});
 app.querySelector('#attendance-date')?.addEventListener('change',()=>syncAttendanceDraft());
 app.querySelector('#attendance-lecture')?.addEventListener('input',()=>syncAttendanceDraft());
 app.querySelector('#attendance-remarks')?.addEventListener('input',()=>syncAttendanceDraft());
 app.querySelector('#attendance-student-sort')?.addEventListener('change',()=>{syncAttendanceDraft();render()});
 app.querySelectorAll<HTMLElement>('[data-cycle-mark]').forEach(b=>b.onclick=()=>{
  syncAttendanceDraft();
  const id=b.dataset.cycleMark!,current=attendanceDraftMarks[id]||'Absent';
  attendanceDraftMarks[id]=current==='Absent'?'Present':current==='Present'?'Late':'Absent';
  render();
 });
 app.querySelector('[data-mark-all]')?.addEventListener('click',()=>{
  syncAttendanceDraft();
  const c=cls(selectedClass);
  c?.students.forEach(s=>attendanceDraftMarks[s.id]='Absent');
  render();
 });
 app.querySelector('[data-save-att]')?.addEventListener('click',async()=>{
  syncAttendanceDraft();
  const c=cls(selectedClass);
  if(!c||!attendanceDraftDate||!Number.isInteger(attendanceDraftLecture)||attendanceDraftLecture<1){toast('Enter a valid date and lecture number.');return}
  const sessions=(data.attendance[c.id]??=[]);
  const duplicate=sessions.find(x=>x.date===attendanceDraftDate&&x.lecture===attendanceDraftLecture&&x.id!==attendanceEditingId);
  if(duplicate){toast('Attendance already exists for that date and lecture. Edit or copy the existing record.');return}
  const existing=sessions.find(x=>x.id===attendanceEditingId);
  const value:Attendance={id:existing?.id||crypto.randomUUID(),date:attendanceDraftDate,lecture:attendanceDraftLecture,description:attendanceDraftRemarks,type:'Regular',marks:{...attendanceDraftMarks}};
  if(existing)Object.assign(existing,value);else sessions.unshift(value);
  attendanceDate=attendanceDraftDate;
  if(!await persist())return;
  attendanceMode='list';
  attendanceEditingId='';
  render();
  toast('Attendance saved.');
 });
 app.querySelectorAll<HTMLElement>('[data-session-report]').forEach(b=>b.onclick=()=>{
  const c=cls(selectedClass),session=data.attendance[selectedClass]?.find(x=>x.id===b.dataset.sessionReport);
  if(c&&session){reportClass=c.id;reportFrom=session.date;reportTo=session.date;go('reports')}
 });
 app.querySelectorAll<HTMLElement>('[data-session-copy]').forEach(b=>b.onclick=()=>{
  const session=data.attendance[selectedClass]?.find(x=>x.id===b.dataset.sessionCopy);
  if(session)openAttendance(selectedClass,session,true);
 });
 app.querySelectorAll<HTMLElement>('[data-session-edit]').forEach(b=>b.onclick=()=>{
  const session=data.attendance[selectedClass]?.find(x=>x.id===b.dataset.sessionEdit);
  if(session)openAttendance(selectedClass,session);
 });
 app.querySelectorAll<HTMLElement>('[data-session-delete]').forEach(b=>b.onclick=async()=>{
  const session=data.attendance[selectedClass]?.find(x=>x.id===b.dataset.sessionDelete);
  if(session&&confirm('Delete attendance for '+formatAttendanceDate(session.date)+'?')){
   data.attendance[selectedClass]=(data.attendance[selectedClass]||[]).filter(x=>x.id!==session.id);
   if(await persist())render();
  }
 });
 app.querySelectorAll<HTMLElement>('[data-report-class]').forEach(b=>b.onclick=()=>{reportClass=b.dataset.reportClass!;reportFrom='';reportTo='';go('reports')});
 app.querySelector('[data-report-back]')?.addEventListener('click',()=>{reportClass='';render()});
 app.querySelectorAll<HTMLInputElement>('input[name="report-order"]').forEach(input=>input.addEventListener('change',()=>{
  if(input.checked){
   reportOrder=input.value;
   app.querySelectorAll<HTMLInputElement>('input[name="report-order"]').forEach(other=>{other.checked=other===input});
  }else if(!app.querySelector<HTMLInputElement>('input[name="report-order"]:checked'))input.checked=true;
 }));
 app.querySelectorAll<HTMLButtonElement>('[data-generate]').forEach(button=>button.addEventListener('click',()=>{
  reportFrom=app.querySelector<HTMLInputElement>('#report-from')?.value||'';
  reportTo=app.querySelector<HTMLInputElement>('#report-to')?.value||'';
  reportMin=Number(app.querySelector<HTMLInputElement>('#report-min')?.value||0);
  reportMax=Number(app.querySelector<HTMLInputElement>('#report-max')?.value||100);
  reportDirection=app.querySelector<HTMLSelectElement>('#report-direction')!.value;
  const c=cls(reportClass);
  if(!c){toast('Choose a class first.');return}
  if(!reportFrom||!reportTo){toast('Choose both dates for the report.');return}
  if(reportFrom>reportTo){toast('The start date must be before the end date.');return}
  if(reportMin<0||reportMax>100||reportMin>reportMax){toast('Check the attendance percentage range.');return}
  const sessions=attendanceDays(c.id,reportFrom,reportTo);
  const students=sortReportStudents(c.students.filter(s=>{
   const percent=attendancePercent(s,sessions);
   return percent===null?reportMin===0:percent>=reportMin&&percent<=reportMax;
  }),sessions);
  downloadAttendanceReport(c,students,sessions,button.dataset.generate||'report');
  render();
  toast('Excel report downloaded.');
 }));
 app.querySelectorAll<HTMLElement>('[data-export]').forEach(b=>b.onclick=()=>{const blob=new Blob([JSON.stringify({app:'Evergreen Faculty Dashboard',version:2,data},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='faculty-database-backup.json';document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000)});
 app.querySelector('[data-restore]')?.addEventListener('click',()=>app.querySelector<HTMLInputElement>('#restore-file')!.click());
 app.querySelector<HTMLInputElement>('#restore-file')?.addEventListener('change',async e=>{
  const input=e.target as HTMLInputElement,file=input.files?.[0];
  if(!file||file.size>5*1024*1024){toast('Invalid backup file.');input.value='';return}
  let parsed:unknown;
  try{parsed=JSON.parse(await file.text()) as unknown}catch{toast('Invalid backup file.');input.value='';return}
  const candidate=isPlainObject(parsed)&&'data' in parsed?parsed.data:parsed;
  const next=sanitizeStore(candidate);
  if(!next){toast('Invalid backup file.');input.value='';return}
  if(confirm('Restore will replace all current classes, students, payments, and attendance. Continue?')){
   data=next;
   if(await persist()){go('dashboard');toast('Database restored.')}
  }
  input.value='';
 });
 app.querySelector('[data-save-profile]')?.addEventListener('click',async()=>{data.profile={name:app.querySelector<HTMLInputElement>('#profile-name')!.value,school:app.querySelector<HTMLInputElement>('#profile-school')!.value};if(await persist())toast('Profile saved.')});
 app.querySelector('[data-save-timetable]')?.addEventListener('click',async()=>{data.timetable=Array.from(app.querySelectorAll<HTMLInputElement>('[data-timetable]')).map(x=>x.dataset.timetable+'|'+x.value);if(await persist())toast('Time table saved.')});
 app.querySelectorAll<HTMLElement>('[data-student-action]').forEach(b=>b.onclick=()=>toast(b.dataset.studentAction==='marks'?'Marks module is ready for entries.':'Use Class Reports to generate attendance records.'));
}
function renderFinancialKeep(){active='financial';render()}
window.addEventListener('hashchange',()=>{active=location.hash.slice(1)||'dashboard';if(appReady)render()});
void initializeSession();
if('serviceWorker' in navigator){
 window.addEventListener('load',()=>{
  navigator.serviceWorker.register('./service-worker.js').catch(error=>{
   console.error('Unable to register offline support.',error);
  });
 });
}

