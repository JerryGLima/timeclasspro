import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

let currentProfId = "";
let schoolIdGlobal = "";

onAuthStateChanged(auth, async (user) => {
    const area = document.getElementById('timetableContent');
    if (!area) return;

    if (user && user.email) {
        area.innerHTML = "<p style='text-align:center;'>Buscando seu horário no servidor...</p>";
        const emailBusca = user.email.toLowerCase().trim();

        try {
            // 1. LOCALIZAR O PROFESSOR
            const qProf = query(collection(db, "teachers"), where("email", "==", emailBusca));
            const profSnap = await getDocs(qProf);

            if (profSnap.empty) {
                area.innerHTML = `<h3 style="color:red; text-align:center;">E-mail ${emailBusca} não cadastrado.</h3>`;
                return;
            }

            const profDoc = profSnap.docs[0];
            currentProfId = profDoc.id; 
            const profData = profDoc.data();
            schoolIdGlobal = profData.schoolId;

            // 2. BUSCAR DADOS DA ESCOLA E MAPAS (Promise.all para velocidade)
            const [schoolSnap, subSnap, grdSnap] = await Promise.all([
                getDoc(doc(db, "schools", schoolIdGlobal)),
                getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolIdGlobal))),
                getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolIdGlobal)))
            ]);

            const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());
            const grdMap = {}; grdSnap.forEach(d => grdMap[d.id] = d.data());

            if (schoolSnap.exists()) {
                document.getElementById('viewSchoolNameProf').textContent = schoolSnap.data().schoolName;
            }
            document.getElementById('viewProfNameProf').textContent = profData.name;

            // 3. BUSCAR A GRADE (O ponto onde pode estar falhando)
            // Tentamos buscar as aulas vinculadas ao ID do documento do professor
            const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfId));
            const schedSnap = await getDocs(qSched);
            const myLessons = schedSnap.docs.map(d => d.data());

            console.log("Aulas recuperadas:", myLessons.length);

            if (myLessons.length === 0) {
                area.innerHTML = `<p style='text-align:center; padding:20px;'>Nenhuma aula encontrada para o professor <b>${profData.name}</b>.<br>Verifique se o Administrador salvou a grade corretamente para você.</p>`;
                return;
            }

            // 4. CONFIGURAÇÃO E RENDERIZAÇÃO
            const config = Object.values(grdMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };
            
            // Limpa a área antes de desenhar
            area.innerHTML = "";
            renderDailyAgenda(myLessons, grdMap, subMap, config, []); 
            renderTablePremium(myLessons, subMap, config);

        } catch (e) {
            console.error("Erro crítico:", e);
            area.innerHTML = "<h3>Erro de comunicação com o Firebase.</h3>";
        }
    } else if (user === null) {
        window.location.assign('login.html');
    }
});
