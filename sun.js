'use strict';

// Solens høyde over horisonten (grader) for et tidspunkt og en posisjon (SunCalc/NOAA-formler).
// Å bruke høyden direkte – i stedet for faste soloppgang/-nedgangstider – fungerer også
// ved midnattssol og mørketid i Nord-Norge.
const rad = Math.PI / 180;
const obliquity = rad * 23.4397;

function sunAltitude(date, lat, lng) {
  const d = date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545;
  const M = rad * (357.5291 + 0.98560028 * d);
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + rad * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(obliquity) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(obliquity), Math.cos(L));
  const H = rad * (280.16 + 360.9856235 * d) + rad * lng - ra;
  const phi = rad * lat;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)) / rad;
}

module.exports = { sunAltitude };
