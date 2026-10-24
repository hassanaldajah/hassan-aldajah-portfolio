/* EYE INTRO palette: black and white only. Space is black, so colour would only add noise.
   The single source of every colour in the intro (shaders, particles, the typing wall, the hint). */
export const MONO = {
  pupil: '#000000',   // the pupil and the black-hole core
  bg: '#050505',      // background
  white: '#FFFFFF',   // primary words (inner rings, key words), dots, the event-horizon ring
  mid: '#BDBDBD',     // mid rings, the active log line
  outer: '#6E6E6E',   // outer rings, the log text
  line: '#2A2A2A',    // subtle structure lines
};

// the roles the intro asks for, mapped onto the six tones
export function makeEyePalette() {
  const roles = {
    bg: MONO.bg, pupil: MONO.pupil, hot: MONO.white, mid: MONO.mid,
    irisInner: MONO.white, irisMid: MONO.mid, irisOuter: MONO.outer, highlight: MONO.white,
    horizon: MONO.white, rim: MONO.line, lid: MONO.pupil, lidSheen: MONO.bg,
    wallText: MONO.outer, wallActive: MONO.mid,
  };
  const out = {};
  for (const k in roles) out[k] = { hex: roles[k] };
  return out;
}
