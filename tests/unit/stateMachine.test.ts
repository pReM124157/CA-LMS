import { describe, expect, it } from 'vitest';
import { RunnerStateMachine } from '../../src/orchestration/runnerStateMachine.js';
describe('RunnerStateMachine', () => { it('records transition endpoints', () => { const machine = new RunnerStateMachine(); expect(machine.transition('PLAYING')).toEqual({ from: 'BOOTING', to: 'PLAYING' }); }); });
