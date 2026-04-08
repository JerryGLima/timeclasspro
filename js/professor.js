import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolId = "";

// Função principal de inicialização
async function initProfessorPanel(user) {
    const area = document.getElementById('timetableContent');
    if (!area) return;

    console.log("Iniciando carregamento para:", user.email);

    try {
        const emailBusca = user.email.toLowerCase().trim();

        // 1. Localiza o professor pelo e-mail
        const qProf = query(collection(db, "teachers"), where("email", "==", emailBusca));
        const profSnap = await getDocs(qProf);

        if (profSnap.empty) {
            console.error("E-mail não cadastrado na coleção teachers");
            area.innerHTML = `<h3 style="color:red; text-align:center;">Acesso Negado: ${emailBusca} não é um professor cadastrado.</h3>`;
            return;
        }

        const profDoc = profSnap.docs[0];
        currentProfId = profDoc.id; 
        const profData = profDoc.data();
        schoolId = profData.schoolId;

        // 2. Busca Escola (Com tratamento para erro de logo)
        try {
            const schoolSnap = await getDoc(doc(db, "schools", schoolId));
            if (schoolSnap.exists()) {
                const sData = schoolSnap.data();
                schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };
                document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "Escola";
                
                // Só tenta carregar o logo se o elemento existir e não estiver quebrado
                const logoEl = document.getElementById('schoolLogoDisplay');
                if(logoEl && sData.logoUrl) logoEl.src = sData.logoUrl;
            }
        } catch (err) { console.warn("Erro ao carregar dados da escola, mas prosseguindo..."); }

        document.getElementById('viewProfNameProf').textContent = profData.name;

        // 3. Carrega Mapas de Matérias e Turmas
        const subSnap = await getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId)));
        const grdSnap = await getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId)));

        const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());
        const grdMap = {}; grdSnap.forEach(d => grdMap[d.id] = d.data());

        // 4. Busca a Grade de Horários REAL
        const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
        const schedSnap = await getDocs(qSched);
        const myLessons = schedSnap.docs.map(d => d.data());

        console.log("Aulas encontradas para este professor:", myLessons.length);

        // 5. Busca Presenças
        const today = new Date().toISOString().split('T')[0];
        const qFreq = query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", today));
        const freqSnap = await getDocs(qFreq);
        const checkins = freqSnap.docs.map(d => d.data());

        // 6. Configuração Visual
        const config = Object.values(grdMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

        // Renderiza as tabelas
        renderDailyAgenda(myLessons, grdMap, subMap, config, checkins);
        renderTablePremium(myLessons, subMap, config);

    } catch (e) {
        console.error("Falha crítica no Firebase:", e);
        area.innerHTML = `<h3>Erro ao carregar grade: ${e.message}</h3>`;
    }
}

// Observador de Autenticação
onAuthStateChanged(auth, (user) => {
    if (user) {
        initProfessorPanel(user);
    } else {
        window.location.assign('login.html');
    }
});

// Mantenha suas funções renderDailyAgenda, renderTablePremium e doCheckin exatamente como estão.
