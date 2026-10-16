import { DonkeyKong } from './dkong.js';
import { JungleKing } from './junglek.js';

export const MACHINES = [DonkeyKong, JungleKing];

export function findMachine(id) {
  return MACHINES.find(m => m.info.id === id);
}
