import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolId = "";
let currentProfName = "";

onAuthStateChanged(auth, async (user) => {
    const timetableArea = document.getElementById('timetableContent');
    const agendaArea = document.getElementById('dailyAgendaScroll');

    if (user && user.email) {
        console.log("Tentando carregar dados para:", user.email);
        document.querySelectorAll('.currentYear').forEach(el => el.textContent = new Date().getFullYear());
        
        try {
            const emailB = user.email.toLowerCase().trim();
            
            // 1. Busca robusta: Tentamos achar o professor
            const qProf = query(collection(db, "teachers"), where("email", "==", emailB));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) {
                console.error("Email não cadastrado no sistema.");
                timetableArea.innerHTML = `<div style="padding:20px; text-align:center; color:#ef4444;"><h3>Acesso Negado</h3><p>O e-mail <b>${emailB}</b> não foi encontrado na lista de professores do sistema.</p></div>`;
                return;
            }
            
            const profDoc = profSnap.docs[0];
            const profData = profDoc.data();
            currentProfId = profDoc.id;
            currentProfName = profData.name;
            schoolId = profData.schoolId;

            // 2. Busca da Escola
            const schoolSnap = await getDoc(doc(db, "schools", schoolId));
            const sData = schoolSnap.exists() ? schoolSnap.data() : {};
            schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };

            // 3. Atualiza UI Básica
            document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "TimeClass Pro";
            document.getElementById('viewProfNameProf').textContent = currentProfName;
            if(sData.logoUrl) document.getElementById('schoolLogoDisplay').src = sData.logoUrl;

            // 4. Carrega Matérias e Turmas ANTES de desenhar
            const subSnap = await getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId)));
            const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());

            const grdSnap = await getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId)));
            const gradesMap = {}; grdSnap.forEach(d => gradesMap[d.id] = d.data());

            // 5. Busca Aulas e Presenças
            const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            const todayISO = new Date().toISOString().split('T')[0];
            const qFreq = query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", todayISO));
            const freqSnap = await getDocs(qFreq);
            const checkins = freqSnap.docs.map(d => d.data());

            // 6. Configuração de tempo (usando fallback se não houver turma vinculada)
            const config = Object.values(gradesMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

            // RENDERIZAÇÃO
            renderDailyAgenda(myLessons, gradesMap, subMap, config, checkins);
            renderTablePremium(myLessons, subMap, config);

        } catch (e) {
            console.error("Erro fatal:", e);
            timetableArea.innerHTML = "<h3>Erro ao carregar dados do Firebase. Verifique o console (F12).</h3>";
        }
    } else if (user === null) {
        window.location.assign('login.html');
    }
});

function renderDailyAgenda(lessons, gradesMap, subMap, config, checkins) {
    const container = document.getElementById('dailyAgendaScroll');
    const now = new Date();
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const today = days[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();
    
    document.getElementById('todayLabel').textContent = today;
    
    if(now.getDay() === 0 || now.getDay() === 6) {
        container.innerHTML = "<p style='padding:15px;'>Bom final de semana!</p>";
        return;
    }
    
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
            const s = subMap[aula.subjectId] || {name:'Matéria', color:'#6366f1'};
            const g = gradesMap[aula.gradeId] || {name:'Turma'};
            const jaFezCheckin = checkins.some(c => c.gradeId === aula.gradeId && c.period === i);

            html += `
                <div class="agenda-card ${isNow ? 'active' : ''}" style="border-left: 5px solid ${s.color}; background: ${jaFezCheckin ? '#f0fdf4' : 'white'}; padding: 12px; margin-bottom: 10px; border-radius: 10px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <small style="color:#64748b">${times[i-1] || ''}</small><br>
                    <strong style="font-size:1rem;">${g.name}</strong><br>
                    <span style="color:${s.color}; font-weight:700;">${s.name}</span>
                    ${isNow && !jaFezCheckin ? `<button onclick="window.doCheckin('${aula.gradeId}', ${i})" style="margin-top:10px; width:100%; background:#10b981; color:white; border:none; padding:8px; border-radius:6px; cursor:pointer; font-weight:800;">📍 BATER PONTO</button>` : ''}
                    ${jaFezCheckin ? '<div style="color:#10b981; font-weight:800; font-size:0.7rem; margin-top:5px;">✓ PRESENÇA OK</div>' : ''}
                </div>`;
        }
    }
    container.innerHTML = html || "<p style='padding:15px;'>Nenhuma aula hoje.</p>";
}

function renderTablePremium(lessons, subMap, config) {
    const area = document.getElementById('timetableContent');
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const times = calculateTimeSlots(config.startTime, config.lessonDuration, 7, config.intervalAfter, config.intervalDuration);
    
    let html = `<table style="width:100%; border-collapse:collapse;"><thead><tr><th style="background:#f8fafc; padding:10px; font-size:0.7rem;">HORÁRIO</th>`;
    days.forEach(d => html += `<th style="background:#f8fafc; padding:10px; font-size:0.7rem;">${d.toUpperCase().substring(0,3)}</th>`);
    html += `</tr></thead><tbody>`;

    for (let i = 1; i <= 7; i++) {
        html += `<tr><td style="font-size:0.65rem; font-weight:700; color:#64748b; padding:10px; border-bottom:1px solid #f1f5f9;">${times[i-1] || '--:--'}</td>${days.map(d => {
            const aula = lessons.find(l => l.day === d && l.period == i);
            if (aula) {
                const s = subMap[aula.subjectId] || {name: 'Aula', color: '#6366f1'};
                return `<td style="padding:4px; border-bottom:1px solid #f1f5f9;"><div style="background:${s.color}; color:white; font-size:0.6rem; padding:6px; border-radius:6px; font-weight:700; text-align:center;">${s.name}</div></td>`;
            }
            return `<td style="background:#fcfcfc; border-bottom:1px solid #f1f5f9; border-right:1px solid #f1f5f9;"></td>`;
        }).join('')}</tr>`;
        if (i === parseInt(config.intervalAfter)) html += `<tr style="background:#f8fafc;"><td colspan="6" style="text-align:center; font-size:0.6rem; color:#94a3b8; font-weight:800; padding:4px;">INTERVALO</td></tr>`;
    }
    html += `</tbody></table>`;
    area.innerHTML = html;
}

window.doCheckin = async (gradeId, period) => {
    try {
        if (!schoolCoords.lat || schoolCoords.lat === 0) return alert("Localização da escola não definida.");
        const userLoc = await getCurrentLocation();
        const distance = calculateDistance(userLoc.lat, userLoc.lng, schoolCoords.lat, schoolCoords.lng);
        if (distance > 250) return alert(`Bloqueado: Você está fora da escola.`);
        await addDoc(collection(db, "attendance"), { schoolId, gradeId, period, teacherId: currentProfId, date: new Date().toISOString().split('T')[0], time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), timestamp: new Date().toISOString(), manual: false });
        location.reload();
    } catch (e) { alert(e.message); }
};

document.getElementById('btnLogoutProf').onclick = () => signOut(auth).then(() => window.location.assign('login.html'));
