import { db, auth } from './firebase-config.js';
import { collection, addDoc, getDocs, doc, setDoc, getDoc, deleteDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { signOut, onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
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
        const schoolSnap = await getDoc(doc(db, "schools", user.uid));
        if (!schoolSnap.exists()) {
            console.warn("Acesso negado: usuário não é administrador.");
            await signOut(auth);
            window.location.assign('login.html');
            return;
        }

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

// --- GESTÃO DE PROFESSORES ---
window.prepareEditProfessor = async (id) => {
    try {
        const d = await getDoc(doc(db, "teachers", id));
        if (!d.exists()) return;
        const p = d.data();
        document.getElementById('editProfId').value = id;
        document.getElementById('profName').value = p.name;
        document.getElementById('profEmail').value = p.email;
        document.getElementById('profPassword').value = ""; // Senha não é recuperável por segurança
        document.querySelectorAll('.dia-folga').forEach(cb => { cb.checked = p.restricoes ? p.restricoes.includes(cb.value) : false; });
        window.tempVinculos = p.vinculos ? [...p.vinculos] : [];
        renderTemp();
        document.querySelector('[data-section="sec-professores"]').click();
    } catch (e) { console.error(e); }
};

document.getElementById('btnAddVinculo').onclick = () => {
    const s = document.getElementById('vinculoSubject'); const g = document.getElementById('vinculoGrade');
    if(!s.value || !g.value) return alert("Selecione Matéria e Turma!");
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
    const name = document.getElementById('profName').value;
    const email = document.getElementById('profEmail').value.toLowerCase().trim();
    const password = document.getElementById('profPassword').value;
    const rest = []; document.querySelectorAll('.dia-folga:checked').forEach(c => rest.push(c.value));
    
    if (!name || !email) return alert("Nome e Email são obrigatórios!");

    const payload = { name, email, schoolId, vinculos: window.tempVinculos, restricoes: rest };

    try {
        if (id) {
            // Edição: Atualiza Firestore apenas
            await setDoc(doc(db, "teachers", id), payload);
            alert("✅ Professor atualizado!");
        } else {
            // Novo: Cria no Auth e depois Firestore
            if (!password || password.length < 6) return alert("⚠️ Senha obrigatória (mín. 6 caracteres) para novos cadastros!");
            
            // Cria conta no Authentication
            await createUserWithEmailAndPassword(auth, email, password);
            // Salva no Firestore
            await addDoc(collection(db, "teachers"), payload);
            alert(`✅ Professor cadastrado!\nLogin: ${email}\nSenha: ${password}`);
        }
        location.reload();
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            await addDoc(collection(db, "teachers"), payload);
            alert("✅ Perfil criado! (Este e-mail já possuía conta de acesso)");
            location.reload();
        } else {
            alert("Erro ao salvar: " + e.message);
        }
    }
};

window.redefinirSenha = async (email) => {
    if (!confirm(`Enviar e-mail de redefinição de senha para ${email}?`)) return;
    try {
        await sendPasswordResetEmail(auth, email);
        alert("✅ E-mail de redefinição enviado! Peça ao professor para verificar a caixa de entrada (e o spam).");
    } catch (e) {
        alert("Erro ao enviar: " + e.message);
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
        if (col === 'grades') { 
            allGrades = dataArray; gC = dataArray; 
            const selF = document.getElementById('freqGradeFilter'); 
            if(selF) {
                selF.innerHTML = '<option value="">Todas as turmas</option>';
                dataArray.forEach(g => selF.innerHTML += `<option value="${g.id}">${g.name}</option>`);
            }
        }
        else if (col === 'teachers') { tC = dataArray; }
        const list = document.getElementById(col === 'subjects' ? 'listSubjects' : (col === 'grades' ? 'listGrades' : 'listProfessors'));
        if(list) {
            list.innerHTML = "";
            dataArray.forEach(data => {
                if(col === 'subjects') subjectMap[data.id] = data;
                let htmlItem = `<li><div>`;
                if(col === 'teachers') {
                    const mats = data.vinculos ? data.vinculos.map(v => v.subName).join(', ') : '-';
                    htmlItem += `<strong>${data.name}</strong><br><small>${mats}</small>`;
                } else {
                    htmlItem += `<strong>${data.name}</strong>`;
                }
                
                if (col === 'teachers') {
                    htmlItem += `</div><div style="display:flex; gap:5px;">
                        <button class="btn-edit" onclick="window.prepareEditProfessor('${data.id}')">Editar</button>
                        <button style="background:#dcfce7; color:#16a34a; border:none; padding:6px 10px; border-radius:8px; cursor:pointer; font-size:0.7rem; font-weight:700;" onclick="window.redefinirSenha('${data.email}')">🔑 Senha</button>
                        <button class="btn-delete" onclick="window.del('${col}', '${data.id}')">Excluir</button>
                    </div></li>`;
                } else {
                    htmlItem += `</div><div><button class="btn-edit" onclick="window.prepareEdit${col === 'subjects' ? 'Subject' : 'Grade'}('${data.id}')">Editar</button><button class="btn-delete" onclick="window.del('${col}', '${data.id}')">Excluir</button></div></li>`;
                }
                list.innerHTML += htmlItem;
            });
        }
    }
}

// Demais funções (CRUD Turmas/Matérias, Gerador, Financeiro, Substituição) permanecem as mesmas enviadas anteriormente no seu código original.
window.del = async (c, i) => { if(confirm("Excluir?")) { await deleteDoc(doc(db, c, i)); loadAllData(); }};
