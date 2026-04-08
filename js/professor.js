import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolId = "";
let currentProfName = "";

onAuthStateChanged(auth, async (user) => {
    if (user && user.email) {
        document.querySelectorAll('.currentYear').forEach(el => el.textContent = new Date().getFullYear());
        try {
            // 1. Normalização do E-mail para busca precisa
            const emailB = user.email.toLowerCase().trim();
            console.log("Iniciando busca para:", emailB);

            // 2. Localizar o Professor pelo e-mail na coleção 'teachers'
            const qProf = query(collection(db, "teachers"), where("email", "==", emailB));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) { 
                console.error("Cadastro não encontrado para o e-mail:", emailB);
                document.getElementById('timetableContent').innerHTML = `<h3 style="color:#ef4444; text-align:center; padding:20px;">Cadastro não localizado para o e-mail: ${emailB}</h3>`; 
                return; 
            }
            
            const profDoc = profSnap.docs[0];
            const profData = profDoc.data();
            currentProfId = profDoc.id; // Este é o ID que o schedules usa
            currentProfName = profData.name;
            schoolId = profData.schoolId;

            // 3. Buscar Dados da Escola (GPS e Nome)
            const schoolSnap = await getDoc(doc(db, "schools", schoolId));
            const sData = schoolSnap.exists() ? schoolSnap.data() : {};
            schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };

            document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "SGH PRO";
            document.getElementById('viewProfNameProf').textContent = currentProfName;
            if(sData.logoUrl) document.getElementById('schoolLogoDisplay').src = sData.logoUrl;

            // 4. Carregar Mapas de Apoio (Turmas e Matérias)
            const gradesSnap = await getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId)));
            const gradesMap = {}; 
            gradesSnap.forEach(d => gradesMap[d.id] = d.data());

            const subSnap = await getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId)));
            const subMap = {}; 
            subSnap.forEach(d => subMap[d.id] = d.data());

            // 5. Buscar Aulas (Schedules) usando o ID do documento do professor
            const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            // 6. Buscar Presenças do dia
            const todayISO = new Date().toISOString().split('T')[0];
            const qFreq = query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", todayISO));
            const freqSnap = await getDocs(qFreq);
            const checkins = freqSnap.docs.map(d => d.data());

            // 7. Configuração de horário (usa a primeira turma vinculada como base)
            const firstGradeConfig = gradesMap[profData.vinculos?.[0]?.grdId] || Object.values(gradesMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

            // 8. Renderização das interfaces
            renderDailyAgenda(myLessons, gradesMap, subMap, firstGradeConfig, checkins);
            renderTablePremium(myLessons, subMap, firstGradeConfig);

        } catch (e) { 
            console.error("Erro no processamento do professor:", e);
            document.getElementById('timetableContent').innerHTML = "<h3>Erro ao carregar dados. Verifique sua conexão.</h3>";
        }
    } else if (user === null) {
        window.location.assign('login.html');
    }
});

function renderDailyAgenda(lessons, gradesMap, subMap, config, checkins) {
    const container = document.getElementById('dailyAgendaScroll');
    if (!container) return;

    const now = new Date();
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const today = days[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();
    
    document.getElementById('todayLabel').textContent = today;
    
    if(now.getDay() === 0 || now.getDay() === 6) { 
        container.innerHTML = "<p style='text-align:center; padding:20px; color:#64748b;'>Bom descanso! Final de semana.</p>"; 
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
                <div class="agenda-card ${isNow ? 'active' : ''}" style="border-left: 5px solid ${s.color}; background: ${jaFezCheckin ? '#f0fdf4' : 'white'}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <div>
                            <small style="display:block; color:#64748b; font-weight:600;">${times[i-1] || 'Horário'}</small>
                            <strong style="display:block; font-size:1.1rem; color:#1e293b; margin:2px 0;">${g.name}</strong>
                            <span style="color:${s.color}; font-weight:700; font-size:0.85rem;">${s.name}</span>
                        </div>
                    </div>
                    ${isNow && !jaFezCheckin ? `<button onclick="window.doCheckin('${aula.gradeId}', ${i})" style="margin-top:12px; width:100%; background:#10b981; color:white; border:none; padding:10px; border-radius:8px; font-weight:800; cursor:pointer; box-shadow: 0 4px 6px -1px rgba(16, 185, 129, 0.2);">📍 BATER PONTO AGORA</button>` : ''}
                    ${jaFezCheckin ? '<div style="margin-top:10px; display:flex; align-items:center; gap:5px; color:#10b981; font-size:0.7rem; font-weight:800;"><span>✅ PRESENÇA REGISTRADA</span></div>' : ''}
                </div>`;
        }
    }
    container.innerHTML = html || "<p style='text-align:center; padding:20px; color:#64748b;'>Você não tem aulas agendadas para hoje.</p>";
}

window.doCheckin = async (gradeId, period) => {
    try {
        if (!schoolCoords.lat || schoolCoords.lat === 0) return alert("Erro: Localização da escola não configurada pelo administrador.");
        
        const userLoc = await getCurrentLocation();
        const distance = calculateDistance(userLoc.lat, userLoc.lng, schoolCoords.lat, schoolCoords.lng);
        
        console.log(`Distância calculada: ${distance.toFixed(2)} metros`);

        if (distance > 250) { // Tolerância de 250 metros
            return alert(`Bloqueado: Você está a ${Math.round(distance)}m da escola. O limite é 200m.`);
        }

        const now = new Date();
        await addDoc(collection(db, "attendance"), { 
            schoolId, 
            gradeId, 
            period, 
            teacherId: currentProfId, 
            date: now.toISOString().split('T')[0], 
            time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
            timestamp: now.toISOString(), 
            manual: false 
        });

        alert("✓ Ponto batido com sucesso!");
        location.reload();
    } catch (e) { 
        alert("Erro ao bater ponto: " + e.message); 
    }
};

function renderTablePremium(lessons, subMap, config) {
    const area = document.getElementById('timetableContent');
    if (!area) return;

    const days = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
    const times = calculateTimeSlots(config.startTime, config.lessonDuration, 7, config.intervalAfter, config.intervalDuration);
    
    let html = `<table><thead><tr><th style="background:#f8fafc; color:#64748b; font-size:0.65rem; width:100px;">HORÁRIO</th>`;
    days.forEach(d => html += `<th style="background:#f8fafc; color:#64748b; font-size:0.7rem;">${d.toUpperCase()}</th>`);
    html += `</tr></thead><tbody>`;

    for (let i = 1; i <= 7; i++) {
        html += `<tr><td class="prof-time-col">${times[i-1] || '--:--'}</td>${days.map(d => {
            const aula = lessons.find(l => l.day === d && l.period == i);
            if (aula) {
                const s = subMap[aula.subjectId] || {name: 'Aula', color: '#6366f1'};
                return `<td style="padding:4px;"><div class="prof-subject-pill" style="background:${s.color}; color:white; font-size:0.6rem; padding:8px; border-radius:6px; font-weight:700; text-align:center; min-height:35px; display:flex; align-items:center; justify-content:center;">${s.name}</div></td>`;
            }
            return `<td style="background:#f8fafc; border: 1px dashed #e2e8f0; border-radius:6px;"></td>`;
        }).join('')}</tr>`;

        if (i === parseInt(config.intervalAfter)) {
            html += `<tr class="intervalo-row"><td colspan="6" style="background:#f1f5f9; color:#94a3b8; font-size:0.6rem; font-weight:800; letter-spacing:2px;">INTERVALO</td></tr>`;
        }
    }
    html += `</tbody></table>`;
    area.innerHTML = html;
}

document.getElementById('btnDownloadPdf').onclick = () => {
    const element = document.getElementById('printArea');
    const footer = document.getElementById('pdfFooterProf');
    if(footer) footer.style.display = 'block';

    const opt = {
        margin: [5, 5, 5, 5],
        filename: `Horario_${currentProfName}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };

    html2pdf().from(element).set(opt).save().then(() => {
        if(footer) footer.style.display = 'none';
    });
};

const btnLogout = document.getElementById('btnLogoutProf');
if(btnLogout) btnLogout.onclick = () => signOut(auth).then(() => window.location.assign('login.html'));
