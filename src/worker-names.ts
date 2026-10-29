import { randomInt } from 'node:crypto';

const ADJECTIVES = ['Amber', 'Brave', 'Calm', 'Clever', 'Coral', 'Gentle', 'Golden', 'Happy',
  'Jade', 'Kind', 'Lively', 'Lunar', 'Merry', 'Quiet', 'Silver', 'Sunny'] as const;
const ANIMALS = ['Badger', 'Crane', 'Dolphin', 'Falcon', 'Finch', 'Fox', 'Heron', 'Koala',
  'Lynx', 'Otter', 'Owl', 'Panda', 'Robin', 'Sparrow', 'Tiger', 'Wren'] as const;

function nameAt(index: number): string {
  return `${ADJECTIVES[Math.floor(index / ANIMALS.length)]} ${ANIMALS[index % ANIMALS.length]}`;
}

/** Pick a readable random name without collisions among this run's members. */
export function randomWorkerName(existing: Iterable<string>): string {
  const used = new Set(existing);
  const available = Array.from({ length: ADJECTIVES.length * ANIMALS.length }, (_, index) => nameAt(index))
    .filter((name) => !used.has(name));
  if (available.length > 0) return available[randomInt(available.length)]!;
  // Display vocabulary is not an admission limit. Larger valid teams retain unique names.
  const base = nameAt(randomInt(ADJECTIVES.length * ANIMALS.length));
  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

/** Stable readable fallback for records saved before display names were introduced. */
export function workerDisplayName(worker: { id: string; displayName?: string }): string {
  if (worker.displayName) return worker.displayName;
  let hash = 2166136261;
  for (const char of worker.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return nameAt(hash % (ADJECTIVES.length * ANIMALS.length));
}
