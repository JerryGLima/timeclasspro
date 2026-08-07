// js/gerador.js
// Gerador automático de grade escolar por restrições (CSP + heurística).

const DAYS = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];
const PERIODS = [1, 2, 3, 4, 5, 6, 7];

function slotKey(day, period) {
    return `${day}|${period}`;
}

function teacherSlotKey(teacherId, day, period) {
    return `${teacherId}|${day}|${period}`;
}

function gradeSlotKey(gradeId, day, period) {
    return `${gradeId}|${day}|${period}`;
}

function subjectDayKey(gradeId, subjectId, day) {
    return `${gradeId}|${subjectId}|${day}`;
}

function teacherDayKey(teacherId, day) {
    return `${teacherId}|${day}`;
}

function normalizeAvailability(teacher) {
    const availability = {};
    for (const day of DAYS) {
        if (teacher.disponibilidade && Array.isArray(teacher.disponibilidade[day])) {
            availability[day] = teacher.disponibilidade[day]
                .map(Number)
                .filter(p => PERIODS.includes(p));
        } else if (teacher.restricoes?.includes(day)) {
            availability[day] = [];
        } else {
            availability[day] = [...PERIODS];
        }
    }
    return availability;
}

function makeRequirements(teachers) {
    const requirements = [];
    const errors = [];

    for (const teacher of teachers) {
        for (const link of teacher.vinculos || []) {
            const weeklyLessons = Number(link.weeklyLessons || link.cargaSemanal || 0);
            if (!weeklyLessons || weeklyLessons < 1) {
                errors.push(`${teacher.name}: informe a carga semanal de ${link.subName || 'disciplina'} em ${link.grdName || 'turma'}.`);
                continue;
            }

            requirements.push({
                teacherId: teacher.id,
                teacherName: teacher.name,
                gradeId: link.grdId,
                gradeName: link.grdName,
                subjectId: link.subId,
                subjectName: link.subName,
                weeklyLessons
            });
        }
    }

    return { requirements, errors };
}

function validateCapacity(requirements, teachers, grades) {
    const errors = [];
    const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]));
    const gradeMap = Object.fromEntries(grades.map(g => [g.id, g]));

    const gradeTotals = {};
    const teacherTotals = {};

    for (const req of requirements) {
        if (!gradeMap[req.gradeId]) {
            errors.push(`Turma não encontrada para ${req.teacherName} / ${req.subjectName}.`);
            continue;
        }
        gradeTotals[req.gradeId] = (gradeTotals[req.gradeId] || 0) + req.weeklyLessons;
        teacherTotals[req.teacherId] = (teacherTotals[req.teacherId] || 0) + req.weeklyLessons;
    }

    for (const [gradeId, total] of Object.entries(gradeTotals)) {
        if (total > 35) {
            errors.push(`${gradeMap[gradeId]?.name || 'Turma'} possui ${total} aulas semanais cadastradas, mas há somente 35 horários.`);
        }
    }

    for (const [teacherId, total] of Object.entries(teacherTotals)) {
        const teacher = teacherMap[teacherId];
        const availability = normalizeAvailability(teacher);
        const availableSlots = DAYS.reduce((sum, day) => sum + availability[day].length, 0);
        if (total > availableSlots) {
            errors.push(`${teacher.name} precisa ministrar ${total} aulas, mas possui apenas ${availableSlots} horários disponíveis.`);
        }
    }

    return errors;
}

function buildTasks(requirements, teachers) {
    const teacherMap = Object.fromEntries(teachers.map(t => [t.id, t]));
    const tasks = [];

    for (const req of requirements) {
        const teacher = teacherMap[req.teacherId];
        const availability = normalizeAvailability(teacher);
        const eligibleSlots = [];
        for (const day of DAYS) {
            for (const period of availability[day]) {
                eligibleSlots.push({ day, period });
            }
        }

        for (let i = 0; i < req.weeklyLessons; i++) {
            tasks.push({ ...req, occurrence: i + 1, eligibleSlots });
        }
    }

    // Primeiro, as aulas mais difíceis: professores com menos disponibilidade e cargas maiores.
    tasks.sort((a, b) => {
        const diff = a.eligibleSlots.length - b.eligibleSlots.length;
        if (diff !== 0) return diff;
        return b.weeklyLessons - a.weeklyLessons;
    });

    return tasks;
}

function countTeacherGaps(assignments, teacherId, day, extraPeriod = null) {
    const periods = assignments
        .filter(a => a.teacherId === teacherId && a.day === day)
        .map(a => a.period);
    if (extraPeriod !== null) periods.push(extraPeriod);
    const unique = [...new Set(periods)].sort((a, b) => a - b);
    if (unique.length < 2) return 0;
    let gaps = 0;
    for (let i = 1; i < unique.length; i++) gaps += Math.max(0, unique[i] - unique[i - 1] - 1);
    return gaps;
}

function candidatePenalty(task, slot, state, preferences) {
    let penalty = 0;
    const sdKey = subjectDayKey(task.gradeId, task.subjectId, slot.day);
    const tdKey = teacherDayKey(task.teacherId, slot.day);
    const sameSubjectDay = state.subjectDayCount.get(sdKey) || 0;
    const teacherDayCount = state.teacherDayCount.get(tdKey) || 0;

    if (preferences.maxSameSubjectPerDay && sameSubjectDay >= preferences.maxSameSubjectPerDay) {
        penalty += 250 + sameSubjectDay * 50;
    }

    // Favorece espalhar a mesma disciplina ao longo da semana.
    penalty += sameSubjectDay * 35;

    // Evita sobrecarregar um único dia do professor.
    penalty += teacherDayCount * 5;

    if (preferences.avoidLastPeriod && slot.period === 7) penalty += 12;

    if (preferences.avoidTeacherGaps) {
        const before = countTeacherGaps(state.assignments, task.teacherId, slot.day);
        const after = countTeacherGaps(state.assignments, task.teacherId, slot.day, slot.period);
        penalty += Math.max(0, after - before) * 18;
    }

    // Pequeno ruído para gerar alternativas diferentes quando houver empates.
    penalty += Math.random() * 4;
    return penalty;
}

function createState() {
    return {
        assignments: [],
        teacherBusy: new Set(),
        gradeBusy: new Set(),
        subjectDayCount: new Map(),
        teacherDayCount: new Map()
    };
}

function canPlace(task, slot, state) {
    if (state.teacherBusy.has(teacherSlotKey(task.teacherId, slot.day, slot.period))) return false;
    if (state.gradeBusy.has(gradeSlotKey(task.gradeId, slot.day, slot.period))) return false;
    return true;
}

function place(task, slot, state) {
    const assignment = {
        schoolId: task.schoolId,
        gradeId: task.gradeId,
        teacherId: task.teacherId,
        subjectId: task.subjectId,
        day: slot.day,
        period: slot.period
    };
    state.assignments.push(assignment);
    state.teacherBusy.add(teacherSlotKey(task.teacherId, slot.day, slot.period));
    state.gradeBusy.add(gradeSlotKey(task.gradeId, slot.day, slot.period));

    const sdKey = subjectDayKey(task.gradeId, task.subjectId, slot.day);
    const tdKey = teacherDayKey(task.teacherId, slot.day);
    state.subjectDayCount.set(sdKey, (state.subjectDayCount.get(sdKey) || 0) + 1);
    state.teacherDayCount.set(tdKey, (state.teacherDayCount.get(tdKey) || 0) + 1);
}

function unplace(task, slot, state) {
    state.assignments.pop();
    state.teacherBusy.delete(teacherSlotKey(task.teacherId, slot.day, slot.period));
    state.gradeBusy.delete(gradeSlotKey(task.gradeId, slot.day, slot.period));

    const sdKey = subjectDayKey(task.gradeId, task.subjectId, slot.day);
    const tdKey = teacherDayKey(task.teacherId, slot.day);
    const sd = (state.subjectDayCount.get(sdKey) || 1) - 1;
    const td = (state.teacherDayCount.get(tdKey) || 1) - 1;
    if (sd <= 0) state.subjectDayCount.delete(sdKey); else state.subjectDayCount.set(sdKey, sd);
    if (td <= 0) state.teacherDayCount.delete(tdKey); else state.teacherDayCount.set(tdKey, td);
}

function solve(tasks, preferences, maxNodes = 300000) {
    const state = createState();
    let nodes = 0;

    function recurse(index) {
        nodes++;
        if (nodes > maxNodes) return false;
        if (index >= tasks.length) return true;

        // Escolhe dinamicamente, entre uma pequena janela, a tarefa com menos opções livres.
        let bestIndex = index;
        let bestCount = Infinity;
        const scanEnd = Math.min(tasks.length, index + 30);
        for (let i = index; i < scanEnd; i++) {
            const count = tasks[i].eligibleSlots.reduce((n, s) => n + (canPlace(tasks[i], s, state) ? 1 : 0), 0);
            if (count < bestCount) {
                bestCount = count;
                bestIndex = i;
                if (count === 0) break;
            }
        }
        if (bestCount === 0) return false;

        [tasks[index], tasks[bestIndex]] = [tasks[bestIndex], tasks[index]];
        const task = tasks[index];
        const candidates = task.eligibleSlots
            .filter(slot => canPlace(task, slot, state))
            .map(slot => ({ slot, score: candidatePenalty(task, slot, state, preferences) }))
            .sort((a, b) => a.score - b.score);

        for (const { slot } of candidates) {
            place(task, slot, state);
            if (recurse(index + 1)) return true;
            unplace(task, slot, state);
        }

        [tasks[index], tasks[bestIndex]] = [tasks[bestIndex], tasks[index]];
        return false;
    }

    return { success: recurse(0), assignments: state.assignments, nodes };
}

function scoreSchedule(assignments, preferences) {
    let penalty = 0;
    const subjectDays = new Map();
    const teacherDays = new Map();

    for (const a of assignments) {
        const sd = subjectDayKey(a.gradeId, a.subjectId, a.day);
        const td = teacherDayKey(a.teacherId, a.day);
        subjectDays.set(sd, (subjectDays.get(sd) || 0) + 1);
        if (!teacherDays.has(td)) teacherDays.set(td, []);
        teacherDays.get(td).push(a.period);
        if (preferences.avoidLastPeriod && a.period === 7) penalty += 2;
    }

    for (const count of subjectDays.values()) {
        if (count > (preferences.maxSameSubjectPerDay || 2)) penalty += (count - preferences.maxSameSubjectPerDay) * 12;
        if (count > 1) penalty += (count - 1) * 2;
    }

    if (preferences.avoidTeacherGaps) {
        for (const periods of teacherDays.values()) {
            const unique = [...new Set(periods)].sort((a, b) => a - b);
            for (let i = 1; i < unique.length; i++) penalty += Math.max(0, unique[i] - unique[i - 1] - 1) * 3;
        }
    }

    return Math.max(0, Math.round(100 - penalty / Math.max(1, assignments.length) * 3));
}

export function generateAutomaticSchedule({ schoolId, teachers, grades, preferences = {} }) {
    const opts = {
        maxSameSubjectPerDay: Number(preferences.maxSameSubjectPerDay || 2),
        avoidTeacherGaps: preferences.avoidTeacherGaps !== false,
        avoidLastPeriod: preferences.avoidLastPeriod === true
    };

    const { requirements, errors: reqErrors } = makeRequirements(teachers);
    const errors = [...reqErrors, ...validateCapacity(requirements, teachers, grades)];
    if (errors.length) return { success: false, errors };
    if (!requirements.length) return { success: false, errors: ['Nenhuma carga horária semanal foi cadastrada nos vínculos dos professores.'] };

    let best = null;
    // Várias tentativas ajudam a encontrar uma solução melhor quando existem muitas combinações equivalentes.
    for (let attempt = 0; attempt < 8; attempt++) {
        const tasks = buildTasks(requirements, teachers).map(t => ({ ...t, schoolId }));
        const result = solve(tasks, opts);
        if (!result.success) continue;
        const quality = scoreSchedule(result.assignments, opts);
        if (!best || quality > best.quality) best = { ...result, quality };
        if (quality >= 95) break;
    }

    if (!best) {
        return {
            success: false,
            errors: ['Não foi possível encontrar uma grade completa com as disponibilidades atuais. Verifique professores com poucos horários disponíveis ou cargas muito concentradas.']
        };
    }

    return {
        success: true,
        assignments: best.assignments,
        quality: best.quality,
        totalLessons: best.assignments.length,
        requirements
    };
}

export { DAYS, PERIODS, normalizeAvailability };
