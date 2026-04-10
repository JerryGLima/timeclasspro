import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyARF0_xRnR9GxNrWGCcL3TzL0t_NypubOs",
  // ✅ CORREÇÃO: usar o domínio do GitHub Pages como authDomain
  authDomain: "jerryglima.github.io",
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

// ✅ Garante que a sessão persiste entre páginas
setPersistence(auth, browserLocalPersistence).catch(e => console.error("Erro persistência:", e));
