import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolIdGlobal = "";
let currentProfName = "";

onAuthStateChanged(auth, async (user) => {
    const area = document.getElementById('timetableContent');
    if (user && user.email) {
        console.log("Autenticado como:", user.email);
        document.querySelectorAll('.currentYear').forEach(el => el.textContent = new Date().getFullYear());
        
        try {
            const emailBusca = user.email.toLowerCase().trim();

            // 1. LOCALIZAR PROFESSOR (PASSO CRÍTICO)
            const qProf = query(collection(db, "teachers"), where("email", "==", emailBusca));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) {
                area.innerHTML = `<h3 style="color:#ef4444; text-align:center; padding:20px;">Acesso Negado: E-mail ${emailBusca} não cadastrado.</h3>`;
                return;
            }

            const profDoc = profSnap.docs[0];
            currentProfId = profDoc.id; 
            const profData = profDoc.data();
            schoolIdGlobal = profData.schoolId;
            currentProfName = profData.name;

            // 2. BUSCAR DADOS DA ESCOLA
            const schoolSnap = await getDoc(doc(db, "schools", schoolIdGlobal));
            if (schoolSnap.exists()) {
                const sData = schoolSnap.data();
                schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };
                document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "TimeClass Pro";
                if(sData.logoUrl) document.getElementById('schoolLogoDisplay').src = sData.logoUrl;
            }
            document.getElementById('viewProfNameProf').textContent = currentProfName;

            // 3. CARREGAR MAPAS (SÓ AVANÇA QUANDO TIVER OS DOIS)
            const [subSnap, grdSnap] = await Promise.all([
                getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolIdGlobal))),
                getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolIdGlobal)))
            ]);

            const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());
            const grdMap = {}; grdSnap.forEach(d => grdMap[d.id] = d.data());

            // 4. BUSCAR AULAS E FREQUÊNCIA
            const [schedSnap, freqSnap] = await Promise.all([
                getDocs(query(collection(db, "schedules"), where("teacherId", "==", currentProfId))),
                getDocs(query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", new Date().toISOString().split('T')[0])))
            ]);

            const myLessons = schedSnap.docs.map(d => d.data());
            const checkins = freqSnap.docs.map(d => d.data());

            console.log("Aulas carregadas:", myLessons.length);

            // 5. CONFIGURAÇÃO DE TEMPO
            // Busca a config da primeira turma que o prof tem aula, ou a primeira da escola
            const firstGradeId = myLessons[0]?.gradeId || Object.keys(grdMap)[0];
            const config = grdMap[firstGradeId] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

            // 6. RENDERIZAR
            renderDailyAgenda(myLessons, grdMap, subMap, config, checkins);
            renderTablePremium(myLessons, subMap, config);

        } catch (e) {
            console.error("Erro fatal no carregamento:", e);
            area.innerHTML = `<h3 style="text-align:center;">Erro ao carregar dados. <br><small>${e.message}</small></h3>`;
        }
    } else if (user === null) {
        window.location.assign('login.html');
    }
});

// Mantenha suas funções renderDailyAgenda, renderTablePremium e doCheckin abaixo.
// ELAS ESTÃO CORRETAS NO SEU ARQUIVO, mas certifique-se que o doCheckin use a variável 'currentProfId' capturada acima.
