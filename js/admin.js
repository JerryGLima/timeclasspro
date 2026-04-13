import { db, auth } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, setDoc, getDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { checkTeacherConflict } from './horario.js';
import { calculateTimeSlots, compressImageToBase64, getCurrentLocation } from './utils.js';

let schoolId = "";
window.tempVinculos = []; 
let subjectMap = {}; 
let allGrades = []; 
let globalSchoolName = "";
let monitorMode = "now";

// --- INICIALIZAÇÃO SaaS ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        schoolId = user.uid;
        initNavigation();
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

// --- MONITOR EM TEMPO REAL COM ATUALIZAÇÃO INTELIGENTE ---
function startLiveMonitor() { 
    updateLiveMonitor(); 
    // Atualização automática a cada 10 minutos (600.000 ms)
    setInterval(updateLiveMonitor, 600000); 

    // Gatilho para o botão de atualização manual
    const btnRefresh = document.getElementById('btnRefreshMonitor');
    if (btnRefresh) {
        btnRefresh.onclick = () => {
            const icon = document.getElementById('iconRefresh');
            icon.style.display = "inline-block";
            icon.style.transition = "transform 0.5s ease";
            icon.style.transform = "rotate(360deg)";
            
            updateLiveMonitor().then(() => {
                setTimeout(() => { icon.style.transform = "rotate(0deg)"; }, 500);
                console.log("Monitor atualizado manualmente.");
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
        const qSched = query(collection(db, "schedules"), where("schoolId", "==", schoolId), where("day", "==", today));
        const schedSnap = await getDocs(qSched);
        const schedules = schedSnap.docs.map(d => d.data());

        const pSnap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", schoolId)));
        const pMap = {}; pSnap.forEach(d => pMap[d.id] = d.data().name);

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
                <span class="m-prof">${aula ? pMap[aula.teacherId] : "-"}</span>
                ${aula ? `<button onclick="window.prepareQuickSub('${today}', ${activeP}, '${grade.id}')" style="margin-top:8px; font-size:0.6rem; background:#fee2e2; color:#ef4444; border:1px solid #fecaca; padding:4px; border-radius:4px; cursor:pointer; font-weight:700">⚠️ SUBSTITUIR</button>` : ''}
            </div>`;
        });
        container.innerHTML = html;
    } catch (error) {
        console.error("Erro ao carregar monitor:", error);
    }
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
    
    const pSnap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", schoolId)));
    const teachers = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
    
    const sSnap = await getDocs(query(collection(db, "schedules"), where("schoolId", "==", schoolId), where("day", "==", day), where("period", "==", period)));
    const busyIds = sSnap.docs.map(d => d.data().teacherId);
    
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
        schoolId, 
        date, 
        gradeId: gId, 
        period: period, 
        teacherId: tId, 
        time: nowTime + " (Subst.)", 
        manual: true, 
        isSubstitution: true,
        timestamp: new Date().toISOString() 
    });
    
    alert("✅ Substituição registrada com sucesso!");
    document.querySelector('[data-section="sec-dash"]').click();
};

// --- CONTROLE DE FREQUÊNCIA (COM DETALHAMENTO DE SUBSTITUTO) ---
async function loadAttendance() {
    const list = document.getElementById('listAttendance');
    const date = document.getElementById('freqDate').value;
    const gradeFilter = document.getElementById('freqGradeFilter').value;
    list.innerHTML = "<li>Carregando frequência...</li>";

    const qFreq = query(collection(db, "attendance"), where("schoolId", "==", schoolId), where("date", "==", date));
    const snapFreq = await getDocs(qFreq);
    const checkedIn = {}; snapFreq.forEach(d => { const f = d.data(); checkedIn[`${f.gradeId}-${f.period}`] = f; });

    const daysWeek = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const dayName = daysWeek[new Date(date + "T00:00").getDay()];
    const qSched = query(collection(db, "schedules"), where("schoolId", "==", schoolId), where("day", "==", dayName));
    const schedSnap = await getDocs(qSched);

    const pSnap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", schoolId)));
    const pMap = {}; pSnap.forEach(d => pMap[d.id] = d.data().name);

    list.innerHTML = "";
    schedSnap.forEach(d => {
        const s = d.data();
        if(gradeFilter && s.gradeId !== gradeFilter) return;
        const grade = allGrades.find(g => g.id === s.gradeId);
        const log = checkedIn[`${s.gradeId}-${s.period}`];
        
        let statusColor = log ? (log.manual ? "#f59e0b" : "#10b981") : "#ef4444";
        let statusText = log ? (log.manual ? "Confirmado Manual" : `Iniciado às ${log.time}`) : "Pendente / Falta";
        let subInfo = "";

        if (log && log.isSubstitution) {
            statusColor = "#6366f1"; 
            const titular = pMap[s.teacherId] || "Titular";
            const substituto = pMap[log.teacherId] || "Substituto";
            subInfo = `
                <div style="margin-top:5px; background:#eef2ff; border:1px solid #c7d2fe; padding:6px; border-radius:8px; font-size:0.75rem;">
                    <span style="color:#4338ca; font-weight:800;">🔄 SUBSTITUIÇÃO:</span> 
                    <strong>${substituto}</strong> cobriu <strong>${titular}</strong>
                </div>
            `;
            statusText = "Aula Substituída";
        }

        const li = document.createElement('li');
        li.style.flexDirection = "column";
        li.style.alignItems = "flex-start";
        li.innerHTML = `
            <div style="width:100%; display:flex; justify-content:space-between; align-items:center;">
                <div style="flex:1">
                    <span style="font-size:0.6rem; color:#94a3b8">${grade?.name || "Turma"} - ${s.period}º Horário</span><br>
                    <strong>${pMap[s.teacherId]}</strong> - <small style="color:${statusColor}">${statusText}</small>
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

// --- CRUD TURMAS ---
document.getElementById('btnSaveConfig').onclick = async () => {
    const gradeName = document.getElementById('gradeName').value;
    const editId = document.getElementById('editGradeId').value;
    if(!gradeName) return alert("Preencha o nome!");
    let logo = editId ? (allGrades.find(g => g.id === editId)?.logoUrl || "") : "";
    if (document.getElementById('schoolLogoInput').files[0]) logo = await compressImageToBase64(document.getElementById('schoolLogoInput').files[0]);
    const payload = { name: gradeName, courseName: document.getElementById('courseName').value, startTime: document.getElementById('startTime').value, lessonDuration: parseInt(document.getElementById('lessonDuration').value), intervalAfter: parseInt(document.getElementById('intervalAfter').value), intervalDuration: parseInt(document.getElementById('intervalDuration').value), logoUrl: logo, schoolId };
    if(editId) await setDoc(doc(db, "grades", editId), payload);
    else await addDoc(collection(db, "grades"), payload);
    location.reload();
};

window.prepareEditGrade = (id) => {
    const g = allGrades.find(g => g.id === id);
    document.getElementById('editGradeId').value = id;
    document.getElementById('gradeName').value = g.name;
    document.getElementById('courseName').value = g.courseName;
    document.getElementById('startTime').value = g.startTime;
    document.getElementById('lessonDuration').value = g.lessonDuration;
    document.getElementById('intervalAfter').value = g.intervalAfter;
    document.getElementById('intervalDuration').value = g.intervalDuration;
    if(g.logoUrl) { const img = document.getElementById('imgPreview'); img.src = g.logoUrl; img.style.display = "block"; }
    document.querySelector('[data-section="sec-config"]').click();
};

// --- CRUD MATÉRIAS ---
document.getElementById('btnSaveSubject').onclick = async () => {
    const editId = document.getElementById('editSubjectId').value;
    const payload = { name: document.getElementById('subjectName').value, sigla: document.getElementById('subjectSigla').value.toUpperCase(), color: document.getElementById('subjectColor').value, schoolId };
    if(editId) await setDoc(doc(db, "subjects", editId), payload);
    else await addDoc(collection(db, "subjects"), payload);
    location.reload();
};

window.prepareEditSubject = async (id) => {
    const d = await getDoc(doc(db, "subjects", id)); const s = d.data();
    document.getElementById('editSubjectId').value = id;
    document.getElementById('subjectName').value = s.name;
    document.getElementById('subjectSigla').value = s.sigla;
    document.getElementById('subjectColor').value = s.color;
    document.querySelector('[data-section="sec-cadastros"]').click();
};

// --- CRUD PROFESSORES ---
window.editProfessor = async (id) => {
    try {
        const d = await getDoc(doc(db, "teachers", id));
        if (!d.exists()) return;
        const p = d.data();
        document.getElementById('editProfId').value = id;
        document.getElementById('profName').value = p.name;
        document.getElementById('profEmail').value = p.email;
        document.querySelectorAll('.dia-folga').forEach(cb => { cb.checked = p.restricoes ? p.restricoes.includes(cb.value) : false; });
        window.tempVinculos = p.vinculos ? [...p.vinculos] : [];
        renderTemp();
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
    const password = document.getElementById('profPassword').value;
    const payload = { name: document.getElementById('profName').value, email, schoolId, vinculos: window.tempVinculos, restricoes: rest };
    
    if(id) {
        await setDoc(doc(db, "teachers", id), payload);
    } else {
        if (!password || password.length < 6) {
            alert("⚠️ Defina uma senha de pelo menos 6 caracteres para o professor.");
            return;
        }
        // Cria conta no Firebase Auth
        try {
            const { createUserWithEmailAndPassword: createUser } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
            await createUser(auth, email, password);
        } catch(e) {
            if (e.code !== 'auth/email-already-in-use') {
                alert("Erro ao criar acesso: " + e.message);
                return;
            }
        }
        await addDoc(collection(db, "teachers"), payload);
    }
    location.reload();
};

// ✅ Criar/resetar acesso para professor já cadastrado
window.criarAcessoProfessor = async (id, email, name) => {
    const senha = prompt(`Defina uma senha para ${name} (${email}):\n(mínimo 6 caracteres)`);
    if (!senha) return;
    if (senha.length < 6) { alert("A senha deve ter pelo menos 6 caracteres!"); return; }
    
    try {
        const { createUserWithEmailAndPassword: createUser } = await import("https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js");
        await createUser(auth, email, senha);
        alert(`✅ Acesso criado com sucesso para ${name}!\n\nEmail: ${email}\nSenha: ${senha}\n\nPasse essas informações para o professor.`);
    } catch(e) {
        if (e.code === 'auth/email-already-in-use') {
            alert(`⚠️ Este professor já tem acesso criado!\n\nSe precisar redefinir a senha, acesse o Firebase Console → Authentication.`);
        } else {
            alert("Erro: " + e.message);
        }
    }
};

// --- CARREGAMENTO GERAL ---
async function loadSchoolInfo() {
    const docSnap = await getDoc(doc(db, "schools", schoolId));
    if (docSnap.exists()) {
        const d = docSnap.data(); globalSchoolName = d.schoolName || "SGH Pro";
        document.getElementById('inputSchoolName').value = globalSchoolName;
        document.getElementById('viewSchoolNameAdmin').textContent = globalSchoolName;
        document.getElementById('schoolLat').value = d.latitude || "";
        document.getElementById('schoolLng').value = d.longitude || "";
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
    for (const col of cols) {
        const q = query(collection(db, col), where("schoolId", "==", schoolId));
        const snap = await getDocs(q);
        if(document.getElementById(`stat-${col}`)) document.getElementById(`stat-${col}`).textContent = snap.size;
        let dataArray = snap.docs.map(d => ({id: d.id, ...d.data()}));
        if (col === 'subjects') dataArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
        else if (col === 'grades') { 
            dataArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })); 
            allGrades = dataArray; gC = dataArray; 
            const selF = document.getElementById('freqGradeFilter'); 
            if(selF) {
                selF.innerHTML = '<option value="">Todas as turmas</option>';
                dataArray.forEach(g => selF.innerHTML += `<option value="${g.id}">${g.name}</option>`);
            }
            const selS = document.getElementById('subGradeSearch');
            if(selS) {
                selS.innerHTML = '<option value="">Selecione a Turma</option>';
                dataArray.forEach(g => selS.innerHTML += `<option value="${g.id}">${g.name}</option>`);
            }
        }
        else if (col === 'teachers') { dataArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); tC = dataArray; }
        const list = document.getElementById(col === 'subjects' ? 'listSubjects' : (col === 'grades' ? 'listGrades' : 'listProfessors'));
        if(list) {
            list.innerHTML = "";
            dataArray.forEach(data => {
                if(col === 'subjects') subjectMap[data.id] = data;
                let htmlItem = `<li><div>`;
                if(col === 'subjects') htmlItem += `<span class='subject-color-tag' style='background:${data.color}'></span>${data.name}`;
                else if(col === 'grades') htmlItem += `<strong>${data.name}</strong> (${data.courseName})`;
                else if(col === 'teachers') {
                    const mats = data.vinculos ? data.vinculos.map(v => v.subName).join(', ') : '-';
                    htmlItem += `<strong>${data.name}</strong> <span style="font-size:0.7rem; background:#e0e7ff; padding:2px 6px; border-radius:4px; margin-left:8px">${workload[data.id] || 0} aulas</span><br><small>${mats}</small>`;
                }
                if (col === 'teachers') {
                    htmlItem += `</div><div style="display:flex; gap:5px; flex-wrap:wrap;">
                        <button class="btn-edit" onclick="window.prepareEditProfessor('${data.id}')">Editar</button>
                        <button style="background:#dcfce7; color:#16a34a; border:none; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem; font-weight:700;" onclick="window.criarAcessoProfessor('${data.id}', '${data.email}', '${data.name}')">🔑 Criar Acesso</button>
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
    const alertT = document.getElementById('alert-teachers');
    const alertG = document.getElementById('alert-grades');
    const chart = document.getElementById('workloadChart');
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

// --- GERADOR ---
document.getElementById('selectGrade').onchange = (e) => { if(e.target.value) renderTimetable(e.target.value); };

async function renderTimetable(gradeId) {
    const grade = allGrades.find(g => g.id === gradeId);
    const container = document.getElementById('timetableContainer');
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const timesLabels = calculateTimeSlots(grade.startTime, grade.lessonDuration, 7, grade.intervalAfter, grade.intervalDuration);
    
    const pSnap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", schoolId)));
    let teacherArray = pSnap.docs.map(d => ({id: d.id, ...d.data()}));
    teacherArray.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')); 
    
    const filteredOptions = []; const cache = {}; 
    teacherArray.forEach(p => {
        cache[p.id] = p;
        p.vinculos?.forEach(v => {
            if(v.grdId === gradeId) {
                const sigla = subjectMap[v.subId]?.sigla || "";
                filteredOptions.push({ value: `${p.id}|${v.subId}`, label: `${p.name} - ${sigla}`, teacherId: p.id });
            }
        });
    });

    const qSaved = query(collection(db, "schedules"), where("gradeId", "==", gradeId));
    const savedSnap = await getDocs(qSaved); const savedData = {}; 
    savedSnap.forEach(d => { 
        const s = d.data(); 
        savedData[`${s.day}-${s.period}`] = `${s.teacherId}|${s.subjectId}`; 
    });

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
            const [tId, sId] = val.split('|');
            const day = e.target.dataset.day;
            const countDia = Array.from(document.querySelectorAll(`.schedule-select[data-day="${day}"]`)).filter(sel => sel.value.startsWith(tId)).length;
            if(countDia > 2) alert("🚫 Sugestão: Limite de 2 aulas/dia.");
            if(cache[tId].restricoes?.includes(day)) { alert(`Folga de ${cache[tId].name}`); e.target.value = ""; return; }
            if(await checkTeacherConflict(tId, day, e.target.dataset.period, gradeId, schoolId)) { alert("⚠️ CONFLITO!"); e.target.value = ""; }
        };
    });
}

document.getElementById('btnSaveFullSchedule').onclick = async () => {
    const gradeId = document.getElementById('selectGrade').value; if(!gradeId) return;
    const selects = document.querySelectorAll('.schedule-select');
    const q = query(collection(db, "schedules"), where("gradeId", "==", gradeId));
    const snap = await getDocs(q);
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
    const gid = document.getElementById('selectGrade').value; if(!gid) return alert("Selecione!");
    const link = `${window.location.origin}${window.location.pathname.replace('admin.html', 'turma.html')}?s=${schoolId}&g=${gid}`;
    navigator.clipboard.writeText(link); alert("🔗 Copiado!");
};

document.getElementById('btnExportPdfAdmin').onclick = async () => {
    const gid = document.getElementById('selectGrade').value; if(!gid) return;
    const grade = allGrades.find(g => g.id === gid);
    const container = document.getElementById('timetableContainer');
    const header = document.getElementById('headerGradeAdmin');
    document.getElementById('viewGradeAdmin').textContent = grade.name;
    document.getElementById('viewCourseAdmin').textContent = grade.courseName;
    document.getElementById('schoolLogoPrint').src = grade.logoUrl || "";
    const tableClone = container.querySelector('table').cloneNode(true);
    const selects = container.querySelectorAll('select');
    const pSnap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", schoolId)));
    const pData = {}; pSnap.forEach(d => pData[d.id] = d.data());
    let selIdx = 0;
    tableClone.querySelectorAll('tr').forEach((tr) => {
        if(tr.classList.contains('intervalo-row')) return;
        tr.querySelectorAll('td').forEach((td, colIdx) => {
            if(colIdx === 0) return;
            const val = selects[selIdx].value; td.innerHTML = "";
            if(val) {
                const [tId, sId] = val.split('|');
                const sub = subjectMap[sId];
                td.innerHTML = `<div style="background:${sub.color}; color:white; font-weight:700; border-radius:6px; height:26px; display:flex; align-items:center; justify-content:center; text-align:center; padding:2px; font-size:0.55rem; white-space: nowrap; overflow: hidden;">${sub.name}</div>`;
            } else td.innerHTML = `<div style="background:#f8fafc; border-radius:8px; border: 1px dashed #e2e8f0; height:26px;"></div>`;
            selIdx++;
        });
    });
    tableClone.querySelectorAll('.time-column').forEach(el => { el.style.height = "26px"; el.style.fontSize = "0.55rem"; el.style.width = "85px"; });
    const pw = document.createElement('div'); pw.style.padding = "10px"; pw.style.backgroundColor = "white";
    const clonedHeader = header.cloneNode(true); clonedHeader.style.display = "block";
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

window.del = async (c, i) => { if(confirm("Excluir?")) { await deleteDoc(doc(db, c, i)); loadAllData(); }};
window.prepareEditProfessor = (id) => window.editProfessor(id);

// --- FINANCEIRO (RELATÓRIO C/ CRUZAMENTO DE PONTO) ---
document.getElementById('btnGenerateFinanceReport').onclick = async () => {
    const monthVal = document.getElementById('financeMonth').value;
    const valorHora = parseFloat(document.getElementById('valorHoraAula').value || 0);

    if (!monthVal) return alert("⚠️ Por favor, selecione um mês para gerar o relatório!");
    if (valorHora <= 0) return alert("⚠️ Informe um valor válido para a Hora/Aula!");
    
    const container = document.getElementById('financeResultContainer');
    container.innerHTML = "<p style='text-align:center; color:#6366f1; padding: 20px;'>Calculando aulas do mês e cruzando com o ponto digital...</p>";

    const [year, month] = monthVal.split('-').map(Number);
    const daysInMonth = new Date(year, month, 0).getDate();

    const dayCounts = { "Domingo": 0, "Segunda": 0, "Terça": 0, "Quarta": 0, "Quinta": 0, "Sexta": 0, "Sábado": 0 };
    const daysWeek = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    
    for (let i = 1; i <= daysInMonth; i++) {
        const d = new Date(year, month - 1, i);
        dayCounts[daysWeek[d.getDay()]]++;
    }

    const pSnap = await getDocs(query(collection(db, "teachers"), where("schoolId", "==", schoolId)));
    const teachersList = {};
    pSnap.forEach(d => { 
        teachersList[d.id] = { name: d.data().name, previstas: 0, dadas: 0 }; 
    });

    const sSnap = await getDocs(query(collection(db, "schedules"), where("schoolId", "==", schoolId)));
    sSnap.forEach(d => {
        const s = d.data();
        if (teachersList[s.teacherId] && dayCounts[s.day]) {
            teachersList[s.teacherId].previstas += dayCounts[s.day];
        }
    });

    const attSnap = await getDocs(query(collection(db, "attendance"), where("schoolId", "==", schoolId)));
    attSnap.forEach(d => {
        const att = d.data();
        if (att.date && att.date.startsWith(monthVal)) {
            if (teachersList[att.teacherId]) {
                teachersList[att.teacherId].dadas++;
            }
        }
    });

    let html = `<table style="width:100%; border-collapse: collapse; margin-top: 15px; font-size: 0.9rem;">
        <thead>
            <tr style="background: #f1f5f9; border-bottom: 2px solid #cbd5e1;">
                <th style="padding: 12px; text-align: left;">Professor</th>
                <th style="padding: 12px; text-align: center;">Previstas</th>
                <th style="padding: 12px; text-align: center;">Dadas</th>
                <th style="padding: 12px; text-align: center;">Faltas</th>
                <th style="padding: 12px; text-align: center;">% Freq.</th>
                <th style="padding: 12px; text-align: center;">Valor/Aula</th>
                <th style="padding: 12px; text-align: right;">A Receber</th>
            </tr>
        </thead>
        <tbody>`;
    
    let totalGeralPagar = 0;
    let totalGeralPrevisto = 0;
    let profsArray = Object.values(teachersList).sort((a,b) => a.name.localeCompare(b.name));

    profsArray.forEach(p => {
        if (p.previstas > 0 || p.dadas > 0) {
            const faltas = Math.max(0, p.previstas - p.dadas);
            const pct = p.previstas > 0 ? ((p.dadas / p.previstas) * 100).toFixed(1) : 100;
            const totalProf = p.dadas * valorHora;
            totalGeralPrevisto += (p.previstas * valorHora);
            totalGeralPagar += totalProf;
            let pctColor = pct >= 90 ? '#10b981' : (pct >= 70 ? '#f59e0b' : '#ef4444');

            html += `
            <tr style="border-bottom: 1px solid #e2e8f0; page-break-inside: avoid;">
                <td style="padding: 10px;">${p.name}</td>
                <td style="padding: 10px; text-align: center; color: #64748b;">${p.previstas}</td>
                <td style="padding: 10px; text-align: center; font-weight: bold; color: #0f172a;">${p.dadas}</td>
                <td style="padding: 10px; text-align: center; color: #ef4444;">${faltas}</td>
                <td style="padding: 10px; text-align: center; color: ${pctColor}; font-weight: bold;">${pct}%</td>
                <td style="padding: 10px; text-align: center; color: #64748b;">R$ ${valorHora.toFixed(2).replace('.', ',')}</td>
                <td style="padding: 10px; text-align: right; font-weight: bold; color: #10b981;">R$ ${totalProf.toFixed(2).replace('.', ',')}</td>
            </tr>`;
        }
    });

    html += `</tbody>
        <tfoot style="page-break-inside: avoid;">
            <tr style="background: #e0e7ff; font-weight: 800;">
                <td colspan="6" style="padding: 12px; text-align: right; color: #1e293b;">TOTAL DA FOLHA:</td>
                <td style="padding: 12px; text-align: right; color: #4f46e5; font-size: 1.1rem;">R$ ${totalGeralPagar.toFixed(2).replace('.', ',')}</td>
            </tr>
        </tfoot>
    </table>`;

    container.innerHTML = html;
    document.getElementById('headerFinancePrint').style.display = 'block';
    document.getElementById('finSchoolNamePrint').textContent = globalSchoolName;
    document.getElementById('finMonthLabelPrint').textContent = `Referência: ${monthVal.split('-').reverse().join('/')}`;
    document.getElementById('btnExportFinancePDF').classList.remove('hidden');
};

document.getElementById('btnExportFinancePDF').onclick = () => {
    const printArea = document.getElementById('printFinanceArea');
    const monthVal = document.getElementById('financeMonth').value;
    html2pdf().set({
        margin: [15, 15, 15, 15],
        filename: `Folha_Pagamento_${monthVal}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] }
    }).from(printArea).save();
};
