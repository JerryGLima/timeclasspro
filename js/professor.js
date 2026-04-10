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
        const timetableArea = document.getElementById('timetableContent');
        
        try {
            const emailB = user.email.toLowerCase().trim();
            console.log("✅ Usuário logado:", user.email);

            // 1. BUSCA O PROFESSOR E VALIDA ACESSO
            const qProf = query(collection(db, "teachers"), where("email", "==", emailB));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) {
                // ⚠️ AVISO DE PROFESSOR NÃO CADASTRADO
                timetableArea.innerHTML = `
                    <div style="padding: 40px; text-align: center; background: white; border-radius: 20px; border: 1px solid #fee2e2; max-width: 500px; margin: 40px auto; box-shadow: 0 10px 15px rgba(0,0,0,0.05);">
                        <div style="font-size: 3rem; margin-bottom: 20px;">🚫</div>
                        <h3 style="color: #ef4444; margin-bottom: 10px; font-weight: 800;">Acesso Não Autorizado</h3>
                        <p style="color: #64748b; margin-bottom: 20px;">O e-mail <strong>${emailB}</strong> não foi encontrado na lista de professores autorizados.</p>
                        <div style="background: #f8fafc; padding: 15px; border-radius: 12px; font-size: 0.85rem; color: #475569; text-align: left; line-height: 1.5;">
                            <strong>Como resolver?</strong><br>
                            1. Verifique se logou com o e-mail correto.<br>
                            2. Peça ao administrador para confirmar seu cadastro na escola.<br>
                            3. Certifique-se de que não existem espaços extras no e-mail cadastrado.
                        </div>
                        <button onclick="auth.signOut().then(() => window.location.reload())" style="margin-top: 25px; background: #0f172a; color: white; border: none; padding: 12px 24px; border-radius: 12px; font-weight: 700; cursor: pointer;">Tentar outro e-mail</button>
                    </div>`;
                document.getElementById('viewProfNameProf').textContent = "Acesso Negado";
                return;
            }
            
            const profDoc = profSnap.docs[0];
            const profData = profDoc.data();
            currentProfId = profDoc.id;
            currentProfName = profData.name;
            schoolId = profData.schoolId;

            // 2. CARREGAMENTO EM CASCATA (Garante autonomia sem o Admin aberto)
            const [schoolSnap, gradesSnap, subjectsSnap] = await Promise.all([
                getDoc(doc(db, "schools", schoolId)),
                getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId))),
                getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId)))
            ]);

            const sData = schoolSnap.exists() ? schoolSnap.data() : {};
            schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };
            
            const gradesMap = {}; gradesSnap.forEach(d => gradesMap[d.id] = d.data());
            const subMap = {}; subjectsSnap.forEach(d => subMap[d.id] = d.data());

            // Atualiza Interface Principal
            document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "SGH PRO";
            document.getElementById('viewProfNameProf').textContent = currentProfName;
            if(sData.logoUrl) document.getElementById('schoolLogoDisplay').src = sData.logoUrl;

            // 3. BUSCA AULAS E FREQUÊNCIA
            const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            const today = new Date().toISOString().split('T')[0];
            const qFreq = query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", today));
            const freqSnap = await getDocs(qFreq);
            const checkins = freqSnap.docs.map(d => d.data());

            if (myLessons.length === 0) {
                timetableArea.innerHTML = `<div style="padding: 30px; text-align: center; color: #64748b;"><h3>📭 Nenhuma aula vinculada ao seu perfil.</h3></div>`;
                return;
            }

            // Define a configuração de horário (Pega a primeira turma do prof ou a primeira da escola)
            const firstGradeId = profData.vinculos?.[0]?.grdId || Object.keys(gradesMap)[0];
            const config = gradesMap[firstGradeId] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

            // 4. RENDERIZAÇÃO
            renderDailyAgenda(myLessons, gradesMap, subMap, config, checkins);
            renderTablePremium(myLessons, subMap, config);

        } catch (e) {
            console.error("❌ Erro:", e);
            timetableArea.innerHTML = `<div style="padding: 30px; text-align: center; color: #ef4444;"><h3>Erro de Conexão</h3><p>${e.message}</p></div>`;
        }
    } else if (user === null) {
        window.location.assign('login.html');
    }
});

// --- FUNÇÕES DE RENDERIZAÇÃO (Mantidas conforme seu original funcional) ---

function renderDailyAgenda(lessons, gradesMap, subMap, config, checkins) {
    const container = document.getElementById('dailyAgendaScroll');
    const now = new Date();
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    const today = days[now.getDay()];
    const currentMins = now.getHours() * 60 + now.getMinutes();
    document.getElementById('todayLabel').textContent = today;
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

function renderTablePremium(lessons, subMap, config) {
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

window.doCheckin = async (gradeId, period) => {
    try {
        if (!schoolCoords.lat) return alert("GPS da escola não configurado.");
        const userLoc = await getCurrentLocation();
        const distance = calculateDistance(userLoc.lat, userLoc.lng, schoolCoords.lat, schoolCoords.lng);
        if (distance > 200) return alert(`Você está fora da escola.`);
        const now = new Date();
        await addDoc(collection(db, "attendance"), { schoolId, gradeId, period, teacherId: currentProfId, date: now.toISOString().split('T')[0], time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), timestamp: now.toISOString(), manual: false });
        location.reload();
    } catch (e) { alert(e.message); }
};

document.getElementById('btnDownloadPdf').onclick = () => {
    const element = document.getElementById('printArea');
    const footer = document.getElementById('pdfFooterProf');
    footer.style.display = 'block';
    const opt = {
        margin: [5, 5, 5, 5],
        filename: `Horario_${currentProfName}.pdf`,
        image: { type: 'jpeg', quality: 1 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    };
    html2pdf().from(element).set(opt).save().then(() => { footer.style.display = 'none'; });
};

document.getElementById('btnLogoutProf').onclick = () => signOut(auth).then(() => window.location.assign('login.html'));
