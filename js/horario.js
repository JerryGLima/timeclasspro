// js/horario.js
import { db } from './firebase-config.js';
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

/**
 * Valida se um professor já tem aula em outra turma no mesmo momento
 */
export async function checkTeacherConflict(teacherId, day, period, currentGradeId, schoolId) {
    const q = query(
        collection(db, "schedules"),
        where("schoolId", "==", schoolId),
        where("teacherId", "==", teacherId),
        where("day", "==", day),
        where("period", "==", parseInt(period))
    );

    const snapshot = await getDocs(q);
    let hasConflict = false;

    snapshot.forEach(doc => {
        // Se encontrar um registro que não seja desta mesma série, há conflito
        if (doc.data().gradeId !== currentGradeId) {
            hasConflict = true;
        }
    });

    return hasConflict;
}
