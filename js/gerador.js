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
    const diagnostics = [];
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
        const name = gradeMap[gradeId]?.name || 'Turma';
        if (total > 35) {
            errors.push(`${name} possui ${total} aulas semanais cadastradas, mas há somente 35 horários.`);
            diagnostics.push({
                severity: 'critical',
                type: 'grade_overload',
                title: `${name}: carga acima da capacidade`,
                message: `A turma possui ${total} aulas para apenas 35 horários semanais.`,
                suggestion: `Reduza pelo menos ${total - 35} aula(s) da carga semanal dessa turma.`
            });
        } else if (total < 35) {
            diagnostics.push({
                severity: 'info',
                type: 'grade_underload',
                title: `${name}: ${35 - total} horário(s) livre(s)`,
                message: `Foram cadastradas ${total} de 35 aulas semanais.`,
                suggestion: 'Isso não impede a geração; os demais horários permanecerão vagos.'
            });
        }
    }

    for (const [teacherId, total] of Object.entries(teacherTotals)) {
        const teacher = teacherMap[teacherId];
        if (!teacher) continue;
        const availability = normalizeAvailability(teacher);
        const availableSlots = DAYS.reduce((sum, day) => sum + availability[day].length, 0);
        if (total > availableSlots) {
            const shortage = total - availableSlots;
            errors.push(`${teacher.name} precisa ministrar ${total} aulas, mas possui apenas ${availableSlots} horários disponíveis.`);
            diagnostics.push({
                severity: 'critical',
                type: 'teacher_capacity',
                teacherId,
                title: `${teacher.name}: faltam ${shortage} horário(s)`,
                message: `Carga semanal: ${total} aulas. Disponibilidade: ${availableSlots} horários.`,
                suggestion: `Libere pelo menos ${shortage} novo(s) horário(s) na disponibilidade do professor.`
            });
        }
    }

    return { errors, diagnostics };
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

function exceedsConsecutiveSubjectLimit(task, slot, state, maxConsecutiveSameSubject) {
    const limit = Number(maxConsecutiveSameSubject || 0);
    if (!limit) return false;

    const periods = state.assignments
        .filter(a => a.gradeId === task.gradeId && a.subjectId === task.subjectId && a.day === slot.day)
        .map(a => a.period);
    periods.push(slot.period);

    const unique = [...new Set(periods)].sort((a, b) => a - b);
    let run = 1;
    let maxRun = 1;
    for (let i = 1; i < unique.length; i++) {
        if (unique[i] === unique[i - 1] + 1) run++;
        else run = 1;
        if (run > maxRun) maxRun = run;
    }
    return maxRun > limit;
}

function canPlace(task, slot, state, preferences = {}) {
    if (state.teacherBusy.has(teacherSlotKey(task.teacherId, slot.day, slot.period))) return false;
    if (state.gradeBusy.has(gradeSlotKey(task.gradeId, slot.day, slot.period))) return false;
    if (exceedsConsecutiveSubjectLimit(task, slot, state, preferences.maxConsecutiveSameSubject)) return false;
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

function solve(tasks, preferences, maxNodes = 300000, onProgress = null) {
    const state = createState();
    let nodes = 0;

    function recurse(index) {
        nodes++;
        if (onProgress && nodes % 5000 === 0) onProgress({ nodes, maxNodes });
        if (nodes > maxNodes) return false;
        if (index >= tasks.length) return true;

        // Escolhe dinamicamente, entre uma pequena janela, a tarefa com menos opções livres.
        let bestIndex = index;
        let bestCount = Infinity;
        const scanEnd = Math.min(tasks.length, index + 30);
        for (let i = index; i < scanEnd; i++) {
            const count = tasks[i].eligibleSlots.reduce((n, s) => n + (canPlace(tasks[i], s, state, preferences) ? 1 : 0), 0);
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
            .filter(slot => canPlace(task, slot, state, preferences))
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
        // Continua preferindo distribuir a disciplina na semana, sem proibir várias aulas no mesmo dia.
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

function taskIdentity(task) {
    return `${task.teacherId}|${task.gradeId}|${task.subjectId}`;
}

function copyState(state) {
    return {
        assignments: state.assignments.map(a => ({ ...a })),
        teacherBusy: new Set(state.teacherBusy),
        gradeBusy: new Set(state.gradeBusy),
        subjectDayCount: new Map(state.subjectDayCount),
        teacherDayCount: new Map(state.teacherDayCount)
    };
}

function buildPartialSchedule(tasks, preferences, attempts = 50, onProgress = null) {
    let best = { assignments: [], pending: tasks };

    for (let attempt = 0; attempt < attempts; attempt++) {
        if (onProgress && attempt % 2 === 0) onProgress({ attempt: attempt + 1, attempts });
        const state = createState();
        const ordered = [...tasks].sort((a, b) => {
            const ad = a.eligibleSlots.length + Math.random() * 2;
            const bd = b.eligibleSlots.length + Math.random() * 2;
            return ad - bd || b.weeklyLessons - a.weeklyLessons;
        });
        const pending = [];

        for (const task of ordered) {
            const candidates = task.eligibleSlots
                .filter(slot => canPlace(task, slot, state, preferences))
                .map(slot => ({ slot, score: candidatePenalty(task, slot, state, preferences) }))
                .sort((a, b) => a.score - b.score);

            if (!candidates.length) {
                pending.push(task);
                continue;
            }
            place(task, candidates[0].slot, state);
        }

        if (state.assignments.length > best.assignments.length) {
            best = { assignments: copyState(state).assignments, pending };
        }
        if (!pending.length) break;
    }
    return best;
}

function groupPendingTasks(pending) {
    const grouped = new Map();
    for (const task of pending) {
        const key = taskIdentity(task);
        if (!grouped.has(key)) grouped.set(key, { ...task, pendingLessons: 0 });
        grouped.get(key).pendingLessons++;
    }
    return [...grouped.values()];
}

function findTeacherAvailabilitySuggestions(task, teachers, partialAssignments) {
    const teacher = teachers.find(t => t.id === task.teacherId);
    if (!teacher) return [];
    const availability = normalizeAvailability(teacher);
    const suggestions = [];

    for (const day of DAYS) {
        for (const period of PERIODS) {
            if (availability[day].includes(period)) continue;
            const teacherBusy = partialAssignments.some(a => a.teacherId === task.teacherId && a.day === day && a.period === period);
            const gradeBusy = partialAssignments.some(a => a.gradeId === task.gradeId && a.day === day && a.period === period);
            if (!teacherBusy && !gradeBusy) suggestions.push({ day, period, kind: 'release_availability' });
        }
    }
    return suggestions.slice(0, 3);
}

function findMoveSuggestions(task, partialAssignments) {
    const suggestions = [];
    for (const slot of task.eligibleSlots) {
        const teacherConflict = partialAssignments.find(a => a.teacherId === task.teacherId && a.day === slot.day && a.period === slot.period);
        const gradeConflict = partialAssignments.find(a => a.gradeId === task.gradeId && a.day === slot.day && a.period === slot.period);
        if (teacherConflict || gradeConflict) {
            suggestions.push({
                day: slot.day,
                period: slot.period,
                kind: teacherConflict ? 'teacher_conflict' : 'grade_conflict',
                conflict: teacherConflict || gradeConflict
            });
        }
    }
    return suggestions.slice(0, 3);
}

function buildFailureDiagnostics(tasks, teachers, partial) {
    const grouped = groupPendingTasks(partial.pending);
    return grouped.map(item => {
        const releaseOptions = findTeacherAvailabilitySuggestions(item, teachers, partial.assignments);
        const moveOptions = findMoveSuggestions(item, partial.assignments);
        const suggestions = [];

        for (const option of releaseOptions) {
            suggestions.push(`Liberar ${option.day}, ${option.period}ª aula para ${item.teacherName}.`);
        }
        for (const option of moveOptions) {
            if (option.kind === 'teacher_conflict') {
                suggestions.push(`Reorganizar uma aula de ${item.teacherName} em ${option.day}, ${option.period}ª aula para abrir esse horário.`);
            } else {
                suggestions.push(`Mover a aula que ocupa ${item.gradeName} em ${option.day}, ${option.period}ª aula.`);
            }
        }
        if (!suggestions.length) suggestions.push('Amplie a disponibilidade do professor ou reduza uma restrição da turma/disciplina.');

        return {
            severity: 'warning',
            type: 'unplaced_lessons',
            teacherId: item.teacherId,
            gradeId: item.gradeId,
            subjectId: item.subjectId,
            title: `${item.teacherName} • ${item.subjectName} • ${item.gradeName}`,
            message: `${item.pendingLessons} aula(s) ficaram sem encaixe.`,
            suggestions: suggestions.slice(0, 4)
        };
    });
}

export function generateAutomaticSchedule({ schoolId, teachers, grades, preferences = {}, onProgress = null }) {
    const opts = {
        maxConsecutiveSameSubject: [2, 3].includes(Number(preferences.maxConsecutiveSameSubject))
            ? Number(preferences.maxConsecutiveSameSubject)
            : 0,
        avoidTeacherGaps: preferences.avoidTeacherGaps !== false,
        avoidLastPeriod: preferences.avoidLastPeriod === true
    };

    onProgress?.({ stage: 'precheck', percent: 2, message: 'Validando cargas e disponibilidades...' });
    const { requirements, errors: reqErrors } = makeRequirements(teachers);
    const capacity = validateCapacity(requirements, teachers, grades);
    const errors = [...reqErrors, ...capacity.errors];
    if (errors.length) {
        return {
            success: false,
            stage: 'precheck',
            errors,
            diagnostics: capacity.diagnostics,
            totalRequired: requirements.reduce((sum, r) => sum + r.weeklyLessons, 0),
            totalPlaced: 0,
            pendingLessons: requirements.reduce((sum, r) => sum + r.weeklyLessons, 0)
        };
    }
    if (!requirements.length) return { success: false, stage: 'precheck', errors: ['Nenhuma carga horária semanal foi cadastrada nos vínculos dos professores.'], diagnostics: [] };

    let best = null;
    const maxAttempts = 8;
    const maxNodes = 300000;
    onProgress?.({ stage: 'preparing', percent: 5, message: 'Preparando as aulas mais difíceis primeiro...' });
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const tasks = buildTasks(requirements, teachers).map(t => ({ ...t, schoolId }));
        onProgress?.({ stage: 'solving', percent: Math.round(5 + (attempt / maxAttempts) * 82), attempt: attempt + 1, totalAttempts: maxAttempts, nodes: 0, maxNodes, message: `Tentativa ${attempt + 1} de ${maxAttempts}: procurando uma combinação válida...` });
        const result = solve(tasks, opts, maxNodes, ({ nodes }) => {
            const attemptProgress = Math.min(1, nodes / maxNodes);
            const percent = Math.min(87, Math.round(5 + ((attempt + attemptProgress) / maxAttempts) * 82));
            onProgress?.({ stage: 'solving', percent, attempt: attempt + 1, totalAttempts: maxAttempts, nodes, maxNodes, message: `Tentativa ${attempt + 1} de ${maxAttempts}: ${nodes.toLocaleString('pt-BR')} combinações analisadas...` });
        });
        if (!result.success) continue;
        const quality = scoreSchedule(result.assignments, opts);
        if (!best || quality > best.quality) best = { ...result, quality };
        if (quality >= 95) break;
    }

    if (!best) {
        onProgress?.({ stage: 'diagnosis', percent: 90, message: 'Não encontrei uma grade completa. Montando a melhor grade parcial e diagnosticando conflitos...' });
        const tasks = buildTasks(requirements, teachers).map(t => ({ ...t, schoolId }));
        const partial = buildPartialSchedule(tasks, opts, 50, ({ attempt, attempts }) => {
            const percent = Math.min(97, Math.round(90 + (attempt / attempts) * 7));
            onProgress?.({ stage: 'diagnosis', percent, message: `Analisando conflitos e alternativas (${attempt}/${attempts})...` });
        });
        const totalRequired = tasks.length;
        const totalPlaced = partial.assignments.length;
        const diagnostics = buildFailureDiagnostics(tasks, teachers, partial);
        return {
            success: false,
            stage: 'solver',
            errors: ['Não foi possível encontrar uma grade 100% completa com as disponibilidades atuais.'],
            diagnostics,
            partialAssignments: partial.assignments,
            totalRequired,
            totalPlaced,
            pendingLessons: totalRequired - totalPlaced,
            completionPercent: Math.round(totalPlaced / Math.max(1, totalRequired) * 100)
        };
    }

    onProgress?.({ stage: 'done', percent: 100, message: 'Grade completa encontrada.' });
    return {
        success: true,
        assignments: best.assignments,
        quality: best.quality,
        totalLessons: best.assignments.length,
        totalRequired: best.assignments.length,
        totalPlaced: best.assignments.length,
        pendingLessons: 0,
        completionPercent: 100,
        diagnostics: capacity.diagnostics,
        requirements
    };
}

export { DAYS, PERIODS, normalizeAvailability };
