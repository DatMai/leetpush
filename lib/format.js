// Builds the files committed for one submission.

export const EXTENSIONS = {
  python: 'py', python3: 'py', pythondata: 'py', pandas: 'py',
  cpp: 'cpp', c: 'c', java: 'java', csharp: 'cs',
  javascript: 'js', typescript: 'ts',
  golang: 'go', rust: 'rs', kotlin: 'kt', swift: 'swift', scala: 'scala',
  ruby: 'rb', php: 'php', dart: 'dart', elixir: 'ex', erlang: 'erl', racket: 'rkt',
  mysql: 'sql', mssql: 'sql', oraclesql: 'sql', postgresql: 'sql',
  bash: 'sh',
};

const BADGE_COLORS = { Easy: '00b8a3', Medium: 'ffc01e', Hard: 'ff375f' };

export function cleanFolder(folder) {
  return (folder || '')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
}

export function problemFolder(sub, folder) {
  const q = sub.question;
  const num = String(q.questionFrontendId || q.questionId || '0').padStart(4, '0');
  const base = `${num}-${q.titleSlug}`;
  const prefix = cleanFolder(folder);
  return prefix ? `${prefix}/${base}` : base;
}

export function extensionFor(lang) {
  return EXTENSIONS[(lang && lang.name || '').toLowerCase()] || 'txt';
}

const pct = (v) => (typeof v === 'number' && isFinite(v) ? `${v.toFixed(1)}%` : null);

function statsLine(sub) {
  const parts = [];
  const rp = pct(sub.runtimePercentile);
  const mp = pct(sub.memoryPercentile);
  if (sub.runtimeDisplay) parts.push(`Runtime ${sub.runtimeDisplay}${rp ? ` (beats ${rp})` : ''}`);
  if (sub.memoryDisplay) parts.push(`Memory ${sub.memoryDisplay}${mp ? ` (beats ${mp})` : ''}`);
  return parts.join(' · ');
}

export function readme(sub) {
  const q = sub.question;
  const num = q.questionFrontendId || q.questionId;
  const color = BADGE_COLORS[q.difficulty] || '808080';
  const tags = (q.topicTags || []).map((t) => `\`${t.name}\``).join(' ');
  const lines = [
    `# [${num}. ${q.title}](https://leetcode.com/problems/${q.titleSlug}/)`,
    '',
    `![${q.difficulty}](https://img.shields.io/badge/${q.difficulty}-${color})${tags ? ' ' + tags : ''}`,
    '',
    '---',
    '',
    q.content || '_Premium problem: LeetCode did not return the statement._',
    '',
    '---',
    '',
    `**Solution:** [\`${q.titleSlug}.${extensionFor(sub.lang)}\`](./${q.titleSlug}.${extensionFor(sub.lang)}) · ${sub.lang && sub.lang.verboseName || ''}`,
  ];
  const stats = statsLine(sub);
  if (stats) lines.push('', `**Result:** ${stats}`);
  lines.push('');
  return lines.join('\n');
}

export function buildFiles(sub, folder) {
  const dir = problemFolder(sub, folder);
  const files = [
    { path: `${dir}/README.md`, content: readme(sub) },
    { path: `${dir}/${sub.question.titleSlug}.${extensionFor(sub.lang)}`, content: sub.code.endsWith('\n') ? sub.code : sub.code + '\n' },
  ];
  if (sub.notes && sub.notes.trim()) {
    files.push({ path: `${dir}/NOTES.md`, content: `# Notes: ${sub.question.title}\n\n${sub.notes.trim()}\n` });
  }
  return files;
}

export function commitMessage(sub) {
  const q = sub.question;
  const num = q.questionFrontendId || q.questionId;
  const stats = statsLine(sub);
  return `${num}. ${q.title} (${q.difficulty})${stats ? `\n\n${stats}` : ''}\n\nPushed by LeetPush`;
}
