/* NyXiaLabo — fonctions pures de préparation et d'estimation TTS.
   Aucun secret, aucun appel réseau, aucun déclenchement de synthèse. */
(function(root) {
  'use strict';
  const encoder = new TextEncoder();
  const MAX_BYTES = 4000; // marge sous la protection à 4500 octets du Worker actif
  const bytes = text => encoder.encode(text).length;
  const characters = text => Array.from(String(text || '')).length;
  const words = text => {
    const trimmed = String(text || '').trim();
    return trimmed ? trimmed.split(/\s+/u).length : 0;
  };
  const numeric = v => {
    if (v === '' || v == null) return null;
    const n = Number(String(v).replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  function splitForGoogle(input, maxBytes = MAX_BYTES) {
    if (!Number.isInteger(maxBytes) || maxBytes < 8 || maxBytes > 4500) throw new Error('Limite de segment incorrecte.');
    const text = String(input || '');
    if (!text.trim()) return [];
    const out = [];
    let current = '';
    const push = () => { const value = current.trim(); if (value) out.push(value); current = ''; };
    const tokens = text.match(/\S+|\s+/gu) || [];
    for (const token of tokens) {
      if (bytes(current + token) <= maxBytes) { current += token; continue; }
      if (current.trim()) push();
      if (bytes(token) <= maxBytes) { current = token; continue; }
      // Les mots exceptionnellement longs sont fractionnés par caractère Unicode,
      // jamais par octet ni au milieu d'une paire de substitution UTF-16.
      for (const symbol of Array.from(token)) {
        if (bytes(current + symbol) > maxBytes) push();
        if (bytes(symbol) > maxBytes) throw new Error('Un caractère dépasse la limite de segment.');
        current += symbol;
      }
    }
    push();
    if (out.some(x => bytes(x) > maxBytes)) throw new Error('Découpage invalide : segment trop long.');
    return out;
  }

  function compute(text, opts = {}) {
    const chunks = splitForGoogle(text);
    // Compter ce qui sera effectivement envoyé, plutôt que supposer que les
    // caractères retirés aux bordures de segments seront facturés.
    const count = chunks.reduce((sum, part) => sum + characters(part), 0);
    const wordCount = words(text);
    const minuteRate = numeric(opts.wordsPerMinute) || 140;
    const rate = numeric(opts.usdPerMillion);
    const fx = numeric(opts.usdToCad);
    const safety = numeric(opts.safetyPct);
    const freeRemaining = numeric(opts.freeRemaining);
    const multiplier = 1 + (safety == null ? 0 : safety / 100);
    const conservativeChars = Math.ceil(count * multiplier);
    const chargeableChars = Math.max(0, conservativeChars - (freeRemaining || 0));
    const usd = rate == null ? null : chargeableChars / 1000000 * rate;
    return {
      sourceCharacters: characters(text),
      charactersToSend: count,
      words: wordCount,
      minutes: wordCount / minuteRate,
      segments: chunks.length,
      segmentsText: chunks,
      maxBytes: Math.max(0, ...chunks.map(bytes)),
      conservativeCharacters: conservativeChars,
      chargeableCharacters: chargeableChars,
      usd,
      cad: usd == null || fx == null || fx <= 0 ? null : usd * fx,
      rate, fx, safetyPct: safety || 0,
      freeRemaining: freeRemaining || 0
    };
  }

  function cleanPreview(input) {
    const original = String(input || '');
    let text = original.replace(/https?:\/\/\S+/giu, '');
    const removedUrls = (original.match(/https?:\/\/\S+/giu) || []).length;
    const beforePages = text;
    text = text.replace(/\n[ \t]*\d{1,4}[ \t]*\n/gu, '\n');
    const removedPageMarkers = beforePages !== text;
    text = text.replace(/[-=_]{3,}/gu, ' ').replace(/[ \t]{2,}/gu, ' ').replace(/\n{3,}/gu, '\n\n').trim();
    return { text, removedUrls, removedPageMarkers, changed: text !== original };
  }

  root.NyXiaAudioCost = Object.freeze({compute, splitForGoogle, cleanPreview, characters, words, bytes, numeric});
})(globalThis);
