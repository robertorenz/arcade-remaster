import { DonkeyKong } from './dkong.js';

export const MACHINES = [DonkeyKong];

export function findMachine(id) {
  return MACHINES.find(m => m.info.id === id);
}
