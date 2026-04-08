import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let schoolCoords = { lat: 0, lng: 0 };
let currentProfId = "";
let schoolId = "";

onAuthStateChanged(auth, async (user) => {
    const area = document.getElementById('timetableContent');
    if (user && user.email) {
        try {
            const emailBusca = user.email.toLowerCase().trim();
            console.log("Logado como:", emailBusca);

            // 1. Localiza o documento do professor pelo e-mail
            const qProf = query(collection(db, "teachers"), where("email", "==", emailBusca));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) {
                area.innerHTML = `<h3 style="color:red; text-align:center;">E-mail ${emailBusca} não encontrado na lista de professores.</h3>`;
                return;
            }

            // PEGA O ID REAL DO DOCUMENTO (Fundamental para carregar a grade)
            const profDoc = profSnap.docs[0];
            currentProfId = profDoc.id; // <--- O SEGREDO ESTÁ AQUI
            const profData = profDoc.data();
            schoolId = profData.schoolId;

            console.log("ID do Professor no Banco:", currentProfId);

            // 2. Carrega Dados da Escola
            const schoolSnap = await getDoc(doc(db, "schools", schoolId));
            const sData = schoolSnap.exists() ? schoolSnap.data() : {};
            schoolCoords = { lat: sData.latitude || 0, lng: sData.longitude || 0 };
            document.getElementById('viewSchoolNameProf').textContent = sData.schoolName || "Escola";
            document.getElementById('viewProfNameProf').textContent = profData.name;

            // 3. Carrega Mapas (Matérias e Turmas)
            const [subSnap, grdSnap] = await Promise.all([
                getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolId))),
                getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolId)))
            ]);

            const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());
            const grdMap = {}; grdSnap.forEach(d => grdMap[d.id] = d.data());

            // 4. Busca a Grade usando o ID DO DOCUMENTO
            const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            console.log("Aulas encontradas:", myLessons.length);

            // 5. Busca Frequência do dia
            const qFreq = query(collection(db, "attendance"), where("teacherId", "==", currentProfId), where("date", "==", new Date().toISOString().split('T')[0]));
            const freqSnap = await getDocs(qFreq);
            const checkins = freqSnap.docs.map(d => d.data());

            const config = Object.values(grdMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };

            renderDailyAgenda(myLessons, grdMap, subMap, config, checkins);
            renderTablePremium(myLessons, subMap, config);

        } catch (e) {
            console.error("Erro Geral:", e);
            area.innerHTML = "<h3>Erro ao conectar com o banco de dados.</h3>";
        }
    } else if (user === null) {
        window.location.assign('login.html');
    }
});

// Mantenha as suas funções renderDailyAgenda, renderTablePremium e doCheckin abaixo sem alterações.
