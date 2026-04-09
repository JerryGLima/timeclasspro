// js/auth.js
import { auth, db, googleProvider } from './firebase-config.js';
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword,
    signInWithPopup,
    onAuthStateChanged,
    updateProfile,
    signOut
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- ELEMENTOS DA INTERFACE ---
const tabAdmin = document.getElementById('tabAdmin');
const tabProfessor = document.getElementById('tabProfessor');
const adminForm = document.getElementById('adminLoginForm');
const profArea = document.getElementById('professorLoginArea');
const errorEl = document.getElementById('errorMessage');

// --- 1. TROCA DE ABAS (ADMIN / PROFESSOR) ---
if (tabAdmin && tabProfessor) {
    tabAdmin.onclick = () => {
        tabAdmin.classList.add('active'); 
        tabProfessor.classList.remove('active');
        adminForm.classList.remove('hidden'); 
        profArea.classList.add('hidden');
        if(errorEl) errorEl.textContent = "";
    };

    tabProfessor.onclick = () => {
        tabProfessor.classList.add('active'); 
        tabAdmin.classList.remove('active');
        profArea.classList.remove('hidden'); 
        adminForm.classList.add('hidden');
        if(errorEl) errorEl.textContent = "";
    };
}

// --- 2. ALTERNAR ENTRE LOGIN E CADASTRO DE ESCOLA (MODO ADMIN) ---
let isRegisterMode = false;
const toggleBtn = document.getElementById('toggleAdminAuth');
const registerFields = document.getElementById('registerFields');
const btnSubmitAdmin = document.getElementById('btnSubmitAdmin');
const authText = document.getElementById('authText');

if (toggleBtn) {
    toggleBtn.onclick = (e) => {
        e.preventDefault();
        isRegisterMode = !isRegisterMode;
        if(registerFields) registerFields.classList.toggle('hidden');
        btnSubmitAdmin.textContent = isRegisterMode ? "Criar Minha Escola" : "Entrar no Painel";
        authText.textContent = isRegisterMode ? "Já tem conta?" : "Ainda não tem conta?";
        toggleBtn.textContent = isRegisterMode ? "Fazer Login" : "Criar conta para minha escola";
        if(errorEl) errorEl.textContent = "";
    };
}

// --- 3. SUBMISSÃO DO FORMULÁRIO ADMIN (EMAIL E SENHA) ---
if (adminForm) {
    adminForm.onsubmit = async (e) => {
        e.preventDefault();
        const email = document.getElementById('adminEmail').value;
        const password = document.getElementById('adminPassword').value;
        try {
            if (isRegisterMode) {
                const schoolName = document.getElementById('schoolName').value;
                if (!schoolName) { errorEl.textContent = "Por favor, digite o nome da escola."; return; }
                const userCred = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCred.user;
                await setDoc(doc(db, "schools", user.uid), {
                    schoolName, adminEmail: email, intervalAfter: 4, createdAt: new Date().toISOString()
                });
                await updateProfile(user, { displayName: schoolName });
                alert("Escola cadastrada com sucesso! Bem-vindo ao painel.");
            } else {
                await signInWithEmailAndPassword(auth, email, password);
            }
            window.location.assign('admin.html');
        } catch (error) {
            console.error("Erro Auth:", error.code);
            switch (error.code) {
                case 'auth/invalid-credential': errorEl.textContent = "E-mail ou senha incorretos."; break;
                case 'auth/email-already-in-use': errorEl.textContent = "Este e-mail já está sendo usado."; break;
                case 'auth/weak-password': errorEl.textContent = "A senha deve ter pelo menos 6 caracteres."; break;
                case 'auth/user-not-found': errorEl.textContent = "Usuário não encontrado."; break;
                default: errorEl.textContent = "Erro ao acessar: " + error.message;
            }
        }
    };
}

// --- 4. LOGIN DO PROFESSOR (GOOGLE COM POPUP) ---
const googleBtn = document.getElementById('googleLoginBtn');
if (googleBtn) {
    googleBtn.onclick = async () => {
        try {
            console.log("Iniciando Login Google...");
            // Configura o provider para sempre pedir conta
            googleProvider.setCustomParameters({ prompt: 'select_account' });
            const result = await signInWithPopup(auth, googleProvider);
            console.log("✅ Login Google OK:", result.user.email);
            // ✅ CORREÇÃO: redireciona DIRETAMENTE após o popup fechar com sucesso
            window.location.assign('professor.html');
        } catch (error) {
            console.error("Erro Google:", error);
            if (error.code === 'auth/popup-blocked') {
                alert("O navegador bloqueou o login. Por favor, ative os pop-ups para este site.");
            } else if (error.code === 'auth/popup-closed-by-user') {
                // Usuário fechou o popup, não faz nada
                console.log("Popup fechado pelo usuário.");
            } else {
                if(errorEl) errorEl.textContent = "Erro ao entrar com Google: " + error.message;
            }
        }
    };
}

// --- 5. MONITOR DE SESSÃO ---
onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname;

    // ✅ Só age na página de login/index
    // professor.html e admin.html cuidam da própria autenticação
    if (!path.includes('login.html') && !path.endsWith('/') && !path.includes('index.html')) {
        return;
    }

    if (user) {
        // Usuário já logado na tela de login → redireciona
        const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
        if (isGoogle) {
            window.location.assign('professor.html');
        } else {
            window.location.assign('admin.html');
        }
    }
});

// --- 6. FUNÇÃO DE LOGOUT ---
window.logoutUser = () => {
    signOut(auth).then(() => {
        window.location.assign('login.html');
    });
};
