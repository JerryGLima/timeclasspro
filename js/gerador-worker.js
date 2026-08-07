import { generateAutomaticSchedule } from './gerador.js';

self.onmessage = (event) => {
    const { type, payload } = event.data || {};
    if (type !== 'generate') return;

    try {
        const result = generateAutomaticSchedule({
            ...payload,
            onProgress: (progress) => self.postMessage({ type: 'progress', progress })
        });
        self.postMessage({ type: 'result', result });
    } catch (error) {
        self.postMessage({
            type: 'error',
            error: error?.message || String(error)
        });
    }
};
