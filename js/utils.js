/**
 * utils.js - Funções utilitárias para TimeClass Pro
 * Mantido por Jerry Gleydison - Março 2026
 */

// Converte minutos totais em formato HH:MM
export const formatMinutesToHM = (totalMinutes) => {
    let h = Math.floor(totalMinutes / 60);
    let m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Calcula a grade de horários com base no início, duração e intervalo
export const calculateTimeSlots = (start, duration, totalPeriods, intervalPos, intervalDuration) => {
    let slots = [];
    if(!start) return slots;
    
    let [h, m] = start.split(':').map(Number);
    let currentTotalMinutes = h * 60 + m;
    
    const lessonDur = Number(duration);
    const interDur = Number(intervalDuration);
    
    for (let i = 1; i <= totalPeriods; i++) {
        let hStart = formatMinutesToHM(currentTotalMinutes);
        currentTotalMinutes += lessonDur;
        let hEnd = formatMinutesToHM(currentTotalMinutes);
        
        slots.push(`${hStart} - ${hEnd}`);
        
        // Adiciona o tempo de intervalo após a aula definida
        if (i === Number(intervalPos)) {
            currentTotalMinutes += interDur; 
        }
    }
    return slots;
};

// Comprime a imagem da logo para Base64 e garante fundo branco
export const compressImageToBase64 = (file, maxWidth = 350) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (e) => {
            const img = new Image();
            img.src = e.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = maxWidth / img.width;
                
                canvas.width = maxWidth;
                canvas.height = img.height * scale;
                
                const ctx = canvas.getContext('2d');
                
                // Força fundo branco (essencial para evitar fundo preto em PNGs transparentes no PDF)
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                
                // Retorna como JPEG para máxima compressão
                resolve(canvas.toDataURL('image/jpeg', 0.7)); 
            };
        };
        reader.onerror = error => reject(error);
    });
};

// Calcula distância entre dois pontos GPS (Fórmula de Haversine) em metros
export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; 
};

// Captura a localização atual do usuário via navegador
export const getCurrentLocation = () => {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            return reject(new Error("Seu navegador não suporta geolocalização."));
        }
        
        const options = {
            enableHighAccuracy: true,
            timeout: 15000, // Tempo máximo de espera: 15 segundos
            maximumAge: 0
        };

        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => {
                let msg = "Erro ao obter localização.";
                if (err.code === 1) msg = "Por favor, autorize o acesso ao GPS nas configurações do seu navegador.";
                else if (err.code === 3) msg = "O sinal do GPS está fraco. Tente novamente em local aberto.";
                reject(new Error(msg));
            },
            options
        );
    });
};
