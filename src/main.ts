import './styles.css';
import './attendance.css';
import { downloadXlsx } from './xlsx';

type AttendanceStatus='Present'|'Absent'|'Late';
type Student = { id:string; name:string; gender:string; phone:string; reg:string; guardianName?:string; guardianPhone?:string; admissionDate?:string; paid:boolean };
type SchoolClass = { id:string; name:string; teacher:string; start:string; end:string; students:Student[] };
type Attendance = { id:string; date:string; lecture:number; description:string; type?:string; marks:Record<string,AttendanceStatus> };
type Store = { classes:SchoolClass[]; attendance:Record<string,Attendance[]>; profile:{name:string;school:string}; timetable:string[] };
const KEY='evergreen-school-data-v2';
const legacy=JSON.parse(localStorage.getItem('evergreen-school-fees-v1')||'[]');
const blank:Store={classes:[],attendance:{},profile:{name:'Faculty Administrator',school:'JARAN PRIVATE SCHOOL'},timetable:[]};
let data:Store=(()=>{try{const v=JSON.parse(localStorage.getItem(KEY)||'null');if(v&&Array.isArray(v.classes))return {...blank,...v}}catch{};if(legacy.length){const grouped:Record<string,SchoolClass>={};legacy.forEach((f:any)=>{const n=f.className||'CLASS 8AAD';if(!grouped[n])grouped[n]={id:crypto.randomUUID(),name:n,teacher:'',start:'',end:'',students:[]};grouped[n].students.push({id:crypto.randomUUID(),name:f.student,gender:'',phone:'',reg:'',paid:Number(f.paid)>=Number(f.amount)})});return {...blank,classes:Object.values(grouped)}}return blank})();
let active=location.hash.slice(1)||'dashboard', selectedClass='', menuClass='', reportClass='';
let filterText='', attendanceDate=new Date().toISOString().slice(0,10), reportFrom='', reportTo='', reportMin=0, reportMax=100, reportOrder='Name', reportDirection='Ascending';
let attendanceMode:'list'|'take'='list', attendanceEditingId='', attendanceDraftDate=attendanceDate, attendanceDraftLecture=1, attendanceDraftRemarks='', attendanceDraftMarks:Record<string,AttendanceStatus>={}, attendanceDirection='DESC', attendanceStudentSort='Name';
const app=document.querySelector<HTMLDivElement>('#app')!;
const menus=[['dashboard','Faculty Dashboard','⌂'],['classes','Classes','♧'],['timetable','Time Table','▦'],['attendance','Attendance Reports','◷'],['reports','Class Reports','▤'],['financial','Financial','＄'],['profile','Profile','●'],['backup','Backup / Restore','⇅']];
const esc=(s:string)=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const persist=()=>localStorage.setItem(KEY,JSON.stringify(data));
const cls=(id:string)=>data.classes.find(c=>c.id===id);
const go=(page:string)=>{active=page;location.hash=page;render()};
const top=(crumb:string)=>'<header class="top"><button class="back" data-back>‹</button><span>'+esc(crumb)+'</span><button class="top-profile" data-page="profile">●</button></header>';
function menu(){return '<aside class="menu"><b class="menu-brand">JARAN PRIVATE SCHOOL</b></aside>'}
function layout(body:string,crumb:string){app.innerHTML=menu()+'<main>'+top(crumb)+'<section class="screen">'+body+'</section></main><div id="toast" role="status"></div>';bindCommon()}
function dashboard(){layout('<h1>JARAN PRIVATE SCHOOL</h1><div class="dash-menu">'+menus.filter(m=>m[0]!=='dashboard').map(m=>'<button data-page="'+m[0]+'"><i>'+m[2]+'</i>'+m[1]+'<span>›</span></button>').join('')+'</div>','Dashboard')}
function classesPage(){
 const cards=data.classes.map(c=>'<article class="class-card"><div class="class-top"><div><h2>'+esc(c.name.toUpperCase())+'</h2><small>'+esc(c.start||'—')+' to '+esc(c.end||'—')+'　 Incharge: '+esc(c.teacher||'—')+'</small></div><div class="counts"><b>♟ '+c.students.length+'</b></div></div><div class="class-actions"><button data-students="'+c.id+'"><i>♟</i>Students</button><button data-attendance="'+c.id+'"><i>◒</i>Attendance</button><button data-class-report="'+c.id+'"><i>▥</i>Reports</button><button data-more="'+c.id+'"><i>⋮</i>More...</button></div>'+(menuClass===c.id?'<div class="more-menu"><button data-copy="'+c.id+'">▢　Copy</button><button data-edit-class="'+c.id+'">✎　Edit</button><button data-delete-class="'+c.id+'">▣　Delete</button></div>':'')+'</article>').join('');
 layout('<div class="toolbar"><span class="count-chip">▣　'+data.classes.length+'</span><button class="teal-btn" data-export-students>Download Students (.xlsx)</button><button class="teal-btn" data-add-class>＋ Add New Class</button></div><div class="cards">'+(cards||'<div class="empty-state">No classes have been created yet.<br><button class="teal-btn" data-add-class>＋ Add New Class</button></div>')+'</div>','Dashboard : Classes');
}
function studentsPage(id:string){
 const c=cls(id);if(!c){go('classes');return}
 const rows=c.students.filter(s=>s.name.toLowerCase().includes(filterText.toLowerCase())).map((s,i)=>'<article class="student-card"><div class="portrait">'+esc(s.name.slice(0,1).toUpperCase())+'</div><div class="student-info"><h2>'+esc(s.name.toUpperCase())+'</h2><div class="student-meta">SN: '+(i+1)+'　 Gender: '+esc(s.gender||'—')+'　 Reg: '+esc(s.reg||'—')+'<br>DOA: '+formatAttendanceDate(s.admissionDate)+'　Guardian: '+esc(s.guardianName||'—')+'　 Phone: '+esc(s.guardianPhone||'—')+'</div><div class="student-actions"><button data-student-action="profile" data-student="'+s.id+'">●<small>Profile</small></button><button data-student-action="report" data-student="'+s.id+'">▥<small>Report</small></button><button data-student-action="marks" data-student="'+s.id+'">Ⓜ<small>Marks</small></button><a href="tel:'+esc(s.phone)+'">☎<small>Call</small></a><button data-edit-student="'+s.id+'">✎<small>Edit</small></button><button data-delete-student="'+s.id+'">▣<small>Delete</small></button></div></div></article>').join('');
 layout('<div class="toolbar"><button class="count-chip">'+c.students.length+'　Students</button><input class="filter-input" id="student-filter" placeholder="⌕ Search students" value="'+esc(filterText)+'"><button class="teal-btn" data-export-students="'+id+'">Download Excel</button><button class="teal-btn" data-add-student="'+id+'">＋ Add Student</button></div><div class="cards">'+(rows||'<div class="empty-state">No students in '+esc(c.name)+' yet.<br><button class="teal-btn" data-add-student="'+id+'">＋ Add Student</button></div>')+'</div>','Class '+c.name+' : Students');
}
function financial(){
 const c=cls(selectedClass);
 if(!c){layout('<h1>Financial</h1><p class="hint">Select a class to view its students and mark fee payments.</p><div class="cards">'+(data.classes.length?data.classes.map(x=>'<button class="financial-class" data-fin-class="'+x.id+'"><b>'+esc(x.name.toUpperCase())+'</b><span>'+x.students.length+' students　›</span></button>').join(''):'<div class="empty-state">No classes have been created yet.<br><button class="teal-btn" data-page="classes">Go to Classes</button></div>')+'</div>','Dashboard : Financial');return}
 const rows=c.students.map(s=>'<article class="paid-row"><span class="student-avatar">'+esc(s.name.slice(0,1).toUpperCase())+'</span><div class="paid-name"><b>'+esc(s.name)+'</b><small>'+esc(s.gender||c.name)+'</small></div>'+(s.paid?'<span class="paid-badge">PAID</span>':'<button class="teal-btn mark-paid" data-paid="'+s.id+'">＋ Mark Paid</button>')+'</article>').join('');
 layout('<button class="link-back" data-fin-back>‹ All classes</button><div class="fin-heading"><h1>'+esc(c.name.toUpperCase())+'</h1><button class="teal-btn" data-add-student="'+c.id+'">＋ Add member</button></div><p class="hint">Class members · '+c.students.length+' students</p><div class="cards">'+(rows||'<div class="empty-state">No students in this class yet.<br><button class="teal-btn" data-add-student="'+c.id+'">＋ Add member</button></div>')+'</div>','Dashboard : Financial : '+c.name);
}
function formatAttendanceDate(value?:string){
 if(!value)return '—';
 const [year,month,day]=value.split('-');
 return year&&month&&day?day+'-'+month+'-'+year:'—';
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
 const c=cls(id);if(!c){layout('<h1>Attendance Reports</h1><div class="cards">'+data.classes.map(x=>'<button class="financial-class" data-attendance="'+x.id+'"><b>'+esc(x.name)+'</b><span>'+x.students.length+' students　›</span></button>').join('')+'</div>','Dashboard : Attendance');return}
 const sessions=[...(data.attendance[id]||[])].sort((a,b)=>attendanceDirection==='DESC'?b.date.localeCompare(a.date)||b.lecture-a.lecture:a.date.localeCompare(b.date)||a.lecture-b.lecture);
 const cards=sessions.map(s=>{
  const attended=c.students.filter(student=>s.marks[student.id]==='Present'||s.marks[student.id]==='Late').length;
  return '<article class="attendance-session-card"><div class="attendance-session-date"><b>'+formatAttendanceDate(s.date)+'</b><small>Lec: '+s.lecture+'　 Att: '+attended+' / '+c.students.length+'</small></div><div class="attendance-session-actions"><button data-session-report="'+s.id+'"><i>▥</i><small>Report</small></button><button data-session-copy="'+s.id+'"><i>▢</i><small>Copy</small></button><button data-session-edit="'+s.id+'"><i>✎</i><small>Edit</small></button><button data-session-delete="'+s.id+'"><i>▣</i><small>Delete</small></button></div></article>';
 }).join('');
 layout('<div class="attendance-list-toolbar"><span class="count-chip">♟　'+sessions.length+'</span><select id="attendance-direction"><option value="DESC" '+(attendanceDirection==='DESC'?'selected':'')+'>DESC</option><option value="ASC" '+(attendanceDirection==='ASC'?'selected':'')+'>ASC</option></select><button class="teal-btn" data-add-attendance="'+id+'">＋ Add Att</button></div><div class="attendance-history">'+(cards||'<div class="empty-state">No attendance records yet.<br><button class="teal-btn" data-add-attendance="'+id+'">＋ Add Att</button></div>')+'</div>','Class '+c.name+' : Attendance');
}
function takeAttendancePage(id:string){
 const c=cls(id);if(!c){attendanceMode='list';go('classes');return}
 const students=[...c.students].sort((a,b)=>attendanceStudentSort==='Registration Number'?a.reg.localeCompare(b.reg,undefined,{numeric:true}):a.name.localeCompare(b.name));
 const rows=students.map(s=>{
  const status=attendanceDraftMarks[s.id]||'Absent';
  const letter=status==='Present'?'P':status==='Late'?'L':'A';
  return '<article class="attendance-entry-row status-'+status.toLowerCase()+'"><span class="student-avatar">'+esc(s.name.slice(0,1).toUpperCase())+'</span><div class="attendance-student-info"><b>'+esc(s.name)+'</b><small>SN: '+(c.students.indexOf(s)+1)+'　 REG: '+esc(s.reg||'—')+'<br>GEN: '+esc(s.gender||'—')+'　 DOA: '+formatAttendanceDate(s.admissionDate)+'</small></div><button class="attendance-entry-status" data-cycle-mark="'+s.id+'" aria-label="Change '+esc(s.name)+' attendance from '+status+'"><b>'+letter+'</b><small>'+status.toUpperCase()+'</small></button></article>';
 }).join('');
 layout('<div class="attendance-entry-controls"><label>Date<input id="attendance-date" type="date" value="'+attendanceDraftDate+'"></label><label>LEC<input id="attendance-lecture" type="number" min="1" value="'+attendanceDraftLecture+'"></label><button class="attendance-mark-all" data-mark-all="Absent" title="Mark all absent">A</button><label>Sort<select id="attendance-student-sort"><option '+(attendanceStudentSort==='Name'?'selected':'')+'>Name</option><option '+(attendanceStudentSort==='Registration Number'?'selected':'')+'>Registration Number</option></select></label><button class="teal-btn" data-save-att>▣ Save</button><label>LTYPE<select disabled><option>REGULAR</option></select></label><input id="attendance-remarks" class="attendance-remarks" placeholder="Enter Remarks if any..." value="'+esc(attendanceDraftRemarks)+'"></div><div class="attendance-entry-list">'+(rows||'<div class="empty-state">Add students to this class first.</div>')+'</div>','Class '+c.name+' : Attendance : Take Attendance');
}
function reportsPage(){
 const c=cls(reportClass);
 if(!c){layout('<h1>Class Reports</h1><div class="cards">'+(data.classes.map(x=>'<button class="financial-class" data-report-class="'+x.id+'"><b>'+esc(x.name)+'</b><span>Generate report　›</span></button>').join('')||'<div class="empty-state">Create a class before generating reports.</div>')+'</div>','Dashboard : Class Reports');return}
 const sessions=attendanceDays(c.id,reportFrom,reportTo);
 const filtered=sortReportStudents(c.students.filter(s=>{
  const percent=attendancePercent(s,sessions);
  return percent===null?reportMin===0:percent>=reportMin&&percent<=reportMax
 }),sessions);
 layout('<button class="link-back" data-report-back>‹ Classes</button><h1>Generate Reports</h1><div class="form-panel report-form"><label>Class Name<input disabled value="'+esc(c.name)+'"></label><label>From Date<input id="report-from" type="date" value="'+reportFrom+'" required></label><label>To Date<input id="report-to" type="date" value="'+reportTo+'" required></label><label>From Att %<input id="report-min" type="number" min="0" max="100" value="'+reportMin+'"></label><label>To Att %<input id="report-max" type="number" min="0" max="100" value="'+reportMax+'"></label><fieldset style="border:0;margin:12px 0;padding:0"><legend>Sort students by</legend><label style="display:inline-flex;justify-content:flex-start;gap:6px;margin-right:12px"><input style="width:auto" type="checkbox" name="report-order" value="Name" '+(reportOrder==='Name'?'checked':'')+'> Name</label><label style="display:inline-flex;justify-content:flex-start;gap:6px;margin-right:12px"><input style="width:auto" type="checkbox" name="report-order" value="Registration Number" '+(reportOrder==='Registration Number'?'checked':'')+'> Registration Number</label><label style="display:inline-flex;justify-content:flex-start;gap:6px"><input style="width:auto" type="checkbox" name="report-order" value="Attendance %" '+(reportOrder==='Attendance %'?'checked':'')+'> Attendance %</label></fieldset><label>Order<select id="report-direction"><option '+(reportDirection==='Ascending'?'selected':'')+'>Ascending</option><option '+(reportDirection==='Descending'?'selected':'')+'>Descending</option></select></label><div class="report-buttons"><button class="teal-btn" data-generate="register">DOWNLOAD ATTENDANCE REGISTER (.XLSX)</button><button class="teal-btn" data-generate="report">DOWNLOAD SUMMARY (.XLSX)</button></div><small class="warning">Late counts as half a day. Days without a saved attendance register are excluded.</small></div><div id="report-results">'+reportResults(c,filtered,sessions)+'</div>','Class '+c.name+' : Generate Report');
}
function reportResults(c:SchoolClass,students:Student[],sessions:Attendance[]){
 if(!document.querySelector('#report-results')&&!location.hash.includes('reports'))return '';
 return '<div class="report-result"><h2>'+esc(c.name)+' — Attendance report</h2><p>'+students.length+' students · '+sessions.length+' recorded days</p><div class="cards">'+students.map(s=>'<div class="att-row"><b>'+esc(s.reg||'—')+'　'+esc(s.name)+'</b><span>'+ (attendancePercent(s,sessions)===null?'No data':attendancePercent(s,sessions)+'%')+'</span></div>').join('')+'</div></div>';
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
function backup(){layout('<h1>Backup / Restore Database</h1><div class="backup-box"><h2>To Backup the Database:</h2><ol><li>Click on Backup Database Button</li><li>Choose a location on your device to save the database.</li><li>Keep the backup file somewhere safe.</li></ol><h2>To Restore the Database:</h2><ol><li>Click on Restore Database Button</li><li>Select a valid backup file.</li></ol><strong class="danger-text">Be careful, restoring will overwrite your existing database.</strong></div><div class="toolbar backup-tools"><button class="teal-btn" data-export>BACKUP DATABASE</button><button class="teal-btn" data-restore>RESTORE DATABASE</button><input type="file" id="restore-file" accept="application/json" hidden></div>','Backup / Restore Database')}
function profile(){layout('<h1>Profile</h1><div class="form-panel"><label>Faculty name<input id="profile-name" value="'+esc(data.profile.name)+'"></label><label>School name<input id="profile-school" value="'+esc(data.profile.school)+'"></label><button class="teal-btn" data-save-profile>Save</button></div>','Profile')}
function timetable(){layout('<h1>Time Table</h1><p class="hint">Weekly teaching schedule</p><div class="table-scroll"><table class="timetable"><tr><th>Day</th><th>Lecture 1</th><th>Lecture 2</th><th>Lecture 3</th></tr>'+['Monday','Tuesday','Wednesday','Thursday','Friday'].map(d=>'<tr><th>'+d+'</th>'+[1,2,3].map(n=>'<td><input data-timetable="'+d+'-'+n+'" value="'+esc(data.timetable.find(x=>x.startsWith(d+'-'+n+'|'))?.split('|')[1]||'')+'" placeholder="Class / subject"></td>').join('')+'</tr>').join('')+'</table><button class="teal-btn" data-save-timetable>Save Time Table</button></div>','Time Table')}
function render(){ if(active.startsWith('students:')){selectedClass=active.split(':')[1];return studentsPage(selectedClass)}if(active.startsWith('attendance:')){selectedClass=active.split(':')[1];return attendanceMode==='take'?takeAttendancePage(selectedClass):attendancePage(selectedClass)}if(active==='dashboard')return dashboard();if(active==='classes')return classesPage();if(active==='financial')return financial();if(active==='attendance')return attendancePage('');if(active==='reports')return reportsPage();if(active==='backup')return backup();if(active==='profile')return profile();if(active==='timetable')return timetable();return dashboard()}
function toast(s:string){const t=document.querySelector('#toast');if(t){t.textContent=s;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2200)}}
function formDialog(title:string,fields:{name:string;label:string;value?:string;type?:string;options?:string[];required?:boolean;readOnly?:boolean;uppercase?:boolean}[],submit:(v:Record<string,string>)=>void){
 const dlg=document.createElement('dialog');dlg.className='editor-dialog';dlg.innerHTML='<form method="dialog" class="editor-form"><div class="dialog-head"><h2>'+esc(title)+'</h2><button class="close" type="button" aria-label="Cancel">×</button></div>'+fields.map(f=>'<label>'+esc(f.label)+(f.options?'<select name="'+f.name+'">'+f.options.map(o=>'<option '+(o===f.value?'selected':'')+'>'+esc(o)+'</option>').join('')+'</select>':'<input style="'+(f.uppercase?'text-transform:uppercase':'')+'" name="'+f.name+'" type="'+(f.type||'text')+'" value="'+esc(f.value||'')+'" '+(f.required===false?'':'required')+' '+(f.readOnly?'readonly':'')+'>')+'</label>').join('')+'<button class="teal-btn" value="save">SAVE</button></form>';
 document.body.append(dlg);dlg.showModal();dlg.querySelector<HTMLButtonElement>('.close')!.addEventListener('click',()=>dlg.close());dlg.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();const fd=new FormData(dlg.querySelector('form')!);const v:Record<string,string>={};fd.forEach((x,k)=>v[k]=String(x));submit(v);dlg.close()});dlg.addEventListener('close',()=>dlg.remove());
}
function addClass(existing?:SchoolClass,duplicate=false){formDialog(existing&&!duplicate?'Edit Class':'Add New Class',[{name:'name',label:'New Class Name',value:duplicate?'':existing?.name},{name:'teacher',label:'Class Teacher',value:existing?.teacher,required:false},{name:'start',label:'Start Date',value:existing?.start,type:'date'},{name:'end',label:'End Date',value:existing?.end,type:'date'}],v=>{if(existing&&!duplicate)Object.assign(existing,{name:v.name,teacher:v.teacher,start:v.start,end:v.end});else data.classes.push({id:crypto.randomUUID(),name:v.name,teacher:v.teacher,start:v.start,end:v.end,students:[]});persist();render();toast('Class saved.')})}
function nextRegistrationNumber(c:SchoolClass){const highest=c.students.reduce((max,s)=>Math.max(max,Number(s.reg?.match(/(\d+)$/)?.[1]||0)),c.students.length);return 'REG-'+String(highest+1).padStart(3,'0')}
function addStudent(classId:string,s?:Student){const c=cls(classId);if(!c)return;formDialog(s?'Edit Student':'Add Student',[{name:'name',label:'Student Name',value:s?.name,uppercase:true},{name:'gender',label:'Gender',value:s?.gender||'Female',options:['Female','Male','Other']},{name:'reg',label:'Registration Number',value:s?.reg||nextRegistrationNumber(c),readOnly:true},{name:'admissionDate',label:'Date of Admission',value:s?.admissionDate||(s?'':attendanceDate),type:'date',required:false},{name:'guardianName',label:'Parent / Guardian Name',value:s?.guardianName,uppercase:true},{name:'guardianPhone',label:'Parent / Guardian Phone',value:s?.guardianPhone,type:'tel'},{name:'phone',label:'Student Phone',value:s?.phone,type:'tel',required:false}],v=>{v.name=v.name.trim().toUpperCase();v.guardianName=v.guardianName.trim().toUpperCase();if(s)Object.assign(s,v);else c.students.push({id:crypto.randomUUID(),...v,paid:false});persist();render();toast('Student saved.')})}
function exportStudents(classId?:string){
 const classes=classId?[cls(classId)].filter((c):c is SchoolClass=>!!c):data.classes;
 const rows:(string|number|null)[][]=[['CLASS','REGISTRATION NUMBER','STUDENT NAME','GENDER','DATE OF ADMISSION','PARENT / GUARDIAN NAME','PARENT PHONE','STUDENT PHONE','FEE PAID']];
 classes.forEach(c=>c.students.forEach(s=>rows.push([c.name,s.reg,s.name,s.gender,s.admissionDate||'',s.guardianName||'',s.guardianPhone||'',s.phone||'',s.paid?'PAID':'UNPAID'])));
 const filename=classId?((cls(classId)?.name||'class').replace(/[^\w-]+/g,'-')+'-students.xlsx'):'school-students.xlsx';
 downloadXlsx(filename,[{name:'Students',rows}]);
}
function attendanceSummaryRow(s:Student,sessions:Attendance[]):(string|number|null)[]{
 const present=sessions.filter(x=>x.marks[s.id]==='Present').length;
 const late=sessions.filter(x=>x.marks[s.id]==='Late').length;
 const absent=sessions.length-present-late;
 const percent=attendancePercent(s,sessions);
 return [s.reg,s.name,s.gender,s.admissionDate||'',present,late,absent,present+late/2,sessions.length,percent===null?'No data':percent+'%'];
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
 const rows:(string|number|null)[][]=[['CLASS',c.name],['DATE RANGE',formatAttendanceDate(reportFrom)+' to '+formatAttendanceDate(reportTo)],[],['REGISTRATION NUMBER','STUDENT NAME','GENDER','DATE OF ADMISSION','PRESENT DAYS','LATE DAYS','ABSENT DAYS','EQUIVALENT ATTENDED DAYS','RECORDED DAYS','ATTENDANCE %'],...students.map(s=>attendanceSummaryRow(s,sessions))];
 downloadXlsx(className+'-attendance-summary-'+range+'.xlsx',[{name:'Attendance Summary',rows}]);
}
function bindCommon(){
 app.querySelectorAll<HTMLElement>('[data-page]').forEach(b=>b.onclick=()=>{filterText='';go(b.dataset.page!)});
 app.querySelector('[data-back]')?.addEventListener('click',()=>{if(active.startsWith('attendance:')&&attendanceMode==='take'){attendanceMode='list';render()}else if(active.startsWith('students:')||active.startsWith('attendance:'))go('classes');else go('dashboard')});
 app.querySelectorAll<HTMLElement>('[data-add-class]').forEach(b=>b.onclick=()=>addClass());
 app.querySelectorAll<HTMLElement>('[data-edit-class]').forEach(b=>b.onclick=()=>addClass(cls(b.dataset.editClass!)!));
 app.querySelectorAll<HTMLElement>('[data-copy]').forEach(b=>b.onclick=()=>addClass(cls(b.dataset.copy!)!,true));
 app.querySelectorAll<HTMLElement>('[data-more]').forEach(b=>b.onclick=()=>{menuClass=menuClass===b.dataset.more?'':b.dataset.more!;render()});
 app.querySelectorAll<HTMLElement>('[data-delete-class]').forEach(b=>b.onclick=()=>{const c=cls(b.dataset.deleteClass!);if(c&&confirm('Delete '+c.name+' and its students and attendance?')){data.classes=data.classes.filter(x=>x.id!==c.id);delete data.attendance[c.id];persist();menuClass='';render()}});
 app.querySelectorAll<HTMLElement>('[data-edit-student]').forEach(b=>b.onclick=()=>{const c=cls(selectedClass)!;addStudent(c.id,c.students.find(s=>s.id===b.dataset.editStudent))});
 app.querySelectorAll<HTMLElement>('[data-add-student]').forEach(b=>b.onclick=()=>addStudent(b.dataset.addStudent!));
 app.querySelectorAll<HTMLElement>('[data-delete-student]').forEach(b=>b.onclick=()=>{const c=cls(selectedClass)!;const s=c.students.find(x=>x.id===b.dataset.deleteStudent);if(s&&confirm('Delete '+s.name+'?')){c.students=c.students.filter(x=>x.id!==s.id);persist();render()}});
 app.querySelectorAll<HTMLElement>('[data-export-students]').forEach(b=>b.onclick=()=>exportStudents(b.dataset.exportStudents||undefined));
 app.querySelectorAll<HTMLElement>('[data-students]').forEach(b=>b.onclick=()=>{filterText='';go('students:'+b.dataset.students)});
 app.querySelectorAll<HTMLElement>('[data-attendance]').forEach(b=>b.onclick=()=>{attendanceMode='list';go('attendance:'+b.dataset.attendance)});
 app.querySelectorAll<HTMLElement>('[data-class-report]').forEach(b=>b.onclick=()=>{reportClass=b.dataset.classReport!;go('reports')});
 app.querySelectorAll<HTMLElement>('[data-fin-class]').forEach(b=>b.onclick=()=>{selectedClass=b.dataset.finClass!;renderFinancialKeep()});
 app.querySelectorAll<HTMLElement>('[data-paid]').forEach(b=>b.onclick=()=>{const s=cls(selectedClass)?.students.find(x=>x.id===b.dataset.paid);if(s){s.paid=true;persist();render();toast('Marked as PAID.')}});
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
 app.querySelector('[data-save-att]')?.addEventListener('click',()=>{
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
  persist();
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
 app.querySelectorAll<HTMLElement>('[data-session-delete]').forEach(b=>b.onclick=()=>{
  const session=data.attendance[selectedClass]?.find(x=>x.id===b.dataset.sessionDelete);
  if(session&&confirm('Delete attendance for '+formatAttendanceDate(session.date)+'?')){
   data.attendance[selectedClass]=(data.attendance[selectedClass]||[]).filter(x=>x.id!==session.id);
   persist();
   render();
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
 app.querySelectorAll<HTMLElement>('[data-export]').forEach(b=>b.onclick=()=>{const blob=new Blob([JSON.stringify({app:'Evergreen Faculty Dashboard',version:2,data},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='faculty-database-backup.json';a.click();URL.revokeObjectURL(a.href)});
 app.querySelector('[data-restore]')?.addEventListener('click',()=>app.querySelector<HTMLInputElement>('#restore-file')!.click());
 app.querySelector<HTMLInputElement>('#restore-file')?.addEventListener('change',async e=>{try{const parsed=JSON.parse(await (e.target as HTMLInputElement).files![0].text());const next=parsed.data||parsed;if(!Array.isArray(next.classes)||!next.attendance)throw Error();if(confirm('Restore will replace all current classes, students, payments, and attendance. Continue?')){data={...blank,...next};persist();go('dashboard');toast('Database restored.')}}catch{toast('Invalid backup file.')}});
 app.querySelector('[data-save-profile]')?.addEventListener('click',()=>{data.profile={name:app.querySelector<HTMLInputElement>('#profile-name')!.value,school:app.querySelector<HTMLInputElement>('#profile-school')!.value};persist();toast('Profile saved.')});
 app.querySelector('[data-save-timetable]')?.addEventListener('click',()=>{data.timetable=Array.from(app.querySelectorAll<HTMLInputElement>('[data-timetable]')).map(x=>x.dataset.timetable+'|'+x.value);persist();toast('Time table saved.')});
 app.querySelectorAll<HTMLElement>('[data-student-action]').forEach(b=>b.onclick=()=>toast(b.dataset.studentAction==='call'?'':b.dataset.studentAction==='marks'?'Marks module is ready for entries.':b.dataset.studentAction==='report'?'Use Class Reports to generate attendance records.':'Student record stored locally.'));
}
function renderFinancialKeep(){active='financial';render()}
window.addEventListener('hashchange',()=>{active=location.hash.slice(1)||'dashboard';render()});
render();
