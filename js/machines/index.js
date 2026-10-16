import { DonkeyKong } from './dkong.js';
import { JungleKing } from './junglek.js';
import { MoonPatrol } from './mpatrol.js';

export const MACHINES = [DonkeyKong, JungleKing, MoonPatrol];

export function findMachine(id) {
  return MACHINES.find(m => m.info.id === id);
}
