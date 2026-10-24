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

// Anslått lysnivå ute (lux) ved klarvær, ut fra solhøyden. Interpolerer i log-skala
// mellom kjente referanseverdier (fullmåne ≈ 0.1, borgerlig tusmørke ≈ 3, soloppgang ≈ 400, sol høyt ≈ 100 000).
const LUX_TABLE = [[-18, 0.001], [-12, 0.01], [-9, 0.3], [-6, 3], [-3, 40], [0, 400],
  [5, 4000], [10, 10000], [20, 30000], [30, 55000], [45, 80000], [60, 100000], [90, 120000]];

function estimateLux(altitude) {
  if (altitude <= LUX_TABLE[0][0]) return 0;
  for (let i = 1; i < LUX_TABLE.length; i++) {
    const [a1, l1] = LUX_TABLE[i - 1];
    const [a2, l2] = LUX_TABLE[i];
    if (altitude <= a2) {
      const f = (altitude - a1) / (a2 - a1);
      return 10 ** (Math.log10(l1) + f * (Math.log10(l2) - Math.log10(l1)));
    }
  }
  return 120000;
}

module.exports.estimateLux = estimateLux;
