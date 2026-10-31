import { useState } from 'react';
import InstructionSheet from './InstructionSheet';

/**
 * Sheet state for a screen: `open(id, name)` from any row, render `sheet`
 * once at the bottom of the screen.
 */
export function useInstructionSheet() {
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const sheet = target
    ? <InstructionSheet exerciseId={target.id} exerciseName={target.name} onClose={() => setTarget(null)} />
    : null;
  return { open: (id: string, name: string) => setTarget({ id, name }), sheet };
}
