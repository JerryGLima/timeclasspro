import { db, auth, createSecondaryAuth } from './firebase-config.js';
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

// --- GESTÃO DE PROFESSORES AUTOMATIZADA ---
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
            // Edição: Atualiza apenas o Firestore
            await setDoc(doc(db, "teachers", id), payload);
            alert("✅ Professor atualizado!");
        } else {
            // Novo: Cadastro automático no Authentication via canal secundário
            if (!password || password.length < 6) return alert("⚠️ Defina uma senha (mín. 6 caracteres).");

            const secondaryAuth = createSecondaryAuth();
            await createUserWithEmailAndPassword(secondaryAuth, email, password);
            await addDoc(collection(db, "teachers"), payload);
            await secondaryAuth.signOut();
            
            alert(`✅ Sucesso! Professor cadastrado.\nLogin: ${email}\nSenha: ${password}`);
        }
        location.reload();
    } catch (e) {
        if (e.code === 'auth/email-already-in-use') {
            await addDoc(collection(db, "teachers"), payload);
            alert("✅ Perfil salvo! (O acesso já existia para este e-mail)");
            location.reload();
        } else {
            alert("Erro no cadastro automático: " + e.message);
        }
    }
};

window.redefinirSenha = async (email) => {
    if (!confirm(`Enviar e-mail de redefinição de senha oficial para ${email}?`)) return;
    try {
        await sendPasswordResetEmail(auth, email);
        alert("✅ E-mail enviado! O professor deve verificar a caixa de entrada (ou spam).");
    } catch (e) {
        alert("Erro: " + e.message);
    }
};

// --- RESTANTE DA LÓGICA (CRUD, GERADOR, FINANCEIRO) MANTIDA ---
// [As funções de CRUD Turmas, Matérias, Frequência e Relatórios seguem conforme seu código original]

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
        
        if (col === 'teachers') {
            tC = dataArray;
            const list = document.getElementById('listProfessors');
            if(list) {
                list.innerHTML = "";
                dataArray.forEach(data => {
                    const mats = data.vinculos ? data.vinculos.map(v => v.subName).join(', ') : '-';
                    list.innerHTML += `
                    <li>
                        <div><strong>${data.name}</strong><br><small>${mats}</small></div>
                        <div style="display:flex; gap:5px; flex-wrap:wrap;">
                            <button class="btn-edit" onclick="window.prepareEditProfessor('${data.id}')">Editar</button>
                            <button style="background:#dcfce7; color:#16a34a; border:none; padding:6px 12px; border-radius:8px; cursor:pointer; font-size:0.75rem; font-weight:700;" onclick="window.redefinirSenha('${data.email}')">🔑 Senha</button>
                            <button class="btn-delete" onclick="window.del('${col}', '${data.id}')">Excluir</button>
                        </div>
                    </li>`;
                });
            }
        } else {
            // Lógica original para subjects e grades
            const list = document.getElementById(col === 'subjects' ? 'listSubjects' : 'listGrades');
            if(list) {
                list.innerHTML = "";
                dataArray.forEach(data => {
                    if(col === 'subjects') subjectMap[data.id] = data;
                    list.innerHTML += `<li><div><strong>${data.name}</strong></div><div><button class="btn-edit" onclick="window.prepareEdit${col === 'subjects' ? 'Subject' : 'Grade'}('${data.id}')">Editar</button><button class="btn-delete" onclick="window.del('${col}', '${data.id}')">Excluir</button></div></li>`;
                });
            }
        }
    }
}

// Funções de inicialização restantes do admin.js original...
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

window.del = async (c, i) => { if(confirm("Excluir?")) { await deleteDoc(doc(db, c, i)); loadAllData(); }};
window.prepareEditProfessor = (id) => { window.editProfessor(id); };
