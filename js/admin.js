import { db, auth } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, setDoc, getDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { checkTeacherConflict } from './horario.js';
import { calculateTimeSlots, compressImageToBase64, getCurrentLocation } from './utils.js';

let schoolId = "";
window.tempVinculos = []; 
let subjectMap = {}; 
let allGrades = []; 
let gradeMap = {}; 
let teacherMap = {}; 
let globalSchoolName = "";
let monitorMode = "now";

// --- INICIALIZAÇÃO SaaS ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        const schoolSnap = await getDoc(doc(db, "schools", user.uid));
        if (!schoolSnap.exists()) {
            console.warn("Acesso negado: usuário não é administrador.");
            await signOut(auth);
            window.location.assign('login.html');
            return;
        }

        schoolId = user.uid;
        initNavigation();
        initFinanceTabs();
        await loadSchoolInfo(); 
        await loadAllData(); 
        startLiveMonitor();
        document.getElementById('freqDate').valueAsDate = new Date();
        document.querySelectorAll('.currentYear').forEach(el => el.textContent = new Date().getFullYear());
    } else {
        window.location.assign('login.html');
    }
});

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.onclick = () => {
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            document.querySelectorAll('.admin-section').forEach(s => s.classList.add('hidden'));
            item.classList.add('active');
            const target = document.getElementById(item.dataset.section);
            if(target) target.classList.remove('hidden');
            if(item.dataset.section === 'sec-freq') loadAttendance();
        };
    });
    document.getElementById('btnLogout').onclick = () => signOut(auth);
    
    const checkMon = document.getElementById('checkMonitor');
    if(checkMon) {
        checkMon.onchange = (e) => {
            monitorMode = e.target.checked ? "next" : "now";
            document.getElementById('txtToggle').textContent = e.target.checked ? "Próximas Aulas" : "Aulas de Agora";
            updateLiveMonitor();
        };
    }

    document.getElementById('btnCaptureLocation').onclick = async () => {
        try {
            const loc = await getCurrentLocation();
            document.getElementById('schoolLat').value = loc.lat;
            document.getElementById('schoolLng').value = loc.lng;
            alert("📍 Localização capturada! Salve os dados da instituição para confirmar.");
        } catch (e) { alert(e.message); }
    };

    document.getElementById('freqDate').onchange = () => loadAttendance();
    document.getElementById('freqGradeFilter').onchange = () => loadAttendance();
}

function initFinanceTabs() {
    const btnConsol = document.getElementById('tabBtnConsolidado');
    const btnIndiv = document.getElementById('tabBtnIndividual');
    const wrapConsol = document.getElementById('financeConsolidadoWrapper');
    const wrapIndiv = document.getElementById('financeIndividualWrapper');

    btnConsol.onclick = () => {
        btnConsol.classList.add('active'); btnIndiv.classList.remove('active');
        wrapConsol.classList.remove('hidden'); wrapIndiv.classList.add('hidden');
    };
    btnIndiv.onclick = () => {
        btnIndiv.classList.add('active'); btnConsol.classList.remove('active');
        wrapIndiv.classList.remove('hidden'); wrapConsol.classList.add('hidden');
    };
}

// --- MONITOR EM TEMPO REAL ---
function startLiveMonitor() { 
    updateLiveMonitor(); 
    setInterval(updateLiveMonitor, 600000); 

    const btnRefresh = document.getElementById('btnRefreshMonitor');
    if (btnRefresh) {
        btnRefresh.onclick = () => {
            const icon = document.getElementById('iconRefresh');
            icon.style.display = "inline-block";
            icon.style.transition = "transform 0.5s ease";
            icon.style.transform = "rotate(360deg)";
            
            updateLiveMonitor().then(() => {
                setTimeout(() => { icon.style.transform = "rotate(0deg)"; }, 500);
            });
        };
    }
}

async function updateLiveMonitor() {
    const container = document.getElementById('liveMonitorContainer');
    if (!container) return;
    const now = new Date();
    const daysWeek = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const today = daysWeek[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();

    if(now.getDay() === 0 || now.getDay() === 6) {
        container.innerHTML = "<p style='color:#94a3b8'>Fim de semana.</p>";
        return;
    }

    try {
        const qSched = query(collection(db, "schedules"), where("schoolId", "==", schoolId));
        const schedSnap = await getDocs(qSched);
        const schedules = schedSnap.docs.map(d => d.data()).filter(s => s.day === today);

        let html = "";
        allGrades.forEach(grade => {
            const [h, m] = grade.startTime.split(':').map(Number);
            let startMins = h * 60 + m;
            let activeP = -1;
            for (let i = 1; i <= 7; i++) {
                let pS = startMins + (i - 1) * grade.lessonDuration;
                if (i > grade.intervalAfter) pS += grade.intervalDuration;
                let pE = pS + grade.lessonDuration;
                if (currentMins >= pS && currentMins < pE) { 
                    activeP = (monitorMode === "now") ? i : i + 1; 
                    break; 
                }
                else if (monitorMode === "next" && currentMins < pS) { 
                    activeP = i; 
                    break; 
                }
            }
            const aula = schedules.find(s => s.gradeId === grade.id && s.period === activeP);
            
            html += `
            <div class="monitor-card" style="border-left: 4px solid ${aula ? '#6366f1' : '#e2e8f0'}">
                <span class="m-grade">${grade.name}</span>
                <span class="m-sub">${aula ? (subjectMap[aula.subjectId]?.name || "Aula") : "Livre"}</span>
                <span class="m-prof">${aula ? teacherMap[aula.teacherId]?.name : "-"}</span>
                ${aula ? `<button onclick="window.prepareQuickSub('${today}', ${activeP}, '${grade.id}')" style="margin-top:8px; font-size:0.6rem; background:#fee2e2; color:#ef4444; border:1px solid #fecaca; padding:4px; border-radius:4px; cursor:pointer; font-weight:700">⚠️ SUBSTITUIR</button>` : ''}
            </div>`;
        });
        container.innerHTML = html;
    } catch (error) { console.error("Erro ao carregar monitor:", error); }
}

// --- LOGICA DE SUBSTITUIÇÃO ---
window.prepareQuickSub = (day, period, gradeId) => {
    document.querySelector('[data-section="sec-subs"]').click();
    document.getElementById('subDaySearch').value = day;
    document.getElementById('subPeriodSearch').value = period;
    document.getElementById('subGradeSearch').value = gradeId;
    document.getElementById('btnFindSubstitutes').click();
};

document.getElementById('btnFindSubstitutes').onclick = async () => {
    const day = document.getElementById('subDaySearch').value;
    const period = parseInt(document.getElementById('subPeriodSearch').value);
    const gradeId = document.getElementById('subGradeSearch').value;
    const list = document.getElementById('listAvailableTeachers');
    
    if(!gradeId) return alert("Selecione a turma que precisa de substituição.");
    
    list.innerHTML = "<li>🔍 Analisando Janelas e Folgas...</li>";
    
    const teachers = Object.values(teacherMap);
    const sSnap = await getDocs(query(collection(db, "schedules"), where("schoolId", "==", schoolId)));
    const busyIds = sSnap.docs.map(d => d.data()).filter(s => s.day === day && s.period === period).map(s => s.teacherId);
    
    const available = teachers.filter(p => !busyIds.includes(p.id) && !p.restricoes?.includes(day));
    
    list.innerHTML = available.length === 0 ? "<li>Ninguém livre neste horário.</li>" : "";
    
    available.forEach(p => {
        list.innerHTML += `
        <li>
            <div><strong>${p.name}</strong> <br> <small style="color:#10b981">Disponível agora</small></div> 
            <button class="btn-edit" style="background:#6366f1; color:white" onclick="window.efetivarSubstituicao('${p.id}', '${gradeId}', ${period})">Confirmar Substituto</button>
        </li>`;
    });
};

window.efetivarSubstituicao = async (tId, gId, period) => {
    if(!confirm("Deseja confirmar este professor como substituto? A aula será creditada a ele no financeiro.")) return;
    
    const date = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    await addDoc(collection(db, "attendance"), { 
        schoolId, date, gradeId: gId, period: period, teacherId: tId, 
        time: nowTime + " (Subst.)", manual: true, isSubstitution: true, timestamp: new Date().toISOString() 
    });
    
    alert("✅ Substituição registrada com sucesso!");
    document.querySelector('[data-section="sec-dash"]').click();
};

// --- CONTROLE DE FREQUÊNCIA ---
async function loadAttendance() {
    const list = document.getElementById('listAttendance');
    const date = document.getElementById('freqDate').value;
    const gradeFilter = document.getElementById('freqGradeFilter').value;
    list.innerHTML = "<li>Carregando frequência...</li>";

    const qFreq = query(collection(db, "attendance"), where("schoolId", "==", schoolId));
    const snapFreq = await getDocs(qFreq);
    const checkedIn = {}; 
    snapFreq.docs.map(d => d.data()).filter(a => a.date === date).forEach(f => checkedIn[`${f.gradeId}-${f.period}`] = f);

    const daysWeek = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const dayName = daysWeek[new Date(date + "T00:00").getDay()];
    
    const qSched = query(collection(db, "schedules"), where("schoolId", "==", schoolId));
    const schedSnap = await getDocs(qSched);
    const todaySchedules = schedSnap.docs.map(d => d.data()).filter(s => s.day === dayName);

    list.innerHTML = "";
    todaySchedules.forEach(s => {
        if(gradeFilter && s.gradeId !== gradeFilter) return;
        const grade = gradeMap[s.gradeId];
        const log = checkedIn[`${s.gradeId}-${s.period}`];
        
        let statusColor = log ? (log.manual ? "#f59e0b" : "#10b981") : "#ef4444";
        let statusText = log ? (log.manual ? "Confirmado Manual" : `Iniciado às ${log.time}`) : "Pendente / Falta";
        let subInfo = "";

        if (log && log.isSubstitution) {
            statusColor = "#6366f1"; 
            const titular = teacherMap[s.teacherId]?.name || "Titular";
            const substituto = teacherMap[log.teacherId]?.name || "Substituto";
            subInfo = `
                <div style="margin-top:5px; background:#eef2ff; border:1px solid #c7d2fe; padding:6px; border-radius:8px; font-size:0.75rem;">
                    <span style="color:#4338ca; font-weight:800;">🔄 SUBSTITUIÇÃO:</span> 
                    <strong>${substituto}</strong> cobriu <strong>${titular}</strong>
                </div>
            `;
            statusText = "Aula Substituída";
        }

        const li = document.createElement('li');
        li.style.flexDirection = "column"; li.style.alignItems = "flex-start";
        li.innerHTML = `
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                <div style="flex:1">
                    <span style="font-size:0.6rem; color:#94a3b8">${grade?.name || "Turma"} - ${s.period}º Horário</span><br>
                    <strong>${teacherMap[s.teacherId]?.name}</strong> - <small style="color:${statusColor}">${statusText}</small>
                </div>
                ${!log ? `<button class="btn-edit" style="background:#10b981; color:white" onclick="window.confirmManual('${s.gradeId}', '${s.period}', '${s.teacherId}')">Confirmar Presença</button>` : ''}
            </div>
            ${subInfo}
        `;
        list.appendChild(li);
    });
}

window.confirmManual = async (gId, period, tId) => {
    if(!confirm("Confirmar presença manual?")) return;
    const date = document.getElementById('freqDate').value;
    await addDoc(collection(db, "attendance"), { schoolId, date, gradeId: gId, period: parseInt(period), teacherId: tId, time: "Manual", manual: true, timestamp: new Date().toISOString() });
    loadAttendance();
};

// --- CRUD TURMAS & MATÉRIAS & PROFESSORES ---
document.getElementById('btnSaveConfig').onclick = async () => { 
    const gradeName = document.getElementById('gradeName').value;
    const editId = document.getElementById('editGradeId').value;
    if(!gradeName) return alert("Preencha o nome!");
    let logo = editId ? (gradeMap[editId]?.logoUrl || "") : "";
    if (document.getElementById('schoolLogoInput').files[0]) logo = await compressImageToBase64(document.getElementById('schoolLogoInput').files[0]);
    const payload = { name: gradeName, courseName: document.getElementById('courseName').value || "Padrão", startTime: document.getElementById('startTime').value, lessonDuration: parseInt(document.getElementById('lessonDuration').value), intervalAfter: parseInt(document.getElementById('intervalAfter').value), intervalDuration: parseInt(document.getElementById('intervalDuration').value), logoUrl: logo, schoolId };
    if(editId) await setDoc(doc(db, "grades", editId), payload);
    else await addDoc(collection(db, "grades"), payload);
    location.reload();
};

window.prepareEditGrade = (id) => {
    const g = gradeMap[id];
    document.getElementById('editGradeId').value = id;
    document.getElementById('gradeName').value = g.name; document.getElementById('courseName').value = g.courseName;
    document.getElementById('startTime').value = g.startTime; document.getElementById('lessonDuration').value = g.lessonDuration;
    document.getElementById('intervalAfter').value = g.intervalAfter; document.getElementById('intervalDuration').value = g.intervalDuration;
    if(g.logoUrl) { const img = document.getElementById('imgPreview'); img.src = g.logoUrl; img.style.display = "block"; }
    document.querySelector('[data-section="sec-config"]').click();
};

document.getElementById('btnSaveSubject').onclick = async () => {
    const editId = document.getElementById('editSubjectId').value;
    const payload = { name: document.getElementById('subjectName').value, sigla: document.getElementById('subjectSigla').value.toUpperCase(), color: document.getElementById('subjectColor').value, schoolId };
    if(editId) await setDoc(doc(db, "subjects", editId), payload); else await addDoc(collection(db, "subjects"), payload);
    location.reload();
};

window.prepareEditSubject = async (id) => {
    const d = await getDoc(doc(db, "subjects", id)); const s = d.data();
    document.getElementById('editSubjectId').value = id; document.getElementById('subjectName').value = s.name;
    document.getElementById('subjectSigla').value = s.sigla; document.getElementById('subjectColor').value = s.color;
    document.querySelector('[data-section="sec-cadastros"]').click();
};

window.editProfessor = async (id) => {
    try {
        const p = teacherMap[id]; if (!p) return;
        document.getElementById('editProfId').value = id;
        document.getElementById('profName').value = p.name; document.getElementById('profEmail').value = p.email;
        document.querySelectorAll('.dia-folga').forEach(cb => { cb.checked = p.restricoes ? p.restricoes.includes(cb.value) : false; });
        window.tempVinculos = p.vinculos ? [...p.vinculos] : []; renderTemp();
        document.querySelector('[data-section="sec-professores"]').click();
    } catch (e) { console.error(e); }
};

document.getElementById('btnAddVinculo').onclick = () => {
    const s = document.getElementById('vinculoSubject'); const g = document.getElementById('vinculoGrade');
    if(!s.value || !g.value) return alert("Selecione!");
    window.tempVinculos.push({ subId: s.value, subName: s.options[s.selectedIndex].text, grdId: g.value, grdName: g.options[g.selectedIndex].text });
    renderTemp();
};

function renderTemp() {
    const l = document.getElementById('tempVinculosList'); l.innerHTML = "";
    window.tempVinculos.forEach((v, i) => l.innerHTML += `<li>${v.subName} na ${v.grdName} <button type="button" onclick="window.removeTemp(${i})" style="color:red; border:none; background:none; cursor:pointer"> (x) </button></li>`);
}
window.removeTemp = (i) => { window.tempVinculos.splice(i, 1); renderTemp(); };

document.getElementById('btnSaveFullProf').onclick = async () => {
    const id = document.getElementById('editProfId').value;
    const rest = []; document.querySelectorAll('.dia-folga:checked').forEach(c => rest.push(c.value));
    const email = document.getElementById('profEmail').value.toLowerCase().trim();
    const password = document.getElementById('profPassword') ? document.getElementById('profPassword').value : "";
    const payload = { name: document.getElementById('profName').value, email, schoolId, vinculos: window.tempVinculos, restricoes: rest };

    if (id) {
        await setDoc(doc(db, "teachers", id), payload); alert("✅ Professor atualizado!");
    } else {
        if (!password || password.length < 6) { alert("⚠️ Defina uma senha (mín. 6 caracteres)."); return; }
        try {
            const { createUserWithEmailAndPassword } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            await createUserWithEmailAndPassword(auth, email, password);
            await addDoc(collection(db, "teachers"), payload);
            alert("✅ Professor cadastrado!");
        } catch(e) {
            if (e.code === 'auth/email-already-in-use') {
                await addDoc(collection(db, "teachers"), payload); alert("✅ Salvo (email já no Auth)!");
            } else { alert("Erro: " + e.message); return; }
        }
    }
    location.reload();
};

window.redefinirSenha = async (email, name) => {
    const novaSenha = prompt(`Digite a nova senha para ${name} (${email}):\n(mínimo 6 caracteres)`);
    if (!novaSenha) return; if (novaSenha.length < 6) return alert("Mínimo 6 caracteres!");
    try {
        const { sendPasswordResetEmail } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        await sendPasswordResetEmail(auth, email); alert("✅ Email de redefinição enviado!");
    } catch(e) { alert("Erro: " + e.message); }
};

// --- CARREGAMENTO GERAL ---
async function loadSchoolInfo() {
    const docSnap = await getDoc(doc(db, "schools", schoolId));
    if (docSnap.exists()) {
        const d = docSnap.data(); globalSchoolName = d.schoolName || "SGH Pro";
        document.getElementById('inputSchoolName').value = globalSchoolName;
        document.getElementById('viewSchoolNameAdmin').textContent = globalSchoolName;
        document.getElementById('schoolLat').value = d.latitude || ""; document.getElementById('schoolLng').value = d.longitude || "";
    }
}

document.getElementById('btnSaveSchoolName').onclick = async () => {
    await setDoc(doc(db, "schools", schoolId), { schoolName: document.getElementById('inputSchoolName').value, latitude: parseFloat(document.getElementById('schoolLat').value) || 0, longitude: parseFloat(document.getElementById('schoolLng').value) || 0 }, { merge: true });
    alert("Salvo!"); loadSchoolInfo();
};

async function loadAllData() {
    const qS = query(collection(db, "schedules"), where("schoolId", "==", schoolId));
    const sSnap = await getDocs(qS); const workload = {}; const allSchedules = [];
    sSnap.forEach(d => { const data = d.data(); allSchedules.push(data); workload[data.teacherId] = (workload[data.teacherId] || 0) + 1; });
    
    const cols = ['subjects', 'grades', 'teachers'];
    let tC = []; let gC = [];
    subjectMap = {}; gradeMap = {}; teacherMap = {}; 

    for (const col of cols) {
        const snap = await getDocs(query(collection(db, col), where("schoolId", "==", schoolId)));
        if(document.getElementById(`stat-${col}`)) document.getElementById(`stat-${col}`).textContent = snap.size;
        let dataArray = snap.docs.map(d => ({id: d.id, ...d.data()}));
        
        if (col === 'subjects') {
            dataArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
            dataArray.forEach(d => subjectMap[d.id] = d);
        }
        else if (col === 'grades') { 
            dataArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })); 
            allGrades = dataArray; gC = dataArray; 
            dataArray.forEach(d => gradeMap[d.id] = d);
            
            const uniqueCourses = [...new Set(dataArray.map(g => g.courseName))].filter(Boolean);
            const ratesContainer = document.getElementById('ratesContainer');
            if (ratesContainer) {
                ratesContainer.innerHTML = '';
                if (uniqueCourses.length === 0) {
                    ratesContainer.innerHTML = `<div class="input-group" style="margin: 0; width: 140px;"><label>Valor H/A (R$)</label><input type="number" class="course-rate-input" data-course="Padrão" value="20" step="0.5"></div>`;
                } else {
                    uniqueCourses.forEach(course => {
                        ratesContainer.innerHTML += `<div class="input-group" style="margin: 0; width: 160px;"><label>Vlr. ${course} (R$)</label><input type="number" class="course-rate-input" data-course="${course}" value="20" step="0.5"></div>`;
                    });
                }
            }

            ['freqGradeFilter', 'subGradeSearch'].forEach(id => {
                const el = document.getElementById(id);
                if(el) { el.innerHTML = '<option value="">Selecione...</option>'; dataArray.forEach(g => el.innerHTML += `<option value="${g.id}">${g.name}</option>`); }
            });
        }
        else if (col === 'teachers') { 
            dataArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); 
            tC = dataArray; 
            dataArray.forEach(d => teacherMap[d.id] = d);
            const selFin = document.getElementById('financeTeacherSelect');
            if(selFin) {
                selFin.innerHTML = '<option value="">Selecione o Professor</option>';
                dataArray.forEach(t => selFin.innerHTML += `<option value="${t.id}">${t.name}</option>`);
            }
        }
        
        const list = document.getElementById(col === 'subjects' ? 'listSubjects' : (col === 'grades' ? 'listGrades' : 'listProfessors'));
        if(list) {
            list.innerHTML = "";
            dataArray.forEach(data => {
                let htmlItem = `<li><div>`;
                if(col === 'subjects') htmlItem += `<span class='subject-color-tag' style='background:${data.color}'></span>${data.name}`;
                else if(col === 'grades') htmlItem += `<strong>${data.name}</strong> (${data.courseName || 'Padrão'})`;
                else if(col === 'teachers') {
                    const mats = data.vinculos ? data.vinculos.map(v => v.subName).join(', ') : '-';
                    htmlItem += `<strong>${data.name}</strong> <span style="font-size:0.7rem; background:#e0e7ff; padding:2px 6px; border-radius:4px; margin-left:8px">${workload[data.id] || 0} aulas</span><br><small>${mats}</small>`;
                }
                
                if (col === 'teachers') {
                    htmlItem += `</div><div style="display:flex; gap:5px; flex-wrap:wrap;">
                        <button class="btn-edit" onclick="window.prepareEditProfessor('${data.id}')">Editar</button>
                        <button style="background:#dcfce7; color:#16a34a; border:none; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem; font-weight:700;" onclick="window.redefinirSenha('${data.email}', '${data.name}')">🔑 Senha</button>
                        <button class="btn-delete" onclick="window.del('${col}', '${data.id}')">Excluir</button>
                    </div></li>`;
                } else {
                    htmlItem += `</div><div><button class="btn-edit" onclick="window.prepareEdit${col === 'subjects' ? 'Subject' : 'Grade'}('${data.id}')">Editar</button><button class="btn-delete" onclick="window.del('${col}', '${data.id}')">Excluir</button></div></li>`;
                }
                list.innerHTML += htmlItem;
            });
        }
        if(col === 'subjects') { const s = document.getElementById('vinculoSubject'); if(s) { s.innerHTML = '<option value="">Matéria</option>'; dataArray.forEach(data => s.innerHTML += `<option value="${data.id}">${data.name}</option>`); } }
        if(col === 'grades') {
            const sV = document.getElementById('vinculoGrade'); const sG = document.getElementById('selectGrade');
            if(sV) { sV.innerHTML = '<option value="">Turma</option>'; dataArray.forEach(g => sV.innerHTML += `<option value="${g.id}">${g.name}</option>`); }
            if(sG) { sG.innerHTML = '<option value="">Escolha a Turma...</option>'; dataArray.forEach(g => sG.innerHTML += `<option value="${g.id}">${g.name}</option>`); }
        }
    }
    processDashboardInt(tC, gC, allSchedules, workload);
}

function processDashboardInt(teachers, grades, schedules, workload) {
    const alertT = document.getElementById('alert-teachers'); const alertG = document.getElementById('alert-grades'); const chart = document.getElementById('workloadChart');
    if(!alertT || !alertG || !chart) return;
    const noClassProfs = teachers.filter(p => (workload[p.id] || 0) === 0).length;
    alertT.textContent = noClassProfs > 0 ? `⚠️ ${noClassProfs} profs sem aulas.` : "";
    const incompleteGrades = grades.filter(g => schedules.filter(s => s.gradeId === g.id).length < 35).length;
    alertG.textContent = incompleteGrades > 0 ? `⚠️ ${incompleteGrades} turmas incompletas.` : "";
    chart.innerHTML = "";
    teachers.forEach(p => {
        const aulas = workload[p.id] || 0; const pct = (aulas / 35) * 100;
        chart.innerHTML += `<div class="chart-bar-col"><div class="chart-bar-fill" style="height:${pct}%" data-val="${aulas}"></div><span class="chart-label">${p.name.split(' ')[0]}</span></div>`;
    });
}

// --- GERADOR DE HORÁRIO E PDF DA GRADE (ADMIN) ---
document.getElementById('selectGrade').onchange = (e) => { if(e.target.value) renderTimetable(e.target.value); };

async function renderTimetable(gradeId) {
    const grade = gradeMap[gradeId];
    const container = document.getElementById('timetableContainer');
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const timesLabels = calculateTimeSlots(grade.startTime, grade.lessonDuration, 7, grade.intervalAfter, grade.intervalDuration);
    
    const teacherArray = Object.values(teacherMap).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const filteredOptions = []; 
    teacherArray.forEach(p => {
        p.vinculos?.forEach(v => {
            if(v.grdId === gradeId) filteredOptions.push({ value: `${p.id}|${v.subId}`, label: `${p.name} - ${subjectMap[v.subId]?.sigla || ""}`, teacherId: p.id });
        });
    });

    const qSaved = query(collection(db, "schedules"), where("gradeId", "==", gradeId));
    const savedSnap = await getDocs(qSaved); const savedData = {}; 
    savedSnap.forEach(d => { const s = d.data(); savedData[`${s.day}-${s.period}`] = `${s.teacherId}|${s.subjectId}`; });

    let html = `<table><thead><tr><th>Horário</th><th>SEG</th><th>TER</th><th>QUA</th><th>QUI</th><th>SEX</th></tr></thead><tbody>`;
    for(let i=1; i<=7; i++) {
        html += `<tr><td class="time-column">${timesLabels[i-1] || '--:--'}</td>${days.map(d => {
            const curVal = savedData[`${d}-${i}`] || "";
            return `<td><select class="schedule-select" data-day="${d}" data-period="${i}">
                <option value="">Livre</option>
                ${filteredOptions.map(o => `<option value="${o.value}" ${curVal === o.value ? 'selected' : ''}>${o.label}</option>`).join('')}
            </select></td>`;
        }).join('')}</tr>`;
        if(i === grade.intervalAfter) html += `<tr class="intervalo-row"><td colspan="6">INTERVALO</td></tr>`;
    }
    html += `</tbody></table>`;
    container.innerHTML = html;

    document.querySelectorAll('.schedule-select').forEach(s => {
        s.onchange = async (e) => {
            const val = e.target.value; if(!val) return;
            const [tId, sId] = val.split('|'); const day = e.target.dataset.day;
            const countDia = Array.from(document.querySelectorAll(`.schedule-select[data-day="${day}"]`)).filter(sel => sel.value.startsWith(tId)).length;
            if(countDia > 2) alert("🚫 Sugestão: Limite de 2 aulas/dia.");
            if(teacherMap[tId].restricoes?.includes(day)) { alert(`Folga de ${teacherMap[tId].name}`); e.target.value = ""; return; }
            if(await checkTeacherConflict(tId, day, e.target.dataset.period, gradeId, schoolId)) { alert("⚠️ CONFLITO!"); e.target.value = ""; }
        };
    });
}

document.getElementById('btnSaveFullSchedule').onclick = async () => {
    const gradeId = document.getElementById('selectGrade').value; if(!gradeId) return;
    const selects = document.querySelectorAll('.schedule-select');
    const snap = await getDocs(query(collection(db, "schedules"), where("gradeId", "==", gradeId)));
    for(const d of snap.docs) await deleteDoc(d.ref);
    for(const s of selects) {
        if(s.value) {
            const [tId, sId] = s.value.split('|');
            await addDoc(collection(db, "schedules"), { schoolId, gradeId: gradeId, teacherId: tId, subjectId: sId, day: s.dataset.day, period: parseInt(s.dataset.period) });
        }
    }
    alert("✅ Grade salva!"); loadAllData();
};

document.getElementById('btnCopyPublicLink').onclick = () => {
    const gid = document.getElementById('selectGrade').value; 
    if(!gid) return alert("Selecione uma turma primeiro!");
    const link = `${window.location.origin}${window.location.pathname.replace('admin.html', 'turma.html')}?s=${schoolId}&g=${gid}`;
    navigator.clipboard.writeText(link); 
    alert("🔗 Link da turma copiado com sucesso!");
};

// 🟢 CORREÇÃO: Lógica original restaurada para PDF perfeito e colorido em MODO PAISAGEM
document.getElementById('btnExportPdfAdmin').onclick = async () => {
    const gid = document.getElementById('selectGrade').value; 
    if(!gid) return alert("Selecione uma turma primeiro!");
    
    const grade = gradeMap[gid];
    const container = document.getElementById('timetableContainer');
    const header = document.getElementById('headerGradeAdmin');
    
    document.getElementById('viewGradeAdmin').textContent = grade.name;
    document.getElementById('viewCourseAdmin').textContent = grade.courseName || "Padrão";
    document.getElementById('schoolLogoPrint').src = grade.logoUrl || "";
    
    const tableClone = container.querySelector('table').cloneNode(true);
    const selects = container.querySelectorAll('select');
    
    let selIdx = 0;
    tableClone.querySelectorAll('tr').forEach((tr) => {
        if(tr.classList.contains('intervalo-row')) return;
        tr.querySelectorAll('td').forEach((td, colIdx) => {
            if(colIdx === 0) return;
            const val = selects[selIdx].value; 
            td.innerHTML = "";
            if(val) {
                const [tId, sId] = val.split('|');
                const sub = subjectMap[sId];
                td.innerHTML = `<div style="background:${sub?.color || '#6366f1'}; color:white; font-weight:700; border-radius:6px; height:26px; display:flex; align-items:center; justify-content:center; text-align:center; padding:2px; font-size:0.55rem; white-space: nowrap; overflow: hidden;">${sub?.name || 'Aula'}</div>`;
            } else {
                td.innerHTML = `<div style="background:#f8fafc; border-radius:8px; border: 1px dashed #e2e8f0; height:26px;"></div>`;
            }
            selIdx++;
        });
    });
    
    tableClone.querySelectorAll('.time-column').forEach(el => { 
        el.style.height = "26px"; 
        el.style.fontSize = "0.55rem"; 
        el.style.width = "85px"; 
    });
    
    const pw = document.createElement('div'); 
    pw.style.padding = "10px"; 
    pw.style.backgroundColor = "white";
    
    const clonedHeader = header.cloneNode(true); 
    clonedHeader.style.display = "block";
    
    pw.appendChild(clonedHeader);
    pw.appendChild(tableClone);
    
    const foot = document.createElement('div');
    foot.innerHTML = `<p style="text-align:center; font-size:0.45rem; color:#94a3b8; margin-top:2px; border-top:1px solid #eee; padding-top:1px">Direitos reservados a Jerry Gleydison &copy; ${new Date().getFullYear()}</p>`;
    pw.appendChild(foot);
    
    html2pdf().set({ 
        margin: [10, 10, 10, 10], 
        filename: `Horario_${grade.name}.pdf`, 
        image: { type: 'jpeg', quality: 1 }, 
        html2canvas: { scale: 3, backgroundColor: '#ffffff', useCORS: true }, 
        jsPDF: { unit: 'mm', format: [210, 147.5], orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] }
    }).from(pw).save();
};

window.del = async (c, i) => { 
    if(confirm("Tem certeza que deseja excluir?")) { 
        await deleteDoc(doc(db, c, i)); 
        loadAllData(); 
    }
};

window.prepareEditProfessor = (id) => window.editProfessor(id);


// ============================================================================
// --- FINANCEIRO INTELIGENTE: RELATÓRIO CONSOLIDADO (GERAL) ---
// ============================================================================
document.getElementById('btnGenerateFinanceReport').onclick = async () => {
    const monthVal = document.getElementById('financeMonth').value;
    if (!monthVal) return alert("⚠️ Por favor, selecione um mês!");

    const rates = {};
    let hasInvalidRate = false;
    document.querySelectorAll('.course-rate-input').forEach(input => {
        const val = parseFloat(input.value);
        if(isNaN(val) || val <= 0) hasInvalidRate = true;
        rates[input.dataset.course] = val;
    });

    if (hasInvalidRate) return alert("⚠️ Informe valores válidos para TODAS as taxas dos Cursos!");
    
    const container = document.getElementById('financeResultContainer');
    container.innerHTML = "<p style='text-align:center;'>Calculando dados e cruzando substituições na memória...</p>";

    const [year, month] = monthVal.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dayCounts = { "Domingo": 0, "Segunda": 0, "Terça": 0, "Quarta": 0, "Quinta": 0, "Sexta": 0, "Sábado": 0 };
    const daysWeek = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    
    for (let i = 1; i <= daysInMonth; i++) dayCounts[daysWeek[new Date(year, month - 1, i).getDay()]]++;

    const teachersData = {};
    Object.values(teacherMap).forEach(t => { 
        teachersData[t.id] = { name: t.name, previstas: 0, dadas: 0, substituido: 0, totalGanho: 0, totalDesconto: 0 }; 
    });

    const schedMap = {};
    const sSnap = await getDocs(query(collection(db, "schedules"), where("schoolId", "==", schoolId)));
    const allSchedules = sSnap.docs.map(d => d.data());
    
    allSchedules.forEach(s => {
        schedMap[`${s.gradeId}-${s.day}-${s.period}`] = s.teacherId;
        if (teachersData[s.teacherId] && dayCounts[s.day]) {
            teachersData[s.teacherId].previstas += dayCounts[s.day];
        }
    });

    const attSnap = await getDocs(query(collection(db, "attendance"), where("schoolId", "==", schoolId)));
    const allAtt = attSnap.docs.map(d => d.data()).filter(a => a.date && a.date.startsWith(monthVal));

    allAtt.forEach(att => {
        const courseName = gradeMap[att.gradeId]?.courseName || "Padrão";
        const rate = rates[courseName] || 0;

        if (teachersData[att.teacherId]) {
            teachersData[att.teacherId].dadas++;
            teachersData[att.teacherId].totalGanho += rate;
        }
        if (att.isSubstitution) {
            const [y, m, dayOfMonth] = att.date.split('-').map(Number);
            const dateObj = new Date(y, m - 1, dayOfMonth);
            const dayName = daysWeek[dateObj.getDay()];
            const titularId = schedMap[`${att.gradeId}-${dayName}-${att.period}`];
            
            if (titularId && titularId !== att.teacherId && teachersData[titularId]) {
                teachersData[titularId].substituido++;
                teachersData[titularId].totalDesconto += rate;
            }
        }
    });

    let html = `<table style="width:100%; border-collapse: collapse; margin-top: 15px; font-size: 0.85rem;">
        <thead>
            <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                <th style="padding: 12px; text-align: left;">Professor</th>
                <th style="padding: 12px; text-align: center;">Previstas</th>
                <th style="padding: 12px; text-align: center;">Dadas</th>
                <th style="padding: 12px; text-align: center;">Faltas</th>
                <th style="padding: 12px; text-align: center;">Subst.</th>
                <th style="padding: 12px; text-align: center;">% Freq.</th>
                <th style="padding: 12px; text-align: right;">Desconto (-)</th>
                <th style="padding: 12px; text-align: right;">A Receber</th>
            </tr>
        </thead><tbody>`;
    
    let totalGeralPagar = 0;
    Object.values(teachersData).sort((a,b) => a.name.localeCompare(b.name)).forEach(p => {
        if (p.previstas > 0 || p.dadas > 0) {
            const faltas = Math.max(0, p.previstas - p.dadas);
            const pct = p.previstas > 0 ? ((p.dadas / p.previstas) * 100).toFixed(1) : 100;
            totalGeralPagar += p.totalGanho;
            
            let pctColor = pct >= 90 ? '#10b981' : (pct >= 70 ? '#f59e0b' : '#ef4444');

            html += `<tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px;">${p.name}</td>
                <td style="padding: 10px; text-align: center;">${p.previstas}</td>
                <td style="padding: 10px; text-align: center; font-weight: bold;">${p.dadas}</td>
                <td style="padding: 10px; text-align: center; color: #ef4444;">${faltas}</td>
                <td style="padding: 10px; text-align: center; color: #f97316; font-weight: bold;">${p.substituido}</td>
                <td style="padding: 10px; text-align: center; color: ${pctColor}; font-weight: bold;">${pct}%</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; color: #ef4444;">- R$ ${p.totalDesconto.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; color: #10b981;">R$ ${p.totalGanho.toFixed(2).replace('.', ',')}</td>
            </tr>`;
        }
    });

    html += `</tbody><tfoot><tr style="background: #e0e7ff; font-weight: 800;"><td colspan="7" style="padding: 12px; text-align: right;">TOTAL DA FOLHA:</td><td style="padding: 12px; text-align: right; color: #4f46e5;">R$ ${totalGeralPagar.toFixed(2).replace('.', ',')}</td></tr></tfoot></table>`;
    
    container.innerHTML = html;
    document.getElementById('headerFinancePrint').style.display = 'block';
    document.getElementById('finSchoolNamePrint').textContent = globalSchoolName;
    document.getElementById('finMonthLabelPrint').textContent = `Referência: ${monthVal.split('-').reverse().join('/')}`;
    document.getElementById('btnExportFinancePDF').classList.remove('hidden');
};


// ============================================================================
// --- FINANCEIRO INTELIGENTE 2: RELATÓRIO INDIVIDUAL COM DETALHAMENTO ---
// ============================================================================
let globalIndData = {};

document.getElementById('btnGenerateIndividualReport').onclick = async () => {
    const profId = document.getElementById('financeTeacherSelect').value;
    const monthVal = document.getElementById('financeMonth').value;

    if (!profId || !monthVal) return alert("⚠️ Selecione o professor e o mês!");

    const rates = {};
    let hasInvalidRate = false;
    document.querySelectorAll('.course-rate-input').forEach(input => {
        const val = parseFloat(input.value);
        if(isNaN(val) || val <= 0) hasInvalidRate = true;
        rates[input.dataset.course] = val;
    });

    if (hasInvalidRate) return alert("⚠️ Informe valores válidos para TODAS as taxas dos Cursos!");

    const professor = teacherMap[profId];
    document.getElementById('indTableContainer').innerHTML = "<p style='text-align:center;'>Buscando e cruzando frequência diária na memória...</p>";
    document.getElementById('printIndividualFinanceArea').style.display = "block";
    document.getElementById('individualActions').classList.add("hidden");

    document.getElementById('indSchoolName').textContent = globalSchoolName;
    document.getElementById('indProfName').textContent = professor.name;
    document.getElementById('indMonth').textContent = monthVal.split('-').reverse().join('/');

    const [year, month] = monthVal.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysWeek = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

    const sSnap = await getDocs(query(collection(db, "schedules"), where("schoolId", "==", schoolId)));
    const mySchedules = sSnap.docs.map(d => d.data()).filter(s => s.teacherId === profId);

    const attSnap = await getDocs(query(collection(db, "attendance"), where("schoolId", "==", schoolId)));
    const allAtt = attSnap.docs.map(d => d.data()).filter(a => a.date && a.date.startsWith(monthVal));

    let htmlTable = `<table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-bottom: 20px;">
        <thead>
            <tr style="background: #f8fafc; border-bottom: 2px solid #cbd5e1; color: #475569;">
                <th style="padding: 8px; text-align: left;">Data</th>
                <th style="padding: 8px; text-align: left;">Dia</th>
                <th style="padding: 8px; text-align: left;">Turma</th>
                <th style="padding: 8px; text-align: left;">Matéria</th>
                <th style="padding: 8px; text-align: center;">Horário</th>
                <th style="padding: 8px; text-align: center;">Status</th>
            </tr>
        </thead>
        <tbody>`;

    let contPrevistas = 0;
    let contDadas = 0;
    let contFaltas = 0;
    let contSubstituido = 0; 
    let recordsFound = 0;
    let totalFinanceiro = 0;
    let descontoFinanceiro = 0;

    const dadasPorCurso = {};
    const descontosPorCurso = {};

    for (let i = 1; i <= daysInMonth; i++) {
        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
        const dateObj = new Date(year, month - 1, i);
        const dayName = daysWeek[dateObj.getDay()];

        const expectedToday = mySchedules.filter(s => s.day === dayName);
        const substitutionsDoneToday = allAtt.filter(a => a.date === dateStr && a.teacherId === profId && a.isSubstitution);

        expectedToday.forEach(exp => {
            contPrevistas++;
            const tName = gradeMap[exp.gradeId]?.name || "Turma";
            const courseName = gradeMap[exp.gradeId]?.courseName || "Padrão";
            const rate = rates[courseName] || 0;
            const sName = subjectMap[exp.subjectId]?.sigla || "Matéria";
            
            const wasPresent = allAtt.find(a => a.date === dateStr && a.gradeId === exp.gradeId && a.period === exp.period && a.teacherId === profId);
            
            let statusBadge = `<span style="background: #fee2e2; color: #ef4444; padding: 3px 8px; border-radius: 4px; font-weight: 700;">❌ Falta</span>`;
            
            if (wasPresent) {
                contDadas++;
                dadasPorCurso[courseName] = (dadasPorCurso[courseName] || 0) + 1;
                totalFinanceiro += rate;
                statusBadge = `<span style="background: #dcfce7; color: #10b981; padding: 3px 8px; border-radius: 4px; font-weight: 700;">✅ Presente</span>`;
            } else {
                contFaltas++;
                const foiSubstituido = allAtt.find(a => a.date === dateStr && a.gradeId === exp.gradeId && a.period === exp.period && a.isSubstitution);
                if (foiSubstituido && foiSubstituido.teacherId !== profId) {
                    contSubstituido++;
                    descontosPorCurso[courseName] = (descontosPorCurso[courseName] || 0) + 1;
                    descontoFinanceiro += rate;
                    statusBadge = `<span style="background: #ffedd5; color: #ea580c; padding: 3px 8px; border-radius: 4px; font-weight: 700;">⚠️ Coberto por outro</span>`;
                }
            }

            recordsFound++;
            htmlTable += `<tr style="border-bottom: 1px solid #f1f5f9;">
                <td style="padding: 8px;">${String(i).padStart(2, '0')}/${String(month).padStart(2, '0')}</td>
                <td style="padding: 8px;">${dayName}</td>
                <td style="padding: 8px;">${tName} <small style="color:#64748b;">(${courseName})</small></td>
                <td style="padding: 8px;">${sName}</td>
                <td style="padding: 8px; text-align: center;">${exp.period}º</td>
                <td style="padding: 8px; text-align: center;">${statusBadge}</td>
            </tr>`;
        });

        substitutionsDoneToday.forEach(sub => {
            contDadas++;
            const tName = gradeMap[sub.gradeId]?.name || "Turma";
            const courseName = gradeMap[sub.gradeId]?.courseName || "Padrão";
            const rate = rates[courseName] || 0;

            dadasPorCurso[courseName] = (dadasPorCurso[courseName] || 0) + 1;
            totalFinanceiro += rate;

            recordsFound++;
            htmlTable += `<tr style="border-bottom: 1px solid #f1f5f9; background: #eef2ff;">
                <td style="padding: 8px;">${String(i).padStart(2, '0')}/${String(month).padStart(2, '0')}</td>
                <td style="padding: 8px;">${dayName}</td>
                <td style="padding: 8px;">${tName} <small style="color:#64748b;">(${courseName})</small></td>
                <td style="padding: 8px;">Substituição Extra</td>
                <td style="padding: 8px; text-align: center;">${sub.period}º</td>
                <td style="padding: 8px; text-align: center;"><span style="background: #e0e7ff; color: #4338ca; padding: 3px 8px; border-radius: 4px; font-weight: 700;">🔄 Cobrindo outro prof.</span></td>
            </tr>`;
        });
    }

    if(recordsFound === 0) {
        htmlTable += `<tr><td colspan=\"6\" style=\"padding: 20px; text-align: center; color: #94a3b8;\">Nenhum registro encontrado no período.</td></tr>`;
    }
    htmlTable += `</tbody></table>`;

    // Constrói os blocos detalhados por Curso
    let breakdownDadasHtml = '';
    for(const c in dadasPorCurso) {
        const rate = rates[c] || 0;
        breakdownDadasHtml += `<tr><td style="padding:8px; border-bottom:1px solid #e2e8f0; font-weight:600; color:#10b981; padding-left:20px;">└ ${c} (${dadasPorCurso[c]} aulas)</td><td style="padding:8px; border-bottom:1px solid #e2e8f0; text-align:right; color:#10b981;">+ R$ ${(dadasPorCurso[c] * rate).toFixed(2).replace('.', ',')}</td></tr>`;
    }

    let breakdownDescontoHtml = '';
    if(contSubstituido > 0) {
        for(const c in descontosPorCurso) {
             const rate = rates[c] || 0;
             breakdownDescontoHtml += `<tr><td style="padding:8px; border-bottom:1px solid #e2e8f0; font-weight:600; color:#b91c1c; padding-left:20px;">└ ${c} (${descontosPorCurso[c]} aulas)</td><td style="padding:8px; border-bottom:1px solid #e2e8f0; text-align:right; color:#b91c1c;">- R$ ${(descontosPorCurso[c] * rate).toFixed(2).replace('.', ',')}</td></tr>`;
        }
    }

    // Injeta a Nova Tabela de Resumo Inteligente
    const resumoHtml = `
        <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
            <table style="width: 420px; border-collapse: collapse; font-size: 0.9rem; border: 2px solid #cbd5e1;">
                <tr><td style="padding:8px; border-bottom:1px solid #e2e8f0; font-weight:600;">Aulas Previstas (Mês)</td><td style="padding:8px; border-bottom:1px solid #e2e8f0; text-align:right;">${contPrevistas}</td></tr>
                <tr><td style="padding:8px; border-bottom:1px solid #e2e8f0; font-weight:600; color:#ef4444;">Faltas (Total)</td><td style="padding:8px; border-bottom:1px solid #e2e8f0; text-align:right; color:#ef4444;">${contFaltas}</td></tr>
                
                <tr><td style="padding:10px 8px; font-weight:800; color:#10b981; background:#f0fdf4; border-top:2px solid #cbd5e1;" colspan="2">🟢 RESUMO DE GANHOS (Aulas dadas)</td></tr>
                ${breakdownDadasHtml || `<tr><td style="padding:8px; border-bottom:1px solid #e2e8f0; padding-left:20px; color:#64748b;">Nenhuma aula registrada</td><td style="padding:8px; border-bottom:1px solid #e2e8f0; text-align:right;">R$ 0,00</td></tr>`}
                
                <tr><td style="padding:10px 8px; font-weight:800; color:#b91c1c; background:#fef2f2; border-top:2px solid #cbd5e1;" colspan="2">🔴 RESUMO DE DESCONTOS (Substituído)</td></tr>
                ${breakdownDescontoHtml || `<tr><td style="padding:8px; border-bottom:1px solid #e2e8f0; padding-left:20px; color:#64748b;">Nenhum desconto</td><td style="padding:8px; border-bottom:1px solid #e2e8f0; text-align:right;">R$ 0,00</td></tr>`}

                <tr style="background: #eef2ff; border-top: 2px solid #cbd5e1;"><td style="padding:12px 8px; font-weight:800; color:#4338ca;">TOTAL A RECEBER</td><td style="padding:12px 8px; text-align:right; font-weight:800; font-size:1.2rem; color:#4338ca;">R$ ${totalFinanceiro.toFixed(2).replace('.', ',')}</td></tr>
            </table>
        </div>
    `;
    
    document.getElementById('indTableContainer').innerHTML = htmlTable + resumoHtml;

    const oldSummary = document.getElementById('indSumPrevistas');
    if (oldSummary) {
        const oldDiv = oldSummary.closest('div');
        if (oldDiv) oldDiv.style.display = 'none';
    }

    document.getElementById('individualActions').classList.remove("hidden");

    const cursosTexto = Object.entries(dadasPorCurso).map(([c, q]) => `🎓 *${c}*: ${q} aulas`).join('\n');

    globalIndData = {
        profName: professor.name,
        mes: document.getElementById('indMonth').textContent,
        dadas: contDadas,
        cursosTexto: cursosTexto || "Nenhuma aula registrada",
        faltas: contFaltas,
        substituidas: contSubstituido,
        desconto: descontoFinanceiro.toFixed(2).replace('.', ','),
        total: totalFinanceiro.toFixed(2).replace('.', ',')
    };
};

document.getElementById('btnSendWhatsAppIndividual').onclick = () => {
    const msg = `*Relatório Financeiro - TimeClass Pro*\n\nOlá, prof. *${globalIndData.profName}*.\nSegue o resumo do seu extrato referente a *${globalIndData.mes}*:\n\n✅ *Aulas Ministradas (Total: ${globalIndData.dadas})*\n${globalIndData.cursosTexto}\n\n❌ *Faltas Totais:* ${globalIndData.faltas}\n🔄 *Aulas Cobertas por Outro:* ${globalIndData.substituidas}\n📉 *Desconto (Substituições):* - R$ ${globalIndData.desconto}\n\n💰 *Total a Receber:* R$ ${globalIndData.total}\n\nA direção possui o PDF detalhado disponível para assinatura.`;
    const link = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(link, '_blank');
};

// 🟢 CORREÇÃO: GERADOR PDF FINANCEIRO COM PROTEÇÃO CONTRA CORTES (EM PÉ / RETRATO)
window.exportFinancePDF = async (elementId, filename) => {
    const el = document.getElementById(elementId);
    if(!el) return;

    el.querySelectorAll('tr, tfoot, .signature-line, table').forEach(node => node.style.pageBreakInside = 'avoid');
    
    const originalWidth = el.style.width;
    const originalMaxWidth = el.style.maxWidth;
    const originalMargin = el.style.margin;
    
    // Força a área do PDF a ter a largura exata de um A4 (evita cortar e evita sair em branco)
    el.style.width = '790px';
    el.style.maxWidth = '790px';
    el.style.margin = '0 auto';

    const opt = {
        margin: [10, 10, 10, 10],
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true }, 
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
    };

    try {
        await html2pdf().set(opt).from(el).save();
    } catch(err) {
        console.error("Erro no PDF:", err);
        alert("Houve um erro na geração do PDF.");
    } finally {
        // Restaura a tela ao normal
        el.style.width = originalWidth;
        el.style.maxWidth = originalMaxWidth;
        el.style.margin = originalMargin;
    }
};

document.getElementById('btnExportFinancePDF').onclick = async () => {
    const monthVal = document.getElementById('financeMonth').value;
    await window.exportFinancePDF('printFinanceArea', `Folha_Consolidada_${monthVal}.pdf`);
};

document.getElementById('btnExportIndividualPDF').onclick = async () => {
    const nome = globalIndData.profName.replace(/\s+/g, '_');
    const mes = document.getElementById('financeMonth').value;
    await window.exportFinancePDF('printIndividualFinanceArea', `Extrato_${nome}_${mes}.pdf`);
};
