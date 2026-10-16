import { DonkeyKong } from './dkong.js';
import { JungleKing } from './junglek.js';
import { MoonPatrol } from './mpatrol.js';
import { MsPacman } from './mspacman.js';

export const MACHINES = [DonkeyKong, JungleKing, MoonPatrol, MsPacman];

export function findMachine(id) {
  return MACHINES.find(m => m.info.id === id);
}
