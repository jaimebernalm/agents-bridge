// Approving a proposed collaboration in the person's own chat. The bridge writes the proposal into one card of three
// short questions (may the other chat edit, which limits, and start or not); the agent asks them word for word with its
// app's question tool, and only the answers the app hands to the bridge (see bridge-questions.ts) may start it. The card
// is pinned to the proposal's exact content, so any change to the proposal needs a new card. The objective is not on
// the card: the person asked for it in their own words, and the panel shows it.
import { createHash } from 'node:crypto';
import type { Proposal } from './desktop-proposals';
import type { QuestionContent, QuestionItem } from './bridge-questions';

// A longer scope would not fit a question the person can read in full; such a proposal is approved in the panel.
export const maxQuestionScope = 1000;
const maxAddedScope = 2000;

export type Limits = { maxMessages: number | null; minutes: number };
// The steps the card offers above the proposed limits, each larger in both messages and time; the last one stops only
// on time, for whoever wants no message count.
const limitSteps: Limits[] = [{ maxMessages: 24, minutes: 30 }, { maxMessages: 50, minutes: 120 }, { maxMessages: 100, minutes: 240 }, { maxMessages: 200, minutes: 480 }];
const unlimited: Limits = { maxMessages: null, minutes: 1440 };

const texts = {
  en: {
    editHeader: 'Editing', edit: (app: string, scope: string | null) => `May ${app} edit files and make local commits? ${scope === null ? 'No push, pull requests or merges.' : `Scope: ${scope}`}`,
    yes: { label: 'Yes', description: 'To allow more, write it in Other, e.g. add push and pull requests' }, no: { label: 'No', description: 'It analyzes and proposes without editing' },
    limitsHeader: 'Limits', limits: 'How many messages and how much time at most?',
    messages: (n: number | null) => n === null ? 'Unlimited messages' : `${n} messages`, time: (m: number) => m % 60 === 0 ? `${m / 60} h` : `${m} min`,
    proposed: (label: string) => `${label} (proposed)`, proposedDescription: 'What was proposed',
    steps: ['More room', 'For long work'], unlimited: 'No message count; it stops after 24 hours', smaller: 'Less than proposed',
    startHeader: 'Start', start: (chat: string) => `Start with ${chat}?`,
    newChat: (app: string) => `a new ${app} chat`, existingChat: (app: string, name: string) => `the ${app} chat “${name}”`, opened: (minutes: number) => minutes < 1 ? ', opened just now' : `, opened ${minutes} min ago`,
    options: [{ label: 'Yes', description: 'Starts it with what you chose' },
      { label: 'Change chat or details in the panel', description: 'Opens the panel to pick one of your open chats, or change the objective or anything else' },
      { label: 'Cancel', description: 'Discards this proposal' }],
    scope: 'Implement the agreed plan in this project: edit files and make local commits. No push, pull requests or merges.',
    added: (base: string, text: string) => `${base} The person added: ${text}`, base: 'Implement the agreed plan in this project: edit files and make local commits.',
  },
  es: {
    editHeader: 'Editar', edit: (app: string, scope: string | null) => `¿Puede ${app} editar archivos y hacer commits locales? ${scope === null ? 'Sin push, PR ni merges.' : `Alcance: ${scope}`}`,
    yes: { label: 'Sí', description: 'Para permitir más, escríbelo en Otros, p. ej. añade push y pull requests' }, no: { label: 'No', description: 'Analiza y propone, sin editar' },
    limitsHeader: 'Límites', limits: '¿Cuántos mensajes y cuánto tiempo como máximo?',
    messages: (n: number | null) => n === null ? 'Mensajes sin límite' : `${n} mensajes`, time: (m: number) => m % 60 === 0 ? `${m / 60} h` : `${m} min`,
    proposed: (label: string) => `${label} (propuesto)`, proposedDescription: 'Lo que se ha propuesto',
    steps: ['Más margen', 'Para trabajos largos'], unlimited: 'Sin contar mensajes; se para a las 24 horas', smaller: 'Menos de lo propuesto',
    startHeader: 'Empezar', start: (chat: string) => `¿Empiezo con ${chat}?`,
    newChat: (app: string) => `un chat nuevo de ${app}`, existingChat: (app: string, name: string) => `el chat de ${app} «${name}»`, opened: (minutes: number) => minutes < 1 ? ', abierto ahora mismo' : `, abierto hace ${minutes} min`,
    options: [{ label: 'Sí', description: 'Arranca con lo que has elegido' },
      { label: 'Cambiar chat u otros datos en el panel', description: 'Abre el panel para elegir uno de tus chats abiertos, o cambiar el objetivo u otra cosa' },
      { label: 'Cancelar', description: 'Descarta esta propuesta' }],
    scope: 'Implementar el plan acordado en este proyecto: editar archivos y hacer commits locales. Sin push, PR ni merges.',
    added: (base: string, text: string) => `${base} La persona ha añadido: ${text}`, base: 'Implementar el plan acordado en este proyecto: editar archivos y hacer commits locales.',
  },
};
export type Language = keyof typeof texts;
export type ApprovalChoice = 'start' | 'panel' | 'decline';

// The panel's own default when the person allows editing without writing a scope.
export const defaultEditScope = (language: Language) => texts[language].scope;
export const editScopeOf = (proposal: Proposal, language: Language) => proposal.editScope ?? defaultEditScope(language);
const sameLimits = (a: Limits, b: Limits) => a.maxMessages === b.maxMessages && a.minutes === b.minutes;
const larger = (step: Limits, than: Limits) => step.minutes > than.minutes && (than.maxMessages === null ? step.maxMessages === null : step.maxMessages === null || step.maxMessages > than.maxMessages);

// The pinned content: everything the start uses, in the language the card was shown in.
export function proposalSubject(proposal: Proposal, language: Language) {
  const shown = { objective: proposal.objective, newChat: proposal.newChat, peerId: proposal.newChat ? null : proposal.peerId ?? null, allowEdits: proposal.allowEdits,
    editScope: editScopeOf(proposal, language), maxMessages: proposal.maxMessages, minutes: proposal.minutes, initialBarrier: proposal.initialBarrier };
  return `${proposal.id}:${language}:${createHash('sha256').update(JSON.stringify(shown)).digest('hex')}`;
}
export function subjectParts(subject: string | null) {
  const [proposalId, language] = (subject ?? '').split(':');
  return proposalId && (language === 'en' || language === 'es') ? { proposalId, language: language as Language } : null;
}

// The card and what each offered option stands for. The proposed choice comes first; limits then climb in steps.
export type PeerLabel = { title: string; minutes?: number };
function card(proposal: Proposal, other: 'codex' | 'claude', language: Language, peer?: PeerLabel) {
  const t = texts[language], app = other === 'codex' ? 'Codex' : 'Claude';
  const edits = proposal.allowEdits ? [true, false] : [false, true];
  const proposedLimits: Limits = { maxMessages: proposal.maxMessages, minutes: proposal.minutes };
  const above = limitSteps.filter(step => larger(step, proposedLimits)).slice(0, 2);
  const limits: { value: Limits; description: string }[] = [{ value: proposedLimits, description: t.proposedDescription },
    ...above.map((value, i) => ({ value, description: t.steps[i]! })),
    ...(sameLimits(proposedLimits, unlimited) ? [] : [{ value: unlimited, description: t.unlimited }])];
  // A question needs two options: below the largest limits, offer the step under them.
  if (limits.length < 2) limits.push({ value: limitSteps[limitSteps.length - 1]!, description: t.smaller });
  const limitLabel = (l: Limits) => `${t.messages(l.maxMessages)} · ${t.time(l.minutes)}`;
  const chat = proposal.newChat ? t.newChat(app) : t.existingChat(app, peer?.title.trim() || (proposal.peerId ?? '').slice(0, 8)) + (peer?.minutes === undefined ? '' : t.opened(peer.minutes));
  const questions: QuestionItem[] = [
    { header: t.editHeader, question: t.edit(app, proposal.editScope ?? null), options: edits.map((yes, i) => {
      const option = yes ? t.yes : t.no;
      return i === 0 ? { label: t.proposed(option.label), description: option.description } : option;
    }) },
    { header: t.limitsHeader, question: t.limits, options: limits.map((l, i) => ({ label: i === 0 ? t.proposed(limitLabel(l.value)) : limitLabel(l.value), description: l.description })) },
    { header: t.startHeader, question: t.start(chat), options: t.options },
  ];
  return { questions, edits, limits: limits.map(l => l.value) };
}

export function approvalQuestions(proposal: Proposal, other: 'codex' | 'claude', language: Language, peer?: PeerLabel): QuestionContent | null {
  if (editScopeOf(proposal, language).length > maxQuestionScope) return null;
  const { questions } = card(proposal, other, language, peer);
  return { purpose: 'collaboration', subject: proposalSubject(proposal, language), questions: () => questions };
}

// Limits the person typed instead of picking one, such as "40 messages, 45 min" or "sin límite, 3 h". The whole text
// must read as limits: anything else in it (seconds, "2.5 min", a condition) leaves it unread, so nothing starts on a
// guess. Whatever they leave out stays as proposed.
const limitParts: [kind: 'count' | 'unlimited' | 'hours' | 'minutes', pattern: RegExp][] = [
  ['count', /^(\d+)\s*(?:mensajes?|messages?|msgs?)(?!\w)/],
  ['unlimited', /^(?:(?:mensajes\s+)?(?:sin\s+limite(?:\s+de\s+mensajes)?|ilimitad[oa]s?)|(?:unlimited|no\s+(?:message\s+)?limit)(?:\s+(?:messages|on\s+messages))?)(?!\w)/],
  ['hours', /^(\d+(?:[.,]\d+)?)\s*(?:h|hs|hrs?|horas?|hours?)(?!\w)/],
  ['minutes', /^(\d+)\s*(?:min|mins|minutos?|minutes?)(?!\w)/],
];
const limitFiller = /^(?:[\s,;·+/]+|[.!](?=\s|$)|(?:y|e|and|con|with|como\s+(?:maximo|mucho)|a\s+lo\s+sumo|maximo|max|maximum|hasta|at\s+most|up\s+to)(?!\w))/;
export function limitsFromText(text: string, proposed: Limits): Limits | null {
  let rest = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').trim();
  const found: Partial<Record<(typeof limitParts)[number][0], string>> = {};
  while (rest) {
    const filler = limitFiller.exec(rest);
    if (filler) { rest = rest.slice(filler[0].length); continue; }
    const part = limitParts.map(([kind, pattern]) => [kind, pattern.exec(rest)] as const).find(([, match]) => match);
    if (!part || found[part[0]] !== undefined) return null;
    found[part[0]] = part[1]![1] ?? '';
    rest = rest.slice(part[1]![0].length);
  }
  if (Object.keys(found).length === 0 || (found.count !== undefined && found.unlimited !== undefined)) return null;
  const maxMessages = found.count !== undefined ? Number(found.count) : found.unlimited !== undefined ? null : proposed.maxMessages;
  const timed = found.hours !== undefined || found.minutes !== undefined;
  // Hours count only when they make whole minutes: 1.5 h is 90 min, while 1.01 h would have to be rounded.
  const hourMinutes = Number((found.hours ?? '0').replace(',', '.')) * 60;
  if (Math.abs(hourMinutes - Math.round(hourMinutes)) > 1e-9) return null;
  const minutes = timed ? Math.round(hourMinutes) + Number(found.minutes ?? 0) : proposed.minutes;
  if (maxMessages !== null && (maxMessages < 2 || maxMessages > 500)) return null;
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? { maxMessages, minutes } : null;
}

// What the person decided, from the answers the app handed over. Each answer counts as one exact label of its own
// question; besides, limits may be written out, and editing may be widened in words ("add push and pull requests"),
// which allows editing with what they wrote added to the scope. Words that start by refusing allow nothing.
const refusal = /^(no|nope|none|nada|ninguno|nunca|never)(?!\w)/;
export function approvalDecision(answers: (string | null)[], proposal: Proposal, other: 'codex' | 'claude', language: Language) {
  const { questions, edits, limits } = card(proposal, other, language);
  const pick = (index: number) => questions[index]!.options.findIndex(option => option.label === answers[index]?.trim());
  const start = pick(2), edit = pick(0), limit = pick(1);
  const choice: ApprovalChoice | null = start === 0 ? 'start' : start === 1 ? 'panel' : start === 2 ? 'decline' : null;
  const words = edit < 0 ? answers[0]?.trim() ?? '' : '';
  const widened = !!words && words.length <= maxAddedScope && !refusal.test(words.toLowerCase().normalize('NFD').replace(/\p{M}/gu, ''));
  const allowEdits = edit >= 0 ? edits[edit]! : widened ? true : null;
  const scope = !allowEdits ? null : widened ? texts[language].added(proposal.editScope ?? texts[language].base, words) : editScopeOf(proposal, language);
  const chosenLimits = limit >= 0 ? limits[limit]! : answers[1] ? limitsFromText(answers[1], { maxMessages: proposal.maxMessages, minutes: proposal.minutes }) : null;
  return { choice, allowEdits, limits: chosenLimits, scope, widened };
}
