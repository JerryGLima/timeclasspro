import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolId = "";
let currentProfName = "";

// A mágica acontece aqui: O observador de autenticação do Firebase
onAuthStateChanged(auth, async (user) => {
    const timetableArea = document.getElementById('timetableContent');
    const agendaArea = document.getElementById('dailyAgendaScroll');

    if (user && user.email) {
        const emailLogado = user.email.toLowerCase().trim();
        console.log("Usuário autenticado:", emailLogado);
        
        try {
            // 1. BUSCA O PROFESSOR: Não importa quem logou, procuramos esse e-mail na coleção 'teachers'
            const qProf = query(collection(db, "teachers"), where("email", "==", emailLogado));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) {
                timetableArea.innerHTML = `<div style="padding:20px; text-align:center; color:#ef4444;">
                    <h3>⚠️ Acesso Restrito</h3>
                    <p>O e-mail <b>${emailLogado}</b> não está cadastrado como professor nesta instituição.</p>
                </div>`;
                return;
            }
            
            // Dados do Professor encontrados
            const profDoc = profSnap.docs[0];
            currentProfId = profDoc.id;
            const profData = profDoc.data();
            schoolId = profData.schoolId; // Aqui descobrimos a ID da escola automaticamente
            currentProfName = profData.name;

            // 2. BUSCA DADOS DA ESCOLA (Nome e GPS)
            const schoolSnap = await getDoc(doc(db, "schools", schoolId));
            const sData = schoolSnap.exists() ? schoolSnap.data() : {};
            schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };

            // Atualiza o cabeçalho
            document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "TimeClass Pro";
            document.getElementById('viewProfNameProf').textContent = currentProfName;
            if(sData.logoUrl) document.getElementById('schoolLogoDisplay').src = sData.logoUrl;

            // 3. CARREGA MATÉRIAS E TURMAS (Essencial para traduzir IDs em nomes)
            const subSnap = await getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId)));
            const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());

            const grdSnap = await getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId)));
            const gradesMap = {}; grdSnap.forEach(d => gradesMap[d.id] = d.data());

            // 4. BUSCA AS AULAS (SCHEDULES) DO PROFESSOR
            const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            // 5. BUSCA PRESENÇAS DO DIA
            const todayISO = new Date().toISOString().split('T')[0];
            const qFreq = query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", todayISO));
            const freqSnap = await getDocs(qFreq);
            const checkins = freqSnap.docs.map(d => d.data());

            // 6. PEGA CONFIGURAÇÃO DE HORÁRIO (Usa a primeira turma como base)
            const configBase = Object.values(gradesMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

            // RENDERIZAÇÃO FINAL
            renderDailyAgenda(myLessons, gradesMap, subMap, configBase, checkins);
            renderTablePremium(myLessons, subMap, configBase);

            // Atualiza o ano no rodapé
            document.querySelectorAll('.currentYear').forEach(el => el.textContent = new Date().getFullYear());

        } catch (error) {
            console.error("Erro ao carregar dados:", error);
            timetableArea.innerHTML = "<h3>Erro de conexão com o banco de dados.</h3>";
        }
    } else if (user === null) {
        // Se não houver ninguém logado, volta para o login
        window.location.assign('login.html');
    }
});

// As funções renderDailyAgenda, renderTablePremium e doCheckin permanecem as mesmas que você já tem, 
// apenas garanta que elas usem os mapas (subMap e gradesMap) passados por parâmetro.

function renderDailyAgenda(lessons, gradesMap, subMap, config, checkins) {
    const container = document.getElementById('dailyAgendaScroll');
    const now = new Date();
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const today = days[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();
    document.getElementById('todayLabel').textContent = today;
    if(now.getDay() === 0 || now.getDay() === 6) { container.innerHTML = "<p>Fim de semana!</p>"; return; }
    
    const times = calculateTimeSlots(config.startTime, config.lessonDuration, 7, config.intervalAfter, config.intervalDuration);
    const [h, m] = config.startTime.split(':').map(Number);
    let startM = h * 60 + m;
    let html = "";
    for(let i=1; i<=7; i++) {
        let pS = startM + (i-1) * config.lessonDuration;
        if (i > config.intervalAfter) pS += config.intervalDuration;
        let pE = pS + config.lessonDuration;
        const isNow = (currentMins >= pS && currentMins < pE);
        const aula = lessons.find(l => l.day === today && l.period == i);
        if(aula) {
            const s = subMap[aula.subjectId] || {name:'Aula', color:'#6366f1'};
            const g = gradesMap[aula.gradeId] || {name:'Turma'};
            const jaFezCheckin = checkins.some(c => c.gradeId === aula.gradeId && c.period === i);
            html += `
                <div class="agenda-card ${isNow ? 'active' : ''}" style="border-left: 5px solid ${s.color}; background: ${jaFezCheckin ? '#f0fdf4' : 'white'}">
                    <small>${times[i-1] || ''}</small><strong>${g.name}</strong><span>${s.name}</span>
                    ${isNow && !jaFezCheckin ? `<button onclick="window.doCheckin('${aula.gradeId}', ${i})" style="margin-top:10px; background:#10b981; color:white; border:none; padding:8px; border-radius:8px; font-weight:700; cursor:pointer">📍 BATER PONTO</button>` : ''}
                    ${jaFezCheckin ? '<span style="color:#10b981; font-size:0.6rem; font-weight:800; margin-top:5px">✓ PRESENÇA OK</span>' : ''}
                </div>`;
        }
    }
    container.innerHTML = html || "<p>Sem aulas hoje.</p>";
}

function renderTablePremium(lessons, subMap, config) {
    const area = document.getElementById('timetableContent');
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const times = calculateTimeSlots(config.startTime, config.lessonDuration, 7, config.intervalAfter, config.intervalDuration);
    let html = `<table><thead><tr><th style="font-size:0.65rem; width:95px;">HORÁRIO</th>`;
    days.forEach(d => html += `<th>${d.toUpperCase()}</th>`);
    html += `</tr></thead><tbody>`;
    for (let i = 1; i <= 7; i++) {
        html += `<tr><td class="prof-time-col">${times[i-1] || '--:--'}</td>${days.map(d => {
            const aula = lessons.find(l => l.day === d && l.period == i);
            if (aula) {
                const s = subMap[aula.subjectId] || {name: 'Aula', color: '#6366f1'};
                return `<td style="padding:4px;"><div class="prof-subject-pill" style="background:${s.color}; color:white;">${s.name}</div></td>`;
            }
            return `<td style="background:#f8fafc; border: 1px dashed #e2e8f0;"></td>`;
        }).join('')}</tr>`;
        if (i === parseInt(config.intervalAfter)) html += `<tr class="intervalo-row"><td colspan="6">INTERVALO</td></tr>`;
    }
    html += `</tbody></table>`;
    area.innerHTML = html;
}

window.doCheckin = async (gradeId, period) => {
    try {
        if (!schoolCoords.lat) return alert("GPS da escola não configurado.");
        const userLoc = await getCurrentLocation();
        const distance = calculateDistance(userLoc.lat, userLoc.lng, schoolCoords.lat, schoolCoords.lng);
        if (distance > 250) return alert(`Você está a ${Math.round(distance)}m da escola. O limite é 250m.`);
        const now = new Date();
        await addDoc(collection(db, "attendance"), { schoolId, gradeId, period, teacherId: currentProfId, date: now.toISOString().split('T')[0], time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), timestamp: now.toISOString(), manual: false });
        location.reload();
    } catch (e) { alert(e.message); }
};

document.getElementById('btnLogoutProf').onclick = () => signOut(auth).then(() => window.location.assign('login.html'));
