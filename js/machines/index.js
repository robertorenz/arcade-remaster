import { DonkeyKong } from './dkong.js';
import { JungleKing } from './junglek.js';
import { MoonPatrol } from './mpatrol.js';
import { MsPacman } from './mspacman.js';
import { Joust } from './joust.js';
import { Qbert } from './qbert.js';

export const MACHINES = [DonkeyKong, JungleKing, MoonPatrol, MsPacman, Joust, Qbert];

export function findMachine(id) {
  return MACHINES.find(m => m.info.id === id);
}
