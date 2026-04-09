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
        // Estilo das abas
        tabAdmin.classList.add('active'); 
        tabProfessor.classList.remove('active');
        // Visibilidade dos formulários
        adminForm.classList.remove('hidden'); 
        profArea.classList.add('hidden');
        // Limpar erros ao trocar
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
        
        // Exibe/Esconde campo de Nome da Escola
        if(registerFields) registerFields.classList.toggle('hidden');
        
        // Altera textos da tela
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
                // --- MODO CADASTRO ---
                const schoolName = document.getElementById('schoolName').value;
                if (!schoolName) {
                    errorEl.textContent = "Por favor, digite o nome da escola.";
                    return;
                }

                const userCred = await createUserWithEmailAndPassword(auth, email, password);
                const user = userCred.user;

                // Cria o documento da escola no Firestore vinculado ao UID do Admin
                await setDoc(doc(db, "schools", user.uid), {
                    schoolName: schoolName,
                    adminEmail: email,
                    intervalAfter: 4, // Configuração padrão inicial
                    createdAt: new Date().toISOString()
                });

                // Atualiza o perfil do usuário com o nome da escola
                await updateProfile(user, { displayName: schoolName });
                
                alert("Escola cadastrada com sucesso! Bem-vindo ao painel.");
            } else {
                // --- MODO LOGIN ---
                await signInWithEmailAndPassword(auth, email, password);
            }
            
            // Redireciona para o Admin
            window.location.assign('admin.html');

        } catch (error) {
            console.error("Erro Auth:", error.code);
            
            // Tratamento de erros comuns para o usuário
            switch (error.code) {
                case 'auth/invalid-credential':
                    errorEl.textContent = "E-mail ou senha incorretos. Se você nunca acessou como admin, crie uma conta para sua escola.";
                    break;
                case 'auth/email-already-in-use':
                    errorEl.textContent = "Este e-mail já está sendo usado por outra escola.";
                    break;
                case 'auth/weak-password':
                    errorEl.textContent = "A senha deve ter pelo menos 6 caracteres.";
                    break;
                case 'auth/user-not-found':
                    errorEl.textContent = "Usuário não encontrado. Verifique os dados ou crie uma conta.";
                    break;
                default:
                    errorEl.textContent = "Erro ao acessar: " + error.message;
            }
        }
    };
}

// --- 4. LOGIN DO PROFESSOR (GOOGLE) ---
const googleBtn = document.getElementById('googleLoginBtn');
if (googleBtn) {
    googleBtn.onclick = async () => {
        try {
            console.log("Iniciando Login Google...");
            await signInWithPopup(auth, googleProvider);
            // Redireciona para o painel do professor
            window.location.assign('professor.html');
        } catch (error) {
            console.error("Erro Google:", error);
            if (error.code === 'auth/popup-blocked') {
                alert("O navegador bloqueou o login. Por favor, ative os pop-ups para este site.");
            } else {
                errorEl.textContent = "Erro ao entrar com Google: " + error.message;
            }
        }
    };
}

// --- 5. MONITOR DE SESSÃO (REDIRECIONAMENTO AUTOMÁTICO) ---
onAuthStateChanged(auth, (user) => {
    const path = window.location.pathname;

    if (user) {
        // Se o usuário já está logado e está na tela de login ou index, manda para o painel
        if (path.includes('login.html') || path.endsWith('/') || path.includes('index.html')) {
            // Se o login foi via Google, mandamos para o painel do Professor
            const isGoogle = user.providerData.some(p => p.providerId === 'google.com');
            if (isGoogle) {
                window.location.assign('professor.html');
            } else {
                window.location.assign('admin.html');
            }
        }
    } else {
        // Se NÃO está logado e tenta acessar páginas restritas, manda para o login
        if (path.includes('admin.html') || path.includes('professor.html')) {
            window.location.assign('login.html');
        }
    }
});

// --- 6. FUNÇÃO DE LOGOUT (Disponível para os botões "Sair") ---
window.logoutUser = () => {
    signOut(auth).then(() => {
        window.location.assign('login.html');
    });
};
