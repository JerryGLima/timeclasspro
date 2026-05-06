import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, enableIndexedDbPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyARF0_xRnR9GxNrWGCcL3TzL0t_NypubOs",
  authDomain: "sgh-escolar-pro.firebaseapp.com",
  projectId: "sgh-escolar-pro",
  storageBucket: "sgh-escolar-pro.firebasestorage.app",
  messagingSenderId: "1025151302386",
  appId: "1:1025151302386:web:52075bdff50e1cfb592e6b"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const googleProvider = new GoogleAuthProvider();

// 🟢 ATIVANDO O CACHE OFFLINE DO FIRESTORE (Economiza as 50.000 leituras diárias)
enableIndexedDbPersistence(db).catch((err) => {
    if (err.code == 'failed-precondition') {
        console.warn("Aviso: Múltiplas abas do painel abertas. O cache funcionará na aba principal.");
    } else if (err.code == 'unimplemented') {
        console.warn("Aviso: O navegador atual não suporta cache offline, rodando normalmente.");
    }
});

// ✅ NOVA FUNÇÃO: Cria instância secundária para cadastrar professores sem deslogar o Admin
export const createSecondaryAuth = () => {
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryApp");
    return getAuth(secondaryApp);
};

// ✅ Garante persistência da sessão no localStorage
setPersistence(auth, browserLocalPersistence).catch(e => console.error("Erro persistência:", e));
