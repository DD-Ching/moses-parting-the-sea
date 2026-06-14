// Central tunables for the experience. The world runs along the Z axis:
// "forward" (where the crowd flees and the sea opens) is -Z; the army is at +Z.
export const CFG = {
  // Corridor geometry
  corridorHalf: 10,      // walls stand at x = ±corridorHalf (tight, imposing)
  wallHeight: 95,        // towering walls of water
  wallThickness: 6,
  forwardZ: -440,        // far end of the dry path (the light)
  backZ: 150,            // behind the crowd, where the army gathers

  // Crowd
  crowdCount: 520,       // fleeing multitude (instanced)
  armyCount: 150,        // pursuers

  // Camera eye
  eyeHeight: 2.25,

  // Palette (linear-ish authoring; tone-mapped at output)
  col: {
    deepSea:   0x0a2a3a,
    sea:       0x123f55,
    seaCrest:  0x2f7f9c,
    foam:      0xdff3ff,
    sky:       0x0a1422,
    horizon:   0x223a52,
    sand:      0x2a2417,
    sandWet:   0x14110a,
    gold:      0xffd27a,
    holyLight: 0xfff0cf,
    robeA:     0x6b4a35,
    robeB:     0x7d5a3a,
    robeC:     0x8a6a48,
    robeD:     0x5a4632,
    armyDark:  0x161313,
    torch:     0xff6a22,
  },

  // Narrative timeline (seconds). Camera director keys off these.
  beats: {
    riseStart: 1.0,   // walls begin to part
    riseEnd: 7.5,     // walls fully risen
    surge: 6.0,       // crowd begins to surge forward
    lookBack: 15.0,   // camera glances back at the army
    march: 20.0,      // settle into the march toward the light
    free: 30.0,       // hand control to the viewer
  },
};
