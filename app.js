'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const { sunAltitude, estimateLux } = require('./sun');

const DEFAULTS = {
  enabled: true,
  devices: [],
  eveningAngle: -3, // tenn når sola er 3° under horisonten (mellom solnedgang og borgerlig skumring)
  morningAngle: -3, // slukk når sola er over -3° om morgenen
  nightBreak: { enabled: false, off: '23:30', on: '06:00' },
  lux: { deviceId: null, threshold: 30 },
  zones: [], // tom = alle rom (brukes bare til filtrering i innstillingene)
  classes: ["light", "socket"],
};

const TICK_MS = 60 * 1000;

class OutdoorLightsApp extends Homey.App {

  async onInit() {
    this.api = await HomeyAPI.createAppAPI({ homey: this.homey });
    this.lastWanted = this.homey.settings.get('lastWanted'); // null første gang
    this.pausedUntil = 0;
    this.luxDarkSince = null;
    this.lastLog = this.homey.settings.get('log') || [];

    this.triggerTurned = this.homey.flow.getTriggerCard('lights_turned');
    this.homey.flow.getConditionCard('is_dark').registerRunListener(() => this.isDark(new Date()));
    this.homey.flow.getActionCard('pause').registerRunListener(({ minutes }) => {
      this.pausedUntil = Date.now() + minutes * 60000;
      this.addLog(`Pause i ${minutes} min`);
      return true;
    });

    this.homey.settings.on('set', key => {
      if (key === 'config') this.tick(true).catch(this.error);
    });

    this.interval = this.homey.setInterval(() => this.tick().catch(this.error), TICK_MS);
    await this.tick();
    this.log('Smart utelys startet');
  }

  get config() {
    const c = this.homey.settings.get('config') || {};
    return {
      ...DEFAULTS, ...c,
      nightBreak: { ...DEFAULTS.nightBreak, ...(c.nightBreak || {}) },
      lux: { ...DEFAULTS.lux, ...(c.lux || {}) },
    };
  }

  get position() {
    return { lat: this.homey.geolocation.getLatitude(), lng: this.homey.geolocation.getLongitude() };
  }

  // Lokal klokke (HH:MM i minutter) i Homeys tidssone
  localMinutes(date) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: this.homey.clock.getTimezone(),
    }).formatToParts(date);
    const h = Number(parts.find(p => p.type === 'hour').value);
    const m = Number(parts.find(p => p.type === 'minute').value);
    return h * 60 + m;
  }

  inNightBreak(date, nb) {
    if (!nb.enabled) return false;
    const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const now = this.localMinutes(date);
    const off = toMin(nb.off);
    const on = toMin(nb.on);
    return off <= on ? now >= off && now < on : now >= off || now < on;
  }

  // Sol-basert mørke. Ettermiddag/kveld bruker kveldsvinkel, morgen bruker morgenvinkel.
  sunDark(date, cfg = this.config) {
    const { lat, lng } = this.position;
    const alt = sunAltitude(date, lat, lng);
    const rising = sunAltitude(new Date(date.valueOf() + 10 * 60000), lat, lng) > alt;
    return alt < (rising ? cfg.morningAngle : cfg.eveningAngle);
  }

  async readLux(cfg) {
    if (!cfg.lux.deviceId) return null;
    try {
      const dev = await this.api.devices.getDevice({ id: cfg.lux.deviceId });
      const v = dev.capabilitiesObj?.measure_luminance?.value;
      return typeof v === 'number' ? v : null;
    } catch (e) { return null; }
  }

  async isDark(date, cfg = this.config) {
    let dark = this.sunDark(date, cfg);
    const lux = await this.readLux(cfg);
    if (lux !== null) {
      const { lat, lng } = this.position;
      const alt = sunAltitude(date, lat, lng);
      // Mørkt, overskyet vær: tenn tidligere (men aldri midt på dagen) – krever 10 min stabilt lavt lysnivå
      if (lux < cfg.lux.threshold && alt < 8) {
        this.luxDarkSince = this.luxDarkSince || Date.now();
        if (Date.now() - this.luxDarkSince >= 10 * 60000) dark = true;
      } else {
        this.luxDarkSince = null;
      }
      // Allerede lyst nok om morgenen: slukk tidligere
      if (dark && lux > cfg.lux.threshold * 3 && alt > -8) dark = false;
    }
    this.currentLux = lux;
    return dark;
  }

  async wanted(date, cfg) {
    return (await this.isDark(date, cfg)) && !this.inNightBreak(date, cfg.nightBreak);
  }

  async tick(configChanged = false) {
    await this.runAutomation(configChanged);
    await this.updateStatusDevices().catch(this.error);
  }

  async runAutomation(configChanged) {
    const cfg = this.config;
    if (!cfg.enabled || !cfg.devices.length) return;
    if (Date.now() < this.pausedUntil) return;

    const want = await this.wanted(new Date(), cfg);
    // Bare reager på overganger, slik at manuell betjening respekteres.
    if (want !== this.lastWanted || configChanged) {
      if (want !== this.lastWanted) await this.setLights(want, 'auto');
      this.lastWanted = want;
      this.homey.settings.set('lastWanted', want);
    }
  }

  async setLights(on, reason) {
    const cfg = this.config;
    const results = await Promise.allSettled(cfg.devices.map(deviceId =>
      this.api.devices.setCapabilityValue({ deviceId, capabilityId: 'onoff', value: on })));
    const failed = results.filter(r => r.status === 'rejected').length;
    this.addLog(`${on ? 'Slo på' : 'Slo av'} ${cfg.devices.length - failed} lys${reason === 'test' ? ' (test)' : ''}${failed ? `, ${failed} feilet` : ''}`);
    if (reason === 'auto') await this.triggerTurned.trigger({ on }).catch(this.error);
    if (reason !== 'auto') this.updateStatusDevices().catch(this.error);
    return { ok: failed === 0, failed };
  }

  async setEnabled(enabled) {
    this.homey.settings.set('config', { ...this.config, enabled });
    this.addLog(enabled ? 'Automatikk slått på' : 'Automatikk slått av');
  }

  async lightsOn(cfg) {
    const states = await Promise.all(cfg.devices.map(id => this.api.devices.getDevice({ id })
      .then(d => d.capabilitiesObj?.onoff?.value === true).catch(() => false)));
    return states.some(Boolean);
  }

  formatEvent(t) {
    if (!t) return 'Ikke innen 36 t';
    const tz = this.homey.clock.getTimezone();
    const d = new Date(t);
    const time = d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const day = x => x.toLocaleDateString('nb-NO', { timeZone: tz });
    return day(d) === day(new Date()) ? `I dag ${time}` : `I morgen ${time}`;
  }

  async updateStatusDevices() {
    const devices = this.homey.drivers.getDriver('status').getDevices();
    if (!devices.length) return;
    const s = await this.getStatus();
    await Promise.all(devices.map(d => d.update(s)));
  }

  addLog(msg) {
    this.lastLog = [{ t: Date.now(), msg }, ...this.lastLog].slice(0, 20);
    this.homey.settings.set('log', this.lastLog);
    this.log(msg);
  }

  async listZones() {
    const zones = await this.api.zones.getZones();
    return Object.values(zones).map(z => ({ id: z.id, name: z.name, parent: z.parent || null }));
  }

  async listLightDevices() {
    const [devices, zones] = await Promise.all([this.api.devices.getDevices(), this.api.zones.getZones()]);
    return Object.values(devices)
      .filter(d => d.driverId !== `homey:app:${this.homey.manifest.id}:status`)
      .filter(d => (d.capabilities || []).includes('onoff') || (d.capabilities || []).includes('measure_luminance'))
      .map(d => ({
        id: d.id,
        name: d.name,
        zoneId: d.zone,
        zone: zones[d.zone]?.name || '',
        class: d.virtualClass || d.class,
        icon: d.iconObj?.url || null,
        onoff: (d.capabilities || []).includes('onoff'),
        lux: (d.capabilities || []).includes('measure_luminance'),
        on: d.capabilitiesObj?.onoff?.value ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'no'));
  }

  // Beregner kommende på/av-tidspunkter (kun sol + nattpause) for de neste 36 timene.
  forecast(cfg) {
    const events = [];
    const start = Date.now();
    let prev = null;
    for (let m = 0; m <= 36 * 60; m += 1) {
      const d = new Date(start + m * 60000);
      const w = this.sunDark(d, cfg) && !this.inNightBreak(d, cfg.nightBreak);
      if (prev !== null && w !== prev) events.push({ t: d.valueOf(), on: w });
      prev = w;
    }
    return events;
  }

  async getStatus() {
    const cfg = this.config;
    const { lat, lng } = this.position;
    const now = new Date();
    // Dagens kurve over solhøyde (hvert 10. minutt) for grafen i innstillingene
    const midnight = now.valueOf() - this.localMinutes(now) * 60000;
    const curve = [];
    for (let m = 0; m <= 1440; m += 10) curve.push(+sunAltitude(new Date(midnight + m * 60000), lat, lng).toFixed(2));
    const altitude = sunAltitude(now, lat, lng);
    const forecast = this.forecast(cfg);
    return {
      lat, lng,
      enabled: cfg.enabled,
      lightsOn: await this.lightsOn(cfg),
      estimatedLux: estimateLux(altitude),
      nextOnText: this.formatEvent(forecast.find(e => e.on)?.t),
      nextOffText: this.formatEvent(forecast.find(e => !e.on)?.t),
      timezone: this.homey.clock.getTimezone(),
      altitude,
      dark: await this.isDark(now, cfg),
      lux: this.currentLux,
      wanted: this.lastWanted,
      pausedUntil: this.pausedUntil > Date.now() ? this.pausedUntil : null,
      forecast,
      curve,
      nowMinutes: this.localMinutes(now),
      log: this.lastLog,
    };
  }

}

module.exports = OutdoorLightsApp;
