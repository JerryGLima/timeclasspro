import { db, auth } from './firebase-config.js';
import { collection, query, where, getDocs, doc, getDoc, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { calculateTimeSlots, getCurrentLocation, calculateDistance } from './utils.js';

// Variáveis de controle globais
let currentProfDocId = ""; 
let schoolIdGlobal = "";

async function loadDataAfterLogin(userEmail) {
    const area = document.getElementById('timetableContent');
    const emailLower = userEmail.toLowerCase().trim();
    
    console.log("Iniciando busca para o e-mail Google:", emailLower);

    try {
        // 1. Achar o documento do Professor pelo e-mail (O segredo está aqui)
        const qProf = query(collection(db, "teachers"), where("email", "==", emailLower));
        const profSnap = await getDocs(qProf);

        if (profSnap.empty) {
            console.error("E-mail não encontrado na coleção 'teachers'");
            area.innerHTML = `<h3 style="color:red; text-align:center;">Acesso Negado: O e-mail ${emailLower} não está na lista de professores cadastrados.</h3>`;
            return;
        }

        // PEGA O ID DO DOCUMENTO (não o UID do Google)
        const profDoc = profSnap.docs[0];
        currentProfDocId = profDoc.id; 
        const profData = profDoc.data();
        schoolIdGlobal = profData.schoolId;

        console.log("ID do Professor no Banco encontrado:", currentProfDocId);

        // 2. Buscar Dados da Escola
        const schoolSnap = await getDoc(doc(db, "schools", schoolIdGlobal));
        if (schoolSnap.exists()) {
            document.getElementById('viewSchoolNameProf').textContent = schoolSnap.data().schoolName || "Escola";
        }
        document.getElementById('viewProfNameProf').textContent = profData.name;

        // 3. Carregar Matérias e Turmas
        const [subSnap, grdSnap] = await Promise.all([
            getDocs(query(collection(db, "subjects"), where("schoolId", "==", schoolIdGlobal))),
            getDocs(query(collection(db, "grades"), where("schoolId", "==", schoolIdGlobal)))
        ]);

        const subMap = {}; subSnap.forEach(d => subMap[d.id] = d.data());
        const grdMap = {}; grdSnap.forEach(d => grdMap[d.id] = d.data());

        // 4. Buscar a Grade usando o ID DO DOCUMENTO DO PROFESSOR
        const qSched = query(collection(db, "schedules"), where("teacherId", "==", currentProfDocId));
        const schedSnap = await getDocs(qSched);
        const myLessons = schedSnap.docs.map(d => d.data());

        console.log("Total de aulas carregadas:", myLessons.length);

        if (myLessons.length === 0) {
            area.innerHTML = "<p style='text-align:center;'>Nenhuma aula encontrada para o seu ID de professor.</p>";
            return;
        }

        // 5. Renderização
        const config = Object.values(grdMap)[0] || { startTime: "07:15", lessonDuration: 50, intervalAfter: 3, intervalDuration: 15 };
        
        // Chamada das suas funções de desenho (renderDailyAgenda e renderTablePremium)
        // Certifique-se de que elas recebam esses dados novos
        renderDailyAgenda(myLessons, grdMap, subMap, config, []); 
        renderTablePremium(myLessons, subMap, config);

    } catch (error) {
        console.error("Erro crítico no Firebase:", error);
        area.innerHTML = "<h3>Erro técnico ao carregar dados.</h3>";
    }
}

// Escuta o login do Google
onAuthStateChanged(auth, (user) => {
    if (user) {
        loadDataAfterLogin(user.email);
    } else {
        window.location.assign('login.html');
    }
});
