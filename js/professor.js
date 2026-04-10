import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolId = "";

onAuthStateChanged(auth, async (user) => {
    if (user && user.email) {
        document.querySelectorAll('.currentYear').forEach(el => el.textContent = new Date().getFullYear());
        try {
            const emailB = user.email.toLowerCase().trim();
            const qProf = query(collection(db, "teachers"), where("email", "==", emailB));
            const profSnap = await getDocs(qProf);
            if (profSnap.empty) { document.getElementById('timetableContent').innerHTML = "<h3>Cadastro não localizado.</h3>"; return; }
            
            const profDoc = profSnap.docs[0];
            const profData = profDoc.data();
            currentProfId = profDoc.id;
            schoolId = profData.schoolId;

            const schoolSnap = await getDoc(doc(db, "schools", schoolId));
            const sData = schoolSnap.exists() ? schoolSnap.data() : {};
            schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };

            document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "SGH PRO";
            document.getElementById('viewProfNameProf').textContent = profData.name;
            if(sData.logoUrl) document.getElementById('schoolLogoDisplay').src = sData.logoUrl;

            const gradesSnap = await getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId)));
            const gradesMap = {}; gradesSnap.forEach(d => gradesMap[d.id] = d.data());
            const subSnap = await getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId)));
            const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());

            const qSched = query(collection(db, "schedules"), where("teacherId", "==", profDoc.id));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            const qFreq = query(collection(db, "attendance"), where("teacherId", "==", profDoc.id), where("date", "==", new Date().toISOString().split('T')[0]));
            const freqSnap = await getDocs(qFreq);
            const checkins = freqSnap.docs.map(d => d.data());

            renderDailyAgenda(myLessons, gradesMap, subMap, gradesMap[profData.vinculos[0]?.grdId], checkins);
            renderTablePremiumA4(myLessons, subMap, gradesMap[profData.vinculos[0]?.grdId]);
        } catch (e) { console.error(e); }
    } else if (user === null) window.location.assign('login.html');
});

function renderDailyAgenda(lessons, gradesMap, subMap, config, checkins) {
    const container = document.getElementById('dailyAgendaScroll');
    const label = document.getElementById('todayLabel');
    const now = new Date();
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const today = days[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();
    label.textContent = today;
    if(now.getDay() === 0 || now.getDay() === 6) { container.innerHTML = "<p>Final de semana!</p>"; return; }
    
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
                    <small>${times[i-1]}</small><strong>${g.name}</strong><span>${s.name}</span>
                    ${isNow && !jaFezCheckin ? `<button onclick="window.doCheckin('${aula.gradeId}', ${i})" style="margin-top:10px; background:#10b981; color:white; border:none; padding:8px; border-radius:8px; font-weight:700; cursor:pointer">📍 BATER PONTO</button>` : ''}
                    ${jaFezCheckin ? '<span style="color:#10b981; font-size:0.6rem; font-weight:800; margin-top:5px">✓ PRESENÇA OK</span>' : ''}
                </div>`;
        }
    }
    container.innerHTML = html || "<p>Nenhuma aula hoje.</p>";
}

window.doCheckin = async (gradeId, period) => {
    try {
        if (!schoolCoords.lat) return alert("Erro: GPS da escola não configurado.");
        const userLoc = await getCurrentLocation();
        const distance = calculateDistance(userLoc.lat, userLoc.lng, schoolCoords.lat, schoolCoords.lng);
        if (distance > 200) return alert(`Ops! Você está a ${Math.round(distance)}m da escola. O ponto só pode ser batido nas dependências da instituição.`);
        const now = new Date();
        await addDoc(collection(db, "attendance"), { schoolId, gradeId, period, teacherId: currentProfId, date: now.toISOString().split('T')[0], time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), timestamp: now.toISOString(), manual: false });
        alert("Ponto registrado!"); location.reload();
    } catch (e) { alert(e.message); }
};

function renderTablePremiumA4(lessons, subMap, config) {
    const area = document.getElementById('timetableContent');
    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const times = calculateTimeSlots(config.startTime, config.lessonDuration, 7, config.intervalAfter, config.intervalDuration);
    let html = `<table><thead><tr><th style="background:#f8fafc; color:#64748b; font-size:0.65rem; width:95px; padding: 10px;">HORÁRIO</th>`;
    days.forEach(d => html += `<th style="background:#f8fafc; color:#64748b; font-size:0.75rem; padding: 10px;">${d.toUpperCase()}</th>`);
    html += `</tr></thead><tbody>`;
    for (let i = 1; i <= 7; i++) {
        html += `<tr><td class="prof-time-col">${times[i-1] || '--:--'}</td>${days.map(d => {
            const aula = lessons.find(l => l.day === d && l.period == i);
            if (aula) {
                const s = subMap[aula.subjectId] || {name: 'Aula', color: '#6366f1'};
                return `<td style="padding:0; height:40px;"><div class="prof-subject-pill" style="background:${s.color}; color:white;">${s.name}</div></td>`;
            }
            return `<td style="background:#f1f5f9; border-radius:10px; border: 1px dashed #e2e8f0;"></td>`;
        }).join('')}</tr>`;
        if (i === parseInt(config.intervalAfter)) html += `<tr class="intervalo-row"><td colspan="6">INTERVALO</td></tr>`;
    }
    html += `</tbody></table>`;
    area.innerHTML = html;
}
document.getElementById('btnLogoutProf').onclick = () => signOut(auth).then(() => window.location.assign('login.html'));
